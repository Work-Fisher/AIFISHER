import { desktopBridge } from '../desktop/desktopBridge';

const MEDIA_EXTENSION =
  /\.(?:png|jpe?g|webp|gif|bmp|avif|svg|mp4|mov|m4v|webm|mkv|mp3|wav|ogg|m4a|flac|aac)$/iu;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

export type DownloadableMediaNode = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  resultUrls?: unknown;
};

export type MediaDownloadFileNameAdapter = {
  fileName: (node: DownloadableMediaNode, sourceUrl: unknown, extension: unknown) => string;
  download: (
    node: DownloadableMediaNode,
    sourceUrl: unknown,
    extension: unknown,
    button?: HTMLButtonElement | null,
    suggestedFileName?: string,
  ) => Promise<MediaDownloadResult>;
  getSettings: () => Promise<MediaDownloadSettings>;
  chooseDirectory: () => Promise<MediaDownloadSettings | { status: 'cancelled' }>;
  resetDirectory: () => Promise<MediaDownloadSettings>;
  setAskEachTime: (enabled: boolean) => Promise<MediaDownloadSettings>;
  openDirectory: () => Promise<MediaDownloadOpenResult>;
};

export type MediaDownloadOpenResult = {
  status: 'opened';
  foreground: boolean;
  fileName: string | null;
  directory: string;
};

export type MediaDownloadSettings = {
  directory: string;
  defaultDirectory: string;
  customDirectory: boolean;
  askEachTime: boolean;
  directoryAvailable: boolean;
};

export type MediaDownloadResult =
  | { status: 'saved'; fileName: string; directory: string }
  | { status: 'cancelled' | 'busy' }
  | { status: 'failed'; code: string; message: string };

type DownloadResponse = MediaDownloadSettings & {
  status?: string;
  fileName?: string;
  directory?: string;
  error?: string;
  code?: string;
  foreground?: boolean;
};

