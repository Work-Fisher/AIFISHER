import { useSyncExternalStore } from 'react';
import { preferenceStorage, type PreferenceStorage } from '../persistence/preferenceStore';
import { applyCanvasTheme, themeTokenCss, type CanvasTheme } from './themeTokens';

export const APPEARANCE_KEY = 'aifisher.canvas.appearance.v1';
export const BACKGROUND_ENDPOINT = '/api/appearance/background';
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
export interface BackgroundImage {
  id: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}
export interface AppearancePreferences {
  version: 1;
  theme: CanvasTheme;
  background: {
    enabled: boolean;
    fade: number;
    blur: number;
    positionX: number;
    positionY: number;
  };
}
export interface CanvasAppearance extends AppearancePreferences {
  image: BackgroundImage | null;
  busy: boolean;
  error: string;
}
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  version: 1,
  theme: 'dark',
  background: { enabled: false, fade: 55, blur: 0, positionX: 50, positionY: 50 },
};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export function parseAppearance(value: unknown): AppearancePreferences {
  const raw = value && typeof value === 'object' ? (value as Partial<AppearancePreferences>) : {};
  if (raw.version !== 1)
    return { ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background } };
  const background = raw.background ?? DEFAULT_APPEARANCE.background;
  return {
    version: 1,
    theme: raw.theme === 'light' ? 'light' : 'dark',
    background: {
      enabled: background.enabled === true,
      fade: number(background.fade, 55, 0, 95),
      blur: number(background.blur, 0, 0, 12),
      positionX: number(background.positionX, 50, 0, 100),
      positionY: number(background.positionY, 50, 0, 100),
    },
  };
}

export function parseBackgroundImage(value: unknown): BackgroundImage | null {
  if (!value || typeof value !== 'object') return null;
  const image = value as BackgroundImage;
  if (
    typeof image.id !== 'string' ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(image.id) ||
    image.url !== `${BACKGROUND_ENDPOINT}/${image.id}` ||
    !Number.isSafeInteger(image.width) ||
    image.width < 1 ||
    image.width > 4096 ||
    !Number.isSafeInteger(image.height) ||
    image.height < 1 ||
    image.height > 4096 ||
    !Number.isSafeInteger(image.bytes) ||
    image.bytes < 1 ||
    image.bytes > MAX_BACKGROUND_BYTES
  )
    return null;
  return {
    id: image.id,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    url: image.url,
  };
}

export function createCanvasAppearanceStore({
  storage,
  fetchImpl,
  applyTheme = applyCanvasTheme,
}: {
  storage: PreferenceStorage;
  fetchImpl: typeof fetch;
  applyTheme?: (theme: CanvasTheme) => void;
}) {
  let preferences: AppearancePreferences;
  try {
    preferences = parseAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY) ?? 'null'));
  } catch {
    preferences = parseAppearance(null);
  }
  let state: CanvasAppearance = { ...preferences, image: null, busy: false, error: '' };
  let imageRevision = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CanvasAppearance>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  applyTheme(state.theme);
  const update = (
    patch: Partial<Omit<AppearancePreferences, 'background'>> & {
      background?: Partial<AppearancePreferences['background']>;
    },
  ) => {
    const next = parseAppearance({
      ...state,
      ...patch,
      background: { ...state.background, ...patch.background },
    });
    applyTheme(next.theme);
    storage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    publish({ ...next, error: '' });
  };
  async function readResponse(response: Response) {
    const body = (await response.json().catch(() => null)) as {
      image?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok)
      throw new Error(typeof body?.error === 'string' ? body.error : '背景未能保存，请稍后重试。');
    if (!body || !Object.hasOwn(body, 'image')) throw new Error('背景服务返回内容无效。');
    const image = parseBackgroundImage(body.image);
    if (body.image !== null && image === null) throw new Error('背景服务返回内容无效。');
    return image;
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    reset: () =>
      update({ ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background } }),
    async loadImage() {
      const revision = imageRevision;
      try {
        const image = await readResponse(
          await fetchImpl(BACKGROUND_ENDPOINT, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
          }),
        );
        if (revision === imageRevision) publish({ image });
      } catch {
        // Missing/corrupt/offline wallpaper never prevents opening or editing the canvas.
      }
    },
    async upload(file: File) {
      if (state.busy) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        publish({ error: '请选择静态 JPG、PNG 或 WebP 图片。' });
        return;
      }
      if (!file.size || file.size > MAX_BACKGROUND_BYTES) {
        publish({ error: '背景图片不能为空，且不能超过 20 MiB。' });
        return;
      }
      imageRevision += 1;
      publish({ busy: true, error: '' });
      try {
        const image = await readResponse(
          await fetchImpl(BACKGROUND_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
            signal: AbortSignal.timeout(60000),
          }),
        );
        if (!image) throw new Error('背景图片未能保存。');
        update({ background: { enabled: true } });
        publish({ image });
      } catch (error) {
        publish({ error: error instanceof Error ? error.message : '背景上传失败，已保留原背景。' });
      } finally {
        publish({ busy: false });
      }
    },
    async remove() {
      if (state.busy) return;
      imageRevision += 1;
      publish({ busy: true, error: '' });
      try {
        await readResponse(
          await fetchImpl(BACKGROUND_ENDPOINT, {
            method: 'DELETE',
            signal: AbortSignal.timeout(15000),
          }),
        );
        update({ background: { enabled: false } });
        publish({ image: null });
      } catch (error) {
        publish({ error: error instanceof Error ? error.message : '背景移除失败，已保留原背景。' });
      } finally {
        publish({ busy: false });
      }
    },
  };
}

export type CanvasAppearanceStore = ReturnType<typeof createCanvasAppearanceStore>;
let installed: CanvasAppearanceStore | null = null;

export function installCanvasAppearance(): CanvasAppearanceStore {
  if (installed) return installed;
  if (!document.getElementById('aifisher-appearance-tokens')) {
    const style = document.createElement('style');
    style.id = 'aifisher-appearance-tokens';
    style.textContent = themeTokenCss();
    document.head.append(style);
  }
  installed = createCanvasAppearanceStore({
    storage: preferenceStorage(),
    fetchImpl: window.fetch.bind(window),
  });
  void installed.loadImage();
  return installed;
}

export function useCanvasAppearance() {
  const store = installCanvasAppearance();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
