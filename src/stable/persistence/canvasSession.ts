import { STABLE_MAX_ZOOM, STABLE_MIN_ZOOM, type CanvasViewport } from '../canvas/canvasNavigation';

export const CANVAS_SESSION_STORAGE_KEY = 'fisherai.canvas.resume.v1';

export interface CanvasResumeState {
  version: 1;
  workflowId: string;
  folderId: string | null;
  viewport: CanvasViewport;
}

export interface CanvasSessionAdapter {
  load(): CanvasResumeState | null;
  save(state: Omit<CanvasResumeState, 'version'>): void;
  clear(): void;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isViewport(value: unknown): value is CanvasViewport {
  if (!value || typeof value !== 'object') return false;
  const viewport = value as Partial<CanvasViewport>;
  return (
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y) &&
    Number.isFinite(viewport.zoom) &&
    Number(viewport.zoom) >= STABLE_MIN_ZOOM &&
    Number(viewport.zoom) <= STABLE_MAX_ZOOM
  );
}

export function parseCanvasResumeState(value: unknown): CanvasResumeState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<CanvasResumeState>;
  if (
    state.version !== 1 ||
    !isBoundedString(state.workflowId) ||
    !(state.folderId === null || isBoundedString(state.folderId)) ||
    !isViewport(state.viewport)
  ) {
    return null;
  }
  return {
    version: 1,
    workflowId: state.workflowId,
    folderId: state.folderId,
    viewport: {
      x: Number(state.viewport.x),
      y: Number(state.viewport.y),
      zoom: Number(state.viewport.zoom),
    },
  };
}

export function createCanvasSession(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): CanvasSessionAdapter {
  return Object.freeze({
    load() {
      try {
        const serialized = storage.getItem(CANVAS_SESSION_STORAGE_KEY);
        if (!serialized) return null;
        const state = parseCanvasResumeState(JSON.parse(serialized));
        if (!state) storage.removeItem(CANVAS_SESSION_STORAGE_KEY);
        return state;
      } catch {
        try {
          storage.removeItem(CANVAS_SESSION_STORAGE_KEY);
        } catch {
          // Storage may be disabled by the browser. The canvas remains usable without resume.
        }
        return null;
      }
    },
    save(state: Omit<CanvasResumeState, 'version'>) {
      const validated = parseCanvasResumeState({ ...state, version: 1 });
      if (!validated) return;
      try {
        storage.setItem(CANVAS_SESSION_STORAGE_KEY, JSON.stringify(validated));
      } catch {
        // Session persistence is an enhancement and must never break the stable canvas.
      }
    },
    clear() {
      try {
        storage.removeItem(CANVAS_SESSION_STORAGE_KEY);
      } catch {
        // Ignore unavailable storage for the same fail-open reason as save().
      }
    },
  });
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_SESSION__?: CanvasSessionAdapter;
  }
}

export function installCanvasSession(): CanvasSessionAdapter {
  if (window.__FISHERAI_CANVAS_SESSION__) return window.__FISHERAI_CANVAS_SESSION__;
  let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  const adapter = createCanvasSession(storage);
  window.__FISHERAI_CANVAS_SESSION__ = adapter;
  return adapter;
}