function savedFilePath(directory: string, fileName: string): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/u, '')}${separator}${fileName}`;
}

function desktopShowItemInFolder(windowObject: Window | null) {
  const bridge = desktopBridge(windowObject);
  return bridge ? (path: string) => bridge.showItemInFolder(path) : null;
}

function safeExtension(value: unknown): string {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, '')
      .slice(0, 8) || 'bin'
  );
}

function fallbackName(node: DownloadableMediaNode): string {
  return `${String(node.type || 'media').toLowerCase()}_${String(node.id || 'download')}`;
}

function sanitizeBaseName(value: unknown): string {
  const withoutForbiddenCharacters = Array.from(
    String(value || '')
      .trim()
      .replace(MEDIA_EXTENSION, '')
      .replace(/\|/gu, '丨')
      .replace(/:/gu, '：')
      .replace(/[\\/]/gu, '-')
      .replace(/[<>"?*]/gu, ''),
  )
    .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
    .join('');
  const sanitized = withoutForbiddenCharacters
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 120)
    .replace(/[. ]+$/gu, '');
  return WINDOWS_RESERVED_NAME.test(sanitized) ? `_${sanitized}` : sanitized;
}

function urlWithoutQuery(value: unknown): string {
  return String(value || '').split(/[?#]/u, 1)[0];
}

function resultNumber(node: DownloadableMediaNode, sourceUrl: unknown): number | undefined {
  if (!Array.isArray(node.resultUrls) || node.resultUrls.length <= 1) return undefined;
  const source = String(sourceUrl || '');
  let index = node.resultUrls.findIndex((value) => value === source);
  if (index < 0) {
    const sourceWithoutQuery = urlWithoutQuery(source);
    index = node.resultUrls.findIndex((value) => urlWithoutQuery(value) === sourceWithoutQuery);
  }
  return index >= 0 ? index + 1 : undefined;
}

export function buildMediaDownloadFileName(
  node: DownloadableMediaNode,
  sourceUrl: unknown,
  extension: unknown,
): string {
  const fallback = sanitizeBaseName(fallbackName(node)) || 'media_download';
  const baseName = sanitizeBaseName(node.title) || fallback;
  const number = resultNumber(node, sourceUrl);
  return `${baseName}${number ? `-${number}` : ''}.${safeExtension(extension)}`;
}

const DOWNLOAD_STYLE_ID = 'fisherai-media-download-style';
const DOWNLOAD_TOAST_ATTRIBUTE = 'data-fisherai-download-toast';

function installDownloadStyle(documentRoot: Document) {
  if (documentRoot.getElementById(DOWNLOAD_STYLE_ID)) return;
  const style = documentRoot.createElement('style');
  style.id = DOWNLOAD_STYLE_ID;
  style.textContent = `
    [data-fisherai-download-state="preparing"] { position: relative; cursor: progress !important; }
    [data-fisherai-download-state="preparing"] > svg { opacity: 0 !important; }
    [data-fisherai-download-state="preparing"]::after {
      content: ''; position: absolute; left: 50%; top: 50%; width: 13px; height: 13px;
      margin: -7px 0 0 -7px; border: 2px solid currentColor;
      border-right-color: transparent; border-radius: 999px;
      animation: fisherai-download-spin .72s linear infinite;
    }
    [${DOWNLOAD_TOAST_ATTRIBUTE}] {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147482500;
      display: flex; align-items: center; gap: 12px; max-width: min(460px, calc(100vw - 32px));
      padding: 12px 14px; border: 1px solid var(--af-border-control); border-radius: 12px;
      color: var(--af-text); background: var(--af-surface); box-shadow: var(--af-shadow);
      font: 500 13px/1.45 Inter, 'Microsoft YaHei UI', system-ui, sans-serif;
    }
    [${DOWNLOAD_TOAST_ATTRIBUTE}][data-tone="success"] { border-color: var(--af-success); }
    [${DOWNLOAD_TOAST_ATTRIBUTE}][data-tone="danger"] { border-color: var(--af-danger); }
    [${DOWNLOAD_TOAST_ATTRIBUTE}] button {
      flex: none; min-height: 30px; padding: 5px 9px; border: 1px solid var(--af-border-control);
      border-radius: 8px; color: var(--af-text); background: var(--af-surface-raised); cursor: pointer;
    }
    @keyframes fisherai-download-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      [data-fisherai-download-state="preparing"]::after { animation-duration: .01ms; }
    }
  `;
  documentRoot.head.append(style);
}

function downloadError(value: DownloadResponse, status: number) {
  return Object.assign(new Error(value.error || `下载失败 (${status})`), {
    code: value.code || 'DOWNLOAD_FAILED',
  });
}

export function createMediaDownloadAdapter({
  fetcher = globalThis.fetch,
  documentRoot = document,
  showItemInFolder = desktopShowItemInFolder(documentRoot.defaultView),
}: {
  fetcher?: typeof fetch;
  documentRoot?: Document;
  showItemInFolder?: ((path: string) => Promise<void>) | null;
} = {}): MediaDownloadFileNameAdapter {
  installDownloadStyle(documentRoot);
  const busyButtons = new WeakSet<HTMLButtonElement>();
  let dismissTimer: number | undefined;

  const request = async (url: string, init?: RequestInit): Promise<DownloadResponse> => {
    const response = await fetcher(url, init);
    const body = (await response.json().catch(() => ({}))) as DownloadResponse;
    if (!response.ok) throw downloadError(body, response.status);
    return body;
  };

  const showToast = (
    message: string,
    tone: 'neutral' | 'success' | 'danger' = 'neutral',
    openFolder: (() => Promise<string>) | null = null,
    dismissAfter = tone === 'danger' ? 6_000 : 4_500,
  ) => {
    if (dismissTimer !== undefined) {
      window.clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }
    documentRoot.querySelector(`[${DOWNLOAD_TOAST_ATTRIBUTE}]`)?.remove();
    const toast = documentRoot.createElement('div');
    toast.setAttribute(DOWNLOAD_TOAST_ATTRIBUTE, 'true');
    toast.dataset.tone = tone;
    toast.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    toast.setAttribute('aria-live', tone === 'danger' ? 'assertive' : 'polite');
    const copy = documentRoot.createElement('span');
    copy.textContent = message;
    toast.append(copy);
    if (openFolder) {
      const open = documentRoot.createElement('button');
      open.type = 'button';
      open.textContent = '打开下载目录';
      open.addEventListener('click', () => {
        showToast('正在打开下载目录…', 'neutral', null, 0);
        void openFolder()
          .then((openedMessage) => {
            showToast(openedMessage, 'success');
          })
          .catch((error) => {
            showToast(error instanceof Error ? error.message : '无法打开下载目录', 'danger');
          });
      });
      toast.append(open);
    }
    documentRoot.body.append(toast);
    if (dismissAfter > 0) {
      dismissTimer = window.setTimeout(() => toast.remove(), dismissAfter);
    }
  };

  const openDirectory = async () => {
    const result = await request('/api/media-download/open-directory', { method: 'POST' });
    if (
      result.status !== 'opened' ||
      typeof result.foreground !== 'boolean' ||
      typeof result.directory !== 'string'
    ) {
      throw Object.assign(new Error('打开下载目录返回了无效结果'), {
        code: 'DOWNLOAD_OPEN_RESULT_INVALID',
      });
    }
    return {
      status: 'opened' as const,
      foreground: result.foreground,
      fileName: result.fileName || null,
      directory: result.directory,
    };
  };

  // The desktop shell selects the file it was told about; otherwise the backend reopens its last download.
  const revealSavedFile = async (directory: string, fileName: string) => {
    if (showItemInFolder) {
      await showItemInFolder(savedFilePath(directory, fileName));
      return `已打开并定位：${fileName}`;
    }
    const result = await openDirectory();
    if (!result.foreground) return '下载目录已打开，如未显示请检查任务栏。';
    return result.fileName ? `已打开并定位：${result.fileName}` : '已打开下载目录。';
  };

  return Object.freeze({
    fileName: buildMediaDownloadFileName,
    async download(node, sourceUrl, extension, button, suggestedFileName) {
      if (button && busyButtons.has(button)) return { status: 'busy' };
      const wasDisabled = button?.disabled === true;
      if (button) {
        busyButtons.add(button);
        button.disabled = true;
        button.dataset.fisheraiDownloadState = 'preparing';
        button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-label', '正在准备下载');
      }
      showToast('正在准备下载…');
      try {
        const fileName =
          suggestedFileName || buildMediaDownloadFileName(node, sourceUrl, extension);
        const result = await request('/api/media-download/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceUrl, fileName }),
        });
        if (result.status === 'cancelled') {
          showToast('已取消下载');
          return { status: 'cancelled' };
        }
        if (result.status !== 'saved' || !result.fileName || !result.directory) {
          throw Object.assign(new Error('下载服务返回了无效结果'), {
            code: 'DOWNLOAD_RESULT_INVALID',
          });
        }
        const { fileName: savedName, directory } = result;
        showToast(`已保存：${savedName}`, 'success', () => revealSavedFile(directory, savedName));
        return { status: 'saved', fileName: savedName, directory };
      } catch (error) {
        const message = error instanceof Error ? error.message : '下载失败，请稍后重试';
        const code = String((error as { code?: unknown })?.code || 'DOWNLOAD_FAILED');
        showToast(`下载失败：${message}`, 'danger');
        return { status: 'failed', code, message };
      } finally {
        if (button) {
          busyButtons.delete(button);
          button.disabled = wasDisabled;
          delete button.dataset.fisheraiDownloadState;
          button.removeAttribute('aria-busy');
          button.setAttribute('aria-label', '下载');
        }
      }
    },
    getSettings: () => request('/api/media-download/settings') as Promise<MediaDownloadSettings>,
    async chooseDirectory() {
      const result = await request('/api/media-download/settings/directory', { method: 'POST' });
      return result.status === 'cancelled'
        ? { status: 'cancelled' }
        : (result as MediaDownloadSettings);
    },
    resetDirectory: () =>
      request('/api/media-download/settings/directory', {
        method: 'DELETE',
      }) as Promise<MediaDownloadSettings>,
    setAskEachTime: (enabled) =>
      request('/api/media-download/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ askEachTime: enabled }),
      }) as Promise<MediaDownloadSettings>,
    openDirectory,
  });
}

declare global {
  interface Window {
    __FISHERAI_MEDIA_DOWNLOAD__?: MediaDownloadFileNameAdapter;
  }
}

export function installMediaDownloadFileName(
  target: Window = window,
): MediaDownloadFileNameAdapter {
  if (target.__FISHERAI_MEDIA_DOWNLOAD__) return target.__FISHERAI_MEDIA_DOWNLOAD__;
  const adapter = createMediaDownloadAdapter({ documentRoot: target.document });
  target.__FISHERAI_MEDIA_DOWNLOAD__ = adapter;
  return adapter;
}
