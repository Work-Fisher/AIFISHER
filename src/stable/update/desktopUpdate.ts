import {
  type DesktopUpdateBridge,
  type DesktopUpdateEvent,
  desktopUpdateApplyFailed,
  desktopUpdateApplying,
  desktopUpdateProgressMessage,
  setDesktopUpdateApplying,
  startDesktopUpdateSession,
} from '../../update/desktopUpdateModel';
import { desktopBridge, type AifisherDesktopBridge } from '../desktop/desktopBridge';
import { activateModal } from '../design/modalFocus';
import { createUpdateDownloadFallback } from '../../update/updateDownloadFallback';

export type { DesktopUpdateBridge, DesktopUpdateEvent } from '../../update/desktopUpdateModel';

const SURFACE_ATTRIBUTE = 'data-fisherai-desktop-update';
const STYLE_ATTRIBUTE = 'data-fisherai-desktop-update-style';
const TOAST_ATTRIBUTE = 'data-fisherai-desktop-update-toast';

export function createDesktopUpdateBridge(
  desktop: Pick<AifisherDesktopBridge, 'update'> | null,
): DesktopUpdateBridge | null {
  if (!desktop) return null;
  const { update } = desktop;
  const commands = {
    update_status: () => update.status(),
    update_prepare: () => update.prepare(),
    update_apply: () => update.apply(),
  };
  return {
    invoke: (command) => commands[command](),
    listen: async (_event, handler) => update.onProgress(handler),
  };
}

function installStyle(documentRoot: Document) {
  if (documentRoot.head.querySelector(`[${STYLE_ATTRIBUTE}]`)) return;
  const style = documentRoot.createElement('style');
  style.setAttribute(STYLE_ATTRIBUTE, 'true');
  style.textContent = `
    [${SURFACE_ATTRIBUTE}] {
      position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
      padding: 24px; color: var(--af-text); background: rgb(5 5 5 / .64);
      font: 500 14px/1.55 Inter, "Microsoft YaHei UI", system-ui, sans-serif;
    }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-card {
      position: relative; width: min(560px, 100%); max-height: calc(100dvh - 48px);
      overflow-y: auto; box-sizing: border-box; padding: 32px; border: 1px solid var(--af-border);
      border-radius: 16px; background: var(--af-input); box-shadow: 0 24px 64px #0000007a;
    }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-close { position:absolute; top:14px; right:16px; width:32px; height:32px; margin:0; padding:0; color: var(--af-text-secondary); background: transparent; font-size:24px; line-height:1; }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-close:hover { color: var(--af-text); background: var(--af-hover); }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-eyebrow {
      display: block; margin-bottom: 10px; color: var(--af-text-muted); font-size: 11px;
      font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    }
    [${SURFACE_ATTRIBUTE}] h2 { margin: 0 0 10px; font-size: 24px; line-height: 1.25; }
    [${SURFACE_ATTRIBUTE}] p { margin: 0; color: var(--af-text-secondary); }
    [${SURFACE_ATTRIBUTE}] ul { margin: 18px 0 0; padding-left: 20px; color: var(--af-text); }
    [${SURFACE_ATTRIBUTE}] li + li { margin-top: 6px; }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-progress {
      height: 5px; margin-top: 24px; overflow: hidden; border-radius: 999px; background: var(--af-hover);
    }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-progress span {
      display: block; height: 100%; border-radius: inherit; background: #3b82f6;
      transition: width 180ms ease-out;
    }
    [${SURFACE_ATTRIBUTE}] .fisherai-update-progress-copy {
      display: flex; justify-content: space-between; gap: 16px; margin-top: 9px;
      color: var(--af-text-secondary); font-size: 12px;
    }
    [${SURFACE_ATTRIBUTE}] button {
      width: 100%; margin-top: 24px; padding: 11px 16px; border: 0; border-radius: 10px;
      color: var(--af-on-primary); background: var(--af-primary); font: inherit; font-weight: 700; cursor: pointer;
    }
    [${SURFACE_ATTRIBUTE}] button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 3px; }
    [${SURFACE_ATTRIBUTE}] button:disabled { cursor: wait; opacity: .55; }
    [${TOAST_ATTRIBUTE}] {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; max-width: 420px;
      padding: 12px 14px; border: 1px solid #7f3540; border-radius: 12px;
      color: var(--af-text); background: var(--af-input); box-shadow: 0 24px 64px #0000007a;
      font: 500 13px/1.45 Inter, "Microsoft YaHei UI", system-ui, sans-serif;
    }
    @media (prefers-reduced-motion: reduce) {
      [${SURFACE_ATTRIBUTE}] .fisherai-update-progress span { transition-duration: .01ms; }
    }
  `;
  documentRoot.head.append(style);
}

