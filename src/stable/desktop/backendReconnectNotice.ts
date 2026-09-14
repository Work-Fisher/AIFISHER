import { createStableElement } from '../design/dom';
import { desktopBridge, type AifisherDesktopBridge } from './desktopBridge';

const NOTICE_ATTRIBUTE = 'data-fisherai-backend-reconnecting';
const STYLE_ATTRIBUTE = 'data-fisherai-backend-reconnecting-style';

function installStyle(documentRoot: Document) {
  if (documentRoot.head.querySelector(`[${STYLE_ATTRIBUTE}]`)) return;
  const style = documentRoot.createElement('style');
  style.setAttribute(STYLE_ATTRIBUTE, 'true');
  style.textContent = `
    [${NOTICE_ATTRIBUTE}] {
      position: fixed; top: 16px; left: 50%; z-index: 2147482600; transform: translateX(-50%);
      display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px);
      padding: 10px 14px; border: 1px solid var(--af-border); border-radius: 12px;
      color: var(--af-text); background: var(--af-input); box-shadow: 0 24px 64px #0000007a;
      font: 500 13px/1.45 Inter, 'Microsoft YaHei UI', system-ui, sans-serif;
      pointer-events: none;
    }
    [${NOTICE_ATTRIBUTE}] [aria-hidden] {
      flex: none; width: 7px; height: 7px; border-radius: 9999px; background: #fbbf24;
      animation: fisherai-backend-reconnecting 1.2s ease-in-out infinite;
    }
    @keyframes fisherai-backend-reconnecting { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) {
      [${NOTICE_ATTRIBUTE}] [aria-hidden] { animation: none; }
    }
  `;
  documentRoot.head.append(style);
}

/** Non-blocking notice while the desktop shell restarts the local backend (ADR-0035). */
export function installBackendReconnectNotice({
  bridge = desktopBridge(),
  documentRoot = document,
}: {
  bridge?: Pick<AifisherDesktopBridge, 'onBackendState'> | null;
  documentRoot?: Document;
} = {}) {
  if (!bridge) return () => undefined;
  installStyle(documentRoot);
  const hide = () => documentRoot.querySelector(`[${NOTICE_ATTRIBUTE}]`)?.remove();
  const show = () => {
    if (documentRoot.querySelector(`[${NOTICE_ATTRIBUTE}]`)) return;
    const notice = createStableElement('div', '', '', documentRoot);
    notice.setAttribute(NOTICE_ATTRIBUTE, 'true');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    const mark = createStableElement('span', '', '', documentRoot);
    mark.setAttribute('aria-hidden', 'true');
    notice.append(mark, createStableElement('span', '', '正在重新连接本机服务…', documentRoot));
    documentRoot.body.append(notice);
  };
  const unsubscribe = bridge.onBackendState((state) =>
    state === 'reconnecting' ? show() : hide(),
  );
  return () => {
    unsubscribe();
    hide();
  };
}
