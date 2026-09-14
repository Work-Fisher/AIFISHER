export const DESKTOP_UPDATE_EVENT = 'desktop-update-progress' as const;

export type DesktopUpdateEvent = {
  revision: number;
  event: string;
  status: string | null;
  stage: string | null;
  completedBytes: number | null;
  totalBytes: number | null;
  overallPercent: number | null;
  version: string | null;
  title: string | null;
  summary: string | null;
  changes: string[];
  message: string | null;
};

export type DesktopUpdateCommand = 'update_status' | 'update_prepare' | 'update_apply';

export type DesktopUpdateBridge = {
  invoke: (command: DesktopUpdateCommand) => Promise<DesktopUpdateEvent>;
  listen: (
    event: typeof DESKTOP_UPDATE_EVENT,
    handler: (event: DesktopUpdateEvent) => void,
  ) => Promise<() => Promise<void> | void>;
};

export const initialDesktopUpdate: DesktopUpdateEvent = {
  revision: 0,
  event: 'progress',
  status: 'checking',
  stage: 'ComparingInstalled',
  completedBytes: 0,
  totalBytes: 0,
  overallPercent: 0,
  version: null,
  title: null,
  summary: null,
  changes: [],
  message: '正在检查签名更新…',
};

export function acceptDesktopUpdateEvent(
  current: DesktopUpdateEvent | null,
  next: DesktopUpdateEvent,
) {
  if ((next.status === 'ready' || next.status === 'applying') && next.overallPercent !== 100) {
    next = { ...next, overallPercent: 100 };
  }
  if (!current) return next;
  const currentRevision = current.revision ?? 0;
  const nextRevision = next.revision ?? 0;
  if (nextRevision < currentRevision) return current;
  if (
    nextRevision === currentRevision &&
    (next.overallPercent ?? 0) < (current.overallPercent ?? 0)
  ) {
    return current;
  }
  return next;
}

export function setDesktopUpdateApplying(documentRoot: Document, applying: boolean) {
  if (applying) documentRoot.documentElement.dataset.aifisherUpdateApplying = 'true';
  else delete documentRoot.documentElement.dataset.aifisherUpdateApplying;
  documentRoot.defaultView?.dispatchEvent(new Event('aifisher:update-activity-changed'));
}

export function desktopUpdateProgressMessage(event: DesktopUpdateEvent) {
  if (event.message) return event.message;
  switch (event.stage) {
    case 'ComparingInstalled':
      return '正在比对本机组件…';
    case 'Downloading':
      if (event.totalBytes != null && event.totalBytes > 0 && event.completedBytes != null) {
        const downloaded = Math.max(0, event.completedBytes) / 1024 / 1024;
        const total = event.totalBytes / 1024 / 1024;
        return `正在下载变化组件… ${downloaded.toFixed(1)} / ${total.toFixed(1)} MB`;
      }
      return '正在下载变化组件…';
    case 'BuildingCandidate':
      return '正在构建完整候选版本…';
    case 'VerifyingCandidate':
      return '正在校验完整候选版本…';
    default:
      return '正在准备更新…';
  }
}

export function desktopUpdateApplying(current: DesktopUpdateEvent) {
  return {
    ...current,
    status: 'applying',
    message: '正在安全停止本机服务并换入新版本…',
  };
}

export function desktopUpdateApplyFailed(current: DesktopUpdateEvent) {
  return {
    ...current,
    status: 'ready',
    message: '更新 helper 未启动；当前版本保持不变。',
  };
}

export function desktopUpdateCheckFailed() {
  return {
    ...initialDesktopUpdate,
    event: 'complete',
    status: 'failed',
    message: '更新检查未完成；当前版本保持不变。',
  };
}

export function startDesktopUpdateSession({
  bridge,
  onEvent,
  onFailure,
  onSettled,
  checkIntervalMs = 0,
}: {
  bridge: DesktopUpdateBridge;
  onEvent: (event: DesktopUpdateEvent) => void;
  onFailure: (event: DesktopUpdateEvent) => void;
  onSettled?: () => void;
  checkIntervalMs?: number;
}) {
  let disposed = false;
  let unlisten: (() => Promise<void> | void) | null = null;
  let current: DesktopUpdateEvent | null = null;
  let checking = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const receive = (next: DesktopUpdateEvent) => {
    if (disposed) return;
    const accepted = acceptDesktopUpdateEvent(current, next);
    if (accepted === current) return;
    current = accepted;
    onEvent(accepted);
  };

  void bridge
    .listen(DESKTOP_UPDATE_EVENT, receive)
    .then((disposeListener) => {
      if (disposed) return disposeListener();
      unlisten = disposeListener;
      return bridge
        .invoke('update_status')
        .then(receive)
        .catch(() => undefined)
        .then(() => bridge.invoke('update_prepare'))
        .then(receive);
    })
    .catch(() => {
      if (!disposed) onFailure(desktopUpdateCheckFailed());
    })
    .finally(() => {
      if (disposed) return;
      onSettled?.();
      if (checkIntervalMs > 0) {
        timer = setInterval(() => {
          if (disposed || checking || current?.status === 'applying' || current?.status === 'ready')
            return;
          checking = true;
          void bridge
            .invoke('update_prepare')
            .then(receive)
            .catch(() => {
              // Background checks must not interrupt an active canvas when offline.
            })
            .finally(() => {
              checking = false;
            });
        }, checkIntervalMs);
      }
    });

  return () => {
    disposed = true;
    if (timer !== undefined) clearInterval(timer);
    void unlisten?.();
  };
}