function showFailure(documentRoot: Document, message: string) {
  documentRoot.querySelector(`[${SURFACE_ATTRIBUTE}]`)?.remove();
  documentRoot.querySelector(`[${TOAST_ATTRIBUTE}]`)?.remove();
  const toast = documentRoot.createElement('div');
  toast.setAttribute(TOAST_ATTRIBUTE, 'true');
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  const close = documentRoot.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭更新提示');
  close.style.cssText = 'float:right;margin-left:16px;background:transparent;border:0;color:#a3a3a3;font-size:20px;cursor:pointer';
  close.onclick = () => toast.remove();
  toast.prepend(close);
  toast.append(createUpdateDownloadFallback(documentRoot));
  documentRoot.body.append(toast);
}

function renderUpdate(
  documentRoot: Document,
  event: DesktopUpdateEvent,
  apply: () => void,
  dismissible: boolean,
  dismiss: () => void,
) {
  if (['current', 'disabled'].includes(event.status || '')) {
    documentRoot.querySelector(`[${SURFACE_ATTRIBUTE}]`)?.remove();
    return;
  }
  if (event.status === 'failed') {
    showFailure(documentRoot, event.message || '更新检查未完成；当前版本保持不变。');
    return;
  }
  let surface = documentRoot.querySelector<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`);
  const opening = !surface;
  if (!surface) {
    surface = documentRoot.createElement('section');
    surface.setAttribute(SURFACE_ATTRIBUTE, 'true');
    surface.setAttribute('role', 'dialog');
    surface.setAttribute('aria-modal', 'true');
    surface.setAttribute('aria-label', 'AIFISHER 安全更新');
    surface.innerHTML = `
      <div class="fisherai-update-card" style="position:relative">
        <button class="fisherai-update-close" type="button" aria-label="暂不更新">×</button>
        <span class="fisherai-update-eyebrow">AIFISHER 安全更新</span>
        <h2></h2><p></p><ul></ul>
        <p class="fisherai-update-defer-copy"></p>
        <div class="fisherai-update-progress" role="progressbar" aria-label="更新进度" aria-valuemin="0" aria-valuemax="100"><span></span></div>
        <div class="fisherai-update-progress-copy"><span></span><strong></strong></div>
        <button class="fisherai-update-apply" type="button">立即更新并重启</button>
      </div>`;
    documentRoot.body.append(surface);
    surface.querySelector('.fisherai-update-card')!.append(createUpdateDownloadFallback(documentRoot));
  }
  const percent = Math.max(0, Math.min(100, event.overallPercent ?? 0));
  const ready = event.status === 'ready';
  const applying = event.status === 'applying';
  const heading = surface.querySelector('h2')!;
  const summary = surface.querySelector('p')!;
  const changes = surface.querySelector('ul')!;
  const progress = surface.querySelector<HTMLElement>('[role="progressbar"]')!;
  const progressBar = progress.querySelector<HTMLElement>('span')!;
  const progressCopy = surface.querySelector('.fisherai-update-progress-copy')!;
  const button = surface.querySelector<HTMLButtonElement>('.fisherai-update-apply')!;
  const close = surface.querySelector<HTMLButtonElement>('.fisherai-update-close')!;
  close.hidden = !dismissible || applying;
  close.onclick = dismiss;
  const deferCopy = surface.querySelector<HTMLElement>('.fisherai-update-defer-copy')!;
  deferCopy.hidden = !ready;
  deferCopy.textContent = dismissible
    ? '更新前会保存画布。可关闭此提醒继续使用，下次打开画布时需完成更新。'
    : '更新前会保存画布，完成后自动重新打开。';
  deferCopy.style.marginTop = '20px';
  const currentMessage = desktopUpdateProgressMessage(event);
  heading.textContent = ready
    ? event.title || `已准备 ${event.version || '新版本'}`
    : applying
      ? '正在安全重启'
      : '正在准备更新';
  summary.textContent = event.summary || currentMessage;
  changes.replaceChildren(
    ...(ready ? event.changes : []).map((change) => {
      const item = documentRoot.createElement('li');
      item.textContent = change;
      return item;
    }),
  );
  changes.hidden = !ready || event.changes.length === 0;
  progress.setAttribute('aria-valuenow', String(percent));
  progressBar.style.width = `${percent}%`;
  progressCopy.children[0].textContent = currentMessage;
  progressCopy.children[1].textContent = `${percent}%`;
  button.hidden = !ready && !applying;
  button.disabled = applying;
  button.textContent = applying ? '正在重启…' : '立即更新并重启';
  button.onclick = ready ? apply : null;
  if (opening) activateModal(surface, dismiss, { dismissible });
  if (ready) button.focus();
}

export function installDesktopUpdateSurface({
  bridge = createDesktopUpdateBridge(desktopBridge()),
  documentRoot = document,
  dismissible = false,
  beforeApply,
}: {
  bridge?: DesktopUpdateBridge | null;
  documentRoot?: Document;
  dismissible?: boolean;
  beforeApply?: () => void | Promise<void>;
} = {}) {
  if (!bridge) return () => undefined;
  installStyle(documentRoot);
  let disposed = false;
  let current: DesktopUpdateEvent | null = null;
  let applying = false;
  let initialCheckComplete = false;
  let requiredVersion: string | null = null;
  let dismissedVersion: string | null = null;
  const canDismiss = () =>
    dismissible && initialCheckComplete && requiredVersion === null && !applying;
  const dismiss = () => {
    if (!canDismiss()) return;
    dismissedVersion = current?.version ?? null;
    documentRoot.querySelector(`[${SURFACE_ATTRIBUTE}]`)?.remove();
  };
  const apply = async () => {
    if (!current || current.status !== 'ready') return;
    if (applying) return;
    applying = true;
    setDesktopUpdateApplying(documentRoot, true);
    current = desktopUpdateApplying(current);
    renderUpdate(
      documentRoot,
      { ...current, message: '正在保存当前画布…' },
      () => {},
      false,
      dismiss,
    );
    try {
      await beforeApply?.();
    } catch (error) {
      if (disposed) return;
      applying = false;
      setDesktopUpdateApplying(documentRoot, false);
      current = {
        ...desktopUpdateApplyFailed(current),
        message: error instanceof Error ? error.message : '画布尚未保存成功，请先保存后再更新。',
      };
      renderUpdate(documentRoot, current, apply, canDismiss(), dismiss);
      return;
    }
    if (disposed) return;
    renderUpdate(documentRoot, current, () => {}, false, dismiss);
    void bridge.invoke('update_apply').catch(() => {
      applying = false;
      if (disposed || !current) return;
      setDesktopUpdateApplying(documentRoot, false);
      current = desktopUpdateApplyFailed(current);
      renderUpdate(documentRoot, current, apply, canDismiss(), dismiss);
    });
  };
  const stopSession = startDesktopUpdateSession({
    bridge,
    checkIntervalMs: 60_000,
    onSettled: () => {
      initialCheckComplete = true;
    },
    onEvent: (event) => {
      if (applying) return;
      current = event;
      if (!initialCheckComplete && event.status === 'ready')
        requiredVersion = event.version ?? 'pending';
      if (initialCheckComplete && !['ready', 'current', 'disabled'].includes(event.status ?? ''))
        return;
      if (dismissedVersion && dismissedVersion === event.version) return;
      renderUpdate(documentRoot, event, apply, canDismiss(), dismiss);
    },
    onFailure: (event) => showFailure(documentRoot, event.message ?? '更新检查未完成。'),
  });
  return () => {
    disposed = true;
    documentRoot.querySelector(`[${SURFACE_ATTRIBUTE}]`)?.remove();
    documentRoot.querySelector(`[${TOAST_ATTRIBUTE}]`)?.remove();
    delete documentRoot.documentElement.dataset.aifisherUpdateApplying;
    stopSession();
  };
}
