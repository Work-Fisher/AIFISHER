export type AutoSaveReason = 'interval' | 'hidden' | 'pagehide' | 'edit';
export type AutoSaveResult =
  | 'saved'
  | 'clean'
  | 'busy'
  | 'throttled'
  | 'unloading'
  | 'disposed'
  | 'failed';

export interface AutoSaveDocumentState {
  isDirty: boolean;
  nodeCount: number;
  /**
   * 工作流内容指纹。协同会把本地编辑广播出去、回声又改变节点引用，
   * 于是脏标记被反复置位——只信脏标记会造成无编辑也每几秒写一次盘。
   * 指纹相同就说明内容没变，直接跳过。
   */
  signature?: string;
}

export interface CanvasAutoSaveController {
  attempt(
    reason: AutoSaveReason,
    state: AutoSaveDocumentState,
    save: () => Promise<unknown>,
    force?: boolean,
  ): Promise<AutoSaveResult>;
  /**
   * 每次编辑后调用：防抖合并连续操作，并在被节流时自动补一次，保证编辑最终一定落盘。
   * 传函数而不是快照，指纹只在定时器真正触发时才计算，避免每次渲染都序列化整张画布。
   */
  schedule(getState: () => AutoSaveDocumentState, save: () => Promise<unknown>): void;
  cancelScheduled(): void;
  markUnloading(): void;
  dispose(): void;
  getLastSaveTime(): number;
}

export interface CanvasAutoSaveOptions {
  minimumIntervalMs?: number;
  debounceMs?: number;
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface CanvasAutoSaveAdapter {
  createController(options?: CanvasAutoSaveOptions): CanvasAutoSaveController;
  getDiagnostics(): { attempts: number; saves: number; failures: number };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_AUTO_SAVE__?: CanvasAutoSaveAdapter;
  }
}

interface AutoSaveCounters {
  attempts: number;
  saves: number;
  failures: number;
}

export function createCanvasAutoSaveController(
  options: CanvasAutoSaveOptions = {},
  counters?: AutoSaveCounters,
): CanvasAutoSaveController {
  const now = options.now ?? Date.now;
  // 编辑后要尽快落盘，节流窗口不能大到让一次编辑等上十几秒。
  const minimumIntervalMs = Math.max(0, options.minimumIntervalMs ?? 3_000);
  const debounceMs = Math.max(0, options.debounceMs ?? 1_200);
  const setTimer = options.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));
  let lastSaveTime = 0;
  let inFlight = false;
  let unloading = false;
  let pending: unknown = null;
  let lastSignature: string | null = null;
  let disposed = false;
  let scheduleVersion = 0;

  const controller: CanvasAutoSaveController = {
    async attempt(reason, state, save, force = false) {
      if (disposed) return 'disposed';
      if (counters) counters.attempts += 1;
      if (!state.isDirty) return 'clean';
      // Empty is a valid edited document (including deleting its last node).
      // 内容和上次落盘的完全一样，就没有保存的必要——这是打断协同回声回路的关键。
      if (!force && state.signature != null && state.signature === lastSignature) return 'clean';
      if (inFlight) return 'busy';
      if (unloading && !force) return 'unloading';
      if (!force && now() - lastSaveTime < minimumIntervalMs) return 'throttled';

      inFlight = true;
      try {
        await save();
        if (disposed) return 'disposed';
        lastSaveTime = now();
        if (state.signature != null) lastSignature = state.signature;
        if (counters) counters.saves += 1;
        return 'saved';
      } catch (error) {
        if (counters) counters.failures += 1;
        console.error(`[Auto-Save] Failed on ${reason}:`, error);
        return 'failed';
      } finally {
        inFlight = false;
      }
    },
    schedule(getState, save) {
      controller.cancelScheduled();
      if (unloading || disposed) return;
      const version = scheduleVersion;
      // 距上次保存不足节流窗口时，把定时器顺延到窗口结束，
      // 否则这次编辑会被判成 throttled 然后再没人管，等于丢了。
      const waited = now() - lastSaveTime;
      const delay = Math.max(debounceMs, minimumIntervalMs - waited);
      pending = setTimer(() => {
        if (version !== scheduleVersion || disposed) return;
        pending = null;
        void controller.attempt('edit', getState(), save).then((result) => {
          // 保存期间又来了编辑（busy），或仍在节流窗口内，再补一次。
          if (version === scheduleVersion && !disposed && (result === 'busy' || result === 'throttled'))
            controller.schedule(getState, save);
        });
      }, delay);
    },
    cancelScheduled() {
      scheduleVersion += 1;
      if (pending === null) return;
      clearTimer(pending);
      pending = null;
    },
    markUnloading() {
      unloading = true;
      controller.cancelScheduled();
    },
    dispose() {
      disposed = true;
      controller.cancelScheduled();
    },
    getLastSaveTime() {
      return lastSaveTime;
    },
  };

  return controller;
}

export function installCanvasAutoSave(): CanvasAutoSaveAdapter {
  if (window.__FISHERAI_CANVAS_AUTO_SAVE__) return window.__FISHERAI_CANVAS_AUTO_SAVE__;
  const counters: AutoSaveCounters = { attempts: 0, saves: 0, failures: 0 };
  const adapter: CanvasAutoSaveAdapter = {
    createController(options) {
      return createCanvasAutoSaveController(options, counters);
    },
    getDiagnostics() {
      return { ...counters };
    },
  };
  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_AUTO_SAVE__ = adapter;
  return adapter;
}
