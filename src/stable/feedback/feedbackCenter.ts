import { createFeedbackAttachments, feedbackAttachmentButtons, type AttachmentMetadata } from './feedbackAttachments';
import { modelDisplayName } from '../../config/modelDisplayName';
import { desktopBridge } from '../desktop/desktopBridge';
import { createCanvasAccountControl } from '../account/canvasAccount';

type FetchImplementation = typeof fetch;

interface AdminOverview {
  totalUsers: number;
  newUsers24h: number;
  activeSessions: number;
  activeUsers24h: number;
  relayBoundUsers: number;
  totalFeedback: number;
  newFeedback: number;
  generatedAt: string;
}

interface AdminFeedback {
  attachments?: AttachmentMetadata[];
  id: string;
  displayName: string | null;
  content: string;
  contact: string | null;
  surface: string;
  pageContext: string | null;
  clientVersion: string | null;
  status: 'new' | 'read' | 'closed';
  createdAt: string;
}

interface AdminUser {
  id: string;
  displayName: string | null;
  status: string;
  activeSessions: number;
  createdAt: string;
}

interface AdminMonitor {
  summary: Record<string, number>;
  runtime: Record<string, number>;
  modelHealth: Array<Record<string, unknown>>;
  errorBreakdown: Array<Record<string, unknown>>;
  sourceDistribution: Array<Record<string, unknown>>;
  hourlyTrend: Array<Record<string, unknown>>;
  topUsers: Array<Record<string, unknown>>;
  recentCalls: Array<Record<string, unknown>>;
  generatedAt: string;
}

export interface FeedbackCenterAdapter {
  openFeedback(): void;
  openAdmin(): Promise<void>;
  destroy(): void;
}

const STYLE_ID = 'aifisher-feedback-center-styles';
const HOST_ATTRIBUTE = 'data-fisherai-feedback-center';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.aifisher-feedback-center{display:flex;align-items:center;gap:6px;position:relative;z-index:72;flex:none;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif}
.aifisher-feedback-trigger,.aifisher-admin-trigger{height:26px;padding:0 9px;border:1px solid var(--af-border-control);border-radius:7px;background:var(--af-surface);color:var(--af-text-secondary);font-size:10px;font-weight:650;cursor:pointer;white-space:nowrap}
.aifisher-feedback-trigger:hover,.aifisher-admin-trigger:hover{border-color:var(--af-border-control);color:var(--af-text);background:var(--af-surface)}
.aifisher-feedback-trigger:focus-visible,.aifisher-admin-trigger:focus-visible,.aifisher-feedback-dialog button:focus-visible,.aifisher-feedback-dialog textarea:focus-visible,.aifisher-feedback-dialog input:focus-visible,.aifisher-feedback-dialog select:focus-visible{outline:2px solid var(--af-border-control);outline-offset:2px}
.aifisher-feedback-overlay{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:var(--af-overlay);font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif;color:var(--af-text)}
.aifisher-feedback-dialog{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--af-border);border-radius:12px;background:var(--af-surface);box-shadow:var(--af-shadow);will-change:auto}
.aifisher-feedback-dialog[data-kind="admin"]{width:min(1120px,calc(100vw - 32px))}
.aifisher-feedback-head{display:flex;align-items:flex-start;gap:20px;padding:20px 22px;border-bottom:1px solid var(--af-border);background:var(--af-surface)}
.aifisher-feedback-heading{min-width:0;flex:1}.aifisher-feedback-heading h2{margin:0;font-size:18px;line-height:1.25}.aifisher-feedback-heading p{margin:7px 0 0;color:var(--af-text-muted);font-size:11px;line-height:1.55}
.aifisher-feedback-close{width:30px;height:30px;border:1px solid var(--af-border-control);border-radius:7px;background:var(--af-surface);color:var(--af-text-secondary);font-size:18px;cursor:pointer}
.aifisher-feedback-body{min-height:0;overflow:auto;padding:20px 22px}.aifisher-feedback-field{display:grid;gap:8px;margin-bottom:16px}.aifisher-feedback-label{color:var(--af-text);font-size:12px;font-weight:650}.aifisher-feedback-optional{color:var(--af-text-muted);font-weight:500}
.aifisher-feedback-dialog textarea,.aifisher-feedback-dialog input,.aifisher-feedback-dialog select{box-sizing:border-box;width:100%;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-input);color:var(--af-text);font:12px/1.6 Inter,"Microsoft YaHei UI",system-ui,sans-serif}
.aifisher-feedback-dialog textarea{min-height:170px;resize:vertical;padding:12px}.aifisher-feedback-dialog input,.aifisher-feedback-dialog select{height:38px;padding:0 11px}.aifisher-feedback-count{text-align:right;color:var(--af-text-muted);font-size:10px}
.aifisher-feedback-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px}.aifisher-feedback-button{min-height:36px;padding:0 15px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-surface-raised);color:var(--af-text);font-size:11px;font-weight:700;cursor:pointer}.aifisher-feedback-button[data-primary="true"]{background:var(--af-primary);color:var(--af-on-primary)}.aifisher-feedback-button:disabled{cursor:wait;opacity:.5}
.aifisher-feedback-status{min-height:18px;margin-right:auto;color:var(--af-text-muted);font-size:11px}.aifisher-feedback-status[data-error="true"]{color:var(--af-danger)}
.aifisher-admin-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:16px}.aifisher-admin-toolbar button{height:32px;padding:0 11px;border:1px solid var(--af-border-control);border-radius:7px;background:var(--af-surface);color:var(--af-text);font-size:10px;cursor:pointer}
.aifisher-admin-generated{margin-left:auto;color:var(--af-text-muted);font-size:10px}.aifisher-admin-metrics{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr));gap:8px;margin-bottom:20px}.aifisher-admin-metric{padding:13px;border:1px solid var(--af-border);border-radius:9px;background:var(--af-input)}.aifisher-admin-metric strong{display:block;font-size:21px}.aifisher-admin-metric span{display:block;margin-top:5px;color:var(--af-text-muted);font-size:9px;line-height:1.4}
.aifisher-admin-section{margin-top:18px}.aifisher-admin-section h3{margin:0 0 9px;font-size:13px}.aifisher-admin-table-wrap{overflow:auto;border:1px solid var(--af-border);border-radius:9px}.aifisher-admin-table{width:100%;border-collapse:collapse;font-size:10px}.aifisher-admin-table th,.aifisher-admin-table td{padding:10px;border-bottom:1px solid var(--af-border);text-align:left;vertical-align:top}.aifisher-admin-table th{position:sticky;top:0;background:var(--af-surface);color:var(--af-text-secondary);font-weight:650}.aifisher-admin-table td{max-width:310px;color:var(--af-text-secondary);line-height:1.5}.aifisher-admin-table tr:last-child td{border-bottom:0}.aifisher-admin-feedback-copy{white-space:pre-wrap;word-break:break-word}.aifisher-admin-empty{padding:24px;color:var(--af-text-muted);text-align:center;font-size:11px}.aifisher-admin-status{display:grid;grid-template-columns:82px auto;gap:6px;min-width:152px}.aifisher-admin-status select{height:30px;padding:0 7px;font-size:10px}.aifisher-admin-status button{height:30px;padding:0 8px;border:1px solid var(--af-border-control);border-radius:7px;background:var(--af-surface);color:var(--af-text);font-size:10px;cursor:pointer}
.aifisher-admin-code{display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;color:var(--af-danger);font:600 9px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}.aifisher-admin-subline{display:block;margin-top:3px;color:var(--af-text-muted);font-size:9px}.aifisher-admin-monitor-title{display:flex;align-items:center;gap:8px;margin:3px 0 10px;font-size:14px}.aifisher-admin-live-dot{width:7px;height:7px;border-radius:50%;background:var(--af-success);box-shadow:var(--af-shadow)}
.aifisher-admin-health{display:inline-flex;align-items:center;min-width:46px;padding:3px 7px;border:1px solid var(--af-success);border-radius:999px;background:var(--af-surface);color:var(--af-success);font-size:9px;font-weight:700;white-space:nowrap}.aifisher-admin-health[data-state="down"]{border-color:var(--af-danger);background:var(--af-danger-bg);color:var(--af-danger)}.aifisher-admin-health[data-state="degraded"]{border-color:var(--af-warning);background:var(--af-warning-bg);color:var(--af-warning)}.aifisher-admin-health[data-state="running"]{border-color:var(--af-info);background:var(--af-info-bg);color:var(--af-info)}
.aifisher-admin-operations{padding:14px;border:1px solid var(--af-border);border-radius:10px;background:var(--af-input)}.aifisher-admin-operations-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}.aifisher-admin-operations-head h3{margin:0}.aifisher-admin-icon{display:inline-flex;width:26px;height:26px;align-items:center;justify-content:center;flex:none;border:1px solid var(--af-border);border-radius:7px;background:var(--af-surface);color:var(--af-text)}.aifisher-admin-icon svg{width:14px;height:14px}.aifisher-admin-signal-rail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:hidden;border:1px solid var(--af-border);border-radius:8px;background:var(--af-input)}.aifisher-admin-signal{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:9px;min-height:62px;padding:10px 12px;border-right:1px solid var(--af-border)}.aifisher-admin-signal:last-child{border-right:0}.aifisher-admin-signal strong,.aifisher-admin-source strong{display:block;overflow:hidden;color:var(--af-text);font:600 12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.aifisher-admin-signal span,.aifisher-admin-source span{display:block;margin-top:3px;color:var(--af-text-muted);font-size:9px}.aifisher-admin-operations-grid{display:grid;grid-template-columns:minmax(280px,.9fr) minmax(360px,1.4fr);gap:10px;margin-top:10px}.aifisher-admin-compact-panel{min-width:0;padding:12px;border:1px solid var(--af-border);border-radius:8px;background:var(--af-input)}.aifisher-admin-compact-title{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:var(--af-text);font-size:10px;font-weight:700}.aifisher-admin-compact-title .aifisher-admin-icon{width:24px;height:24px}.aifisher-admin-source-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.aifisher-admin-source{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:48px;padding:7px 8px;border:1px solid var(--af-border);border-radius:7px;background:var(--af-surface)}.aifisher-admin-source[data-state="warning"]{border-color:var(--af-warning)}.aifisher-admin-source-count{color:var(--af-text);font:700 13px ui-monospace,SFMono-Regular,Consolas,monospace}.aifisher-admin-trend{height:92px;display:flex;align-items:flex-end;gap:3px;padding:9px 6px 0;border-bottom:1px solid var(--af-border);background:linear-gradient(to top,transparent 30px,var(--af-surface) 31px,transparent 32px,transparent 61px,var(--af-surface) 62px,transparent 63px)}.aifisher-admin-trend-bar{position:relative;min-width:3px;height:var(--aifisher-trend-height);flex:1;border-radius:2px 2px 0 0;background:var(--af-primary);opacity:.9}.aifisher-admin-trend-bar i{position:absolute;inset:auto 0 0;height:var(--aifisher-trend-failure);background:var(--af-danger);border-radius:0 0 2px 2px}.aifisher-admin-trend-axis{display:flex;justify-content:space-between;margin-top:6px;color:var(--af-text-muted);font:9px ui-monospace,SFMono-Regular,Consolas,monospace}.aifisher-admin-top-users{margin-top:10px;border-top:1px solid var(--af-border);padding-top:9px}.aifisher-admin-top-users summary{display:flex;align-items:center;gap:8px;color:var(--af-text-secondary);font-size:10px;cursor:pointer;list-style:none}.aifisher-admin-top-users summary::-webkit-details-marker{display:none}.aifisher-admin-user-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.aifisher-admin-user{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--af-border);border-radius:999px;background:var(--af-surface);color:var(--af-text-secondary);font-size:9px}.aifisher-admin-user .aifisher-admin-icon{width:20px;height:20px;border:0;background:transparent}.aifisher-admin-user b{font:700 10px ui-monospace,SFMono-Regular,Consolas,monospace}.aifisher-admin-compact-empty{padding:18px;color:var(--af-text-muted);text-align:center;font-size:10px}
@media(max-width:1000px){.aifisher-admin-metrics{grid-template-columns:repeat(3,minmax(110px,1fr))}.aifisher-admin-operations-grid{grid-template-columns:1fr}}@media(max-width:620px){.aifisher-feedback-overlay{padding:12px}.aifisher-feedback-body,.aifisher-feedback-head{padding:16px}.aifisher-admin-metrics{grid-template-columns:repeat(2,minmax(100px,1fr))}.aifisher-admin-generated{display:none}.aifisher-admin-signal-rail{grid-template-columns:repeat(2,minmax(0,1fr))}.aifisher-admin-signal:nth-child(2){border-right:0}.aifisher-admin-signal:nth-child(-n+2){border-bottom:1px solid var(--af-border)}.aifisher-admin-source-list{grid-template-columns:1fr}}
`;
  document.head.append(style);
}

// 反馈入口停在 ComfyUI 状态左侧；没有 ComfyUI 状态时停在顶栏账户中心插槽左侧。
function dock(host: HTMLElement, root: ParentNode) {
  const dashboard = root.querySelector<HTMLElement>('[data-fisherai-feedback-center-slot="true"]');
  if (dashboard) {
    if (host.parentElement !== dashboard) dashboard.append(host);
    return;
  }
  const account = root.querySelector<HTMLElement>('[data-fisherai-account-center-slot="true"]');
  const toolbar = account?.parentElement;
  if (!account || !toolbar) return;
  const comfy = toolbar.querySelector<HTMLElement>(
    ':scope > [data-fisherai-comfyui-log-host="true"]',
  );
  const target = comfy || account;
  if (host.parentElement !== toolbar || host.nextElementSibling !== target)
    toolbar.insertBefore(host, target);
}

function readableError(code: string, fallback: string) {
  const messages: Record<string, string> = {
    FEEDBACK_RATE_LIMITED: '提交得有点频繁，请稍后再试。',
    INVALID_FEEDBACK: '请检查反馈内容后重试。',
    INVALID_SESSION: '云端身份暂不可用，反馈内容已保留，请稍后重试。',
    REMOTE_AUTHENTICATION_UNAVAILABLE: '云端身份连接尚未恢复，反馈内容已保留，请稍后重试。',
    IDENTITY_ACCOUNT_UNAVAILABLE: '暂未确认收到反馈，内容已保留，请稍后重试。',
    IDENTITY_TEMPORARILY_UNAVAILABLE: '反馈服务暂时不可用，内容已保留，请稍后重试。',
    ADMIN_REQUIRED: '当前账号没有管理员权限。',
  };
  return messages[code] || fallback;
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function createDialog(
  kind: 'feedback' | 'admin',
  titleText: string,
  descriptionText: string,
  restoreFocus: HTMLElement | null,
) {
  const overlay = node('div', 'aifisher-feedback-overlay');
  overlay.dataset.fisheraiFeedbackOverlay = kind;
  const dialog = node('section', 'aifisher-feedback-dialog');
  dialog.dataset.kind = kind;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const head = node('header', 'aifisher-feedback-head');
  const heading = node('div', 'aifisher-feedback-heading');
  const title = node('h2', '', titleText);
  const description = node('p', '', descriptionText);
  heading.append(title, description);
  const close = node('button', 'aifisher-feedback-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  const body = node('div', 'aifisher-feedback-body');
  head.append(heading, close);
  dialog.append(head, body);
  overlay.append(dialog);
  const dismiss = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    restoreFocus?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss();
  };
  close.addEventListener('click', dismiss);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) dismiss();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.append(overlay);
  close.focus();
  return { overlay, body, close, dismiss };
}

function formatDate(value: unknown) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : '—';
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function modelHealthState(item: Record<string, unknown>) {
  const failures = number(item.failures);
  const calls = number(item.calls);
  const lastError = Date.parse(String(item.last_error_at || ''));
  const lastSuccess = Date.parse(String(item.last_success_at || ''));
  if (number(item.active)) return { label: '运行中', state: 'running' };
  if (failures && lastSuccess > lastError) return { label: '已恢复', state: 'recovered' };
  if (failures && (lastError >= lastSuccess || failures / calls >= 0.5))
    return { label: String(item.failure_category || '调用失败，原因待确认'), state: 'degraded' };
  if (failures) return { label: '历史失败', state: 'degraded' };
  return { label: '正常', state: 'healthy' };
}

function formatDuration(value: unknown) {
  const milliseconds = number(value);
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000)
    return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${(milliseconds / 60_000).toFixed(1)}min`;
}

function formatBytes(value: unknown) {
  let size = number(value);
  let index = 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  while (size >= 1_024 && index < units.length - 1) {
    size /= 1_024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function sourceLabel(value: unknown) {
  const labels: Record<string, string> = {
    aifisher_relay: 'AIFISHER 中转',
    runninghub_cn: 'RH CN站',
    runninghub_ai: 'RH AI站',
    dreamina_cli: '即梦 CLI',
    comfyui_local: '本机 ComfyUI',
    volcengine_official: '火山方舟',
    google_official: 'Google 官方',
    deepseek_official: 'DeepSeek 官方',
  };
  return labels[String(value || '')] || String(value || '未知来源');
}

type AdminIconName = 'activity' | 'memory' | 'heap' | 'database' | 'source' | 'trend' | 'user';

const ADMIN_ICON_PATHS: Record<AdminIconName, string[]> = {
  activity: ['M4 13a8 8 0 1 0 2.3-5.7', 'M4 4v5h5', 'M12 8v5l3 2'],
  memory: ['M7 7h10v10H7z', 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3'],
  heap: ['m5 8 7-4 7 4-7 4-7-4Z', 'm5 12 7 4 7-4', 'm5 16 7 4 7-4'],
  database: [
    'M4 6c0-2 16-2 16 0s-16 2-16 0Z',
    'M4 6v6c0 2 16 2 16 0V6',
    'M4 12v6c0 2 16 2 16 0v-6',
  ],
  source: ['M6 5h6a4 4 0 0 1 4 4v10', 'm13 16 3 3 3-3', 'M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  trend: ['M4 18V6', 'M4 18h16', 'm7 14 4-4 3 2 5-6'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
};

function adminIcon(name: AdminIconName): HTMLSpanElement {
  const wrap = node('span', 'aifisher-admin-icon');
  wrap.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  ADMIN_ICON_PATHS[name].forEach((data) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    svg.append(path);
  });
  wrap.append(svg);
  return wrap;
}

function signal(label: string, value: string, iconName: AdminIconName): HTMLElement {
  const item = node('article', 'aifisher-admin-signal');
  item.dataset.fisheraiAdminSignal = iconName;
  const copy = node('div');
  copy.append(node('strong', '', value), node('span', '', label));
  item.append(adminIcon(iconName), copy);
  return item;
}

function compactTitle(label: string, iconName: AdminIconName): HTMLElement {
  const title = node('div', 'aifisher-admin-compact-title');
  title.append(adminIcon(iconName), node('span', '', label));
  return title;
}

export function installFeedbackCenter({
  fetchImpl = window.fetch.bind(window),
  root = document,
}: { fetchImpl?: FetchImplementation; root?: ParentNode } = {}): FeedbackCenterAdapter {
  installStyles();
  let adminRefreshTimer: number | null = null;
  const host = node('div', 'aifisher-feedback-center');
  host.setAttribute(HOST_ATTRIBUTE, 'true');
  const feedbackTrigger = node('button', 'aifisher-feedback-trigger', '意见反馈');
  feedbackTrigger.type = 'button';
  feedbackTrigger.dataset.fisheraiFeedbackTrigger = 'true';
  const adminTrigger = node('button', 'aifisher-admin-trigger', '管理后台');
  adminTrigger.type = 'button';
  adminTrigger.hidden = true;
  adminTrigger.dataset.fisheraiAdminTrigger = 'true';
  host.append(feedbackTrigger, adminTrigger);
  const accountControl = createCanvasAccountControl(trigger => createDialog('feedback', 'AIFISHER 账号',
    '登录可关联反馈，本地创作随时继续。', trigger));
  if (accountControl) host.append(accountControl.button);
  document.body.append(host);

  const openFeedback = () => {
    const dialog = createDialog(
      'feedback',
      '意见反馈',
      '反馈与提交时的账号关联，未登录时关联当前设备。需要回复时请留下联系方式。',
      feedbackTrigger,
    );
    const contentField = node('label', 'aifisher-feedback-field');
    contentField.append(node('span', 'aifisher-feedback-label', '反馈内容'));
    const textarea = node('textarea');
    textarea.maxLength = 4_000;
    textarea.placeholder = '请尽量说明出现问题前做了什么、实际结果和期望结果…';
    const count = node('span', 'aifisher-feedback-count', '0 / 4000');
    textarea.addEventListener('input', () => {
      count.textContent = `${textarea.value.length} / 4000`;
    });
    contentField.append(textarea, count);
    const attachments = createFeedbackAttachments(dialog.body);
    const contactField = node('label', 'aifisher-feedback-field');
    const contactLabel = node('span', 'aifisher-feedback-label', '联系方式 ');
    contactLabel.append(node('span', 'aifisher-feedback-optional', '（选填）'));
    const contact = node('input');
    contact.maxLength = 200;
    contact.placeholder = '邮箱、微信或其他联系方式';
    contactField.append(contactLabel, contact);
    const actions = node('div', 'aifisher-feedback-actions');
    const status = node('div', 'aifisher-feedback-status');
    status.setAttribute('role', 'status');
    const cancel = node('button', 'aifisher-feedback-button', '取消');
    cancel.type = 'button';
    const submit = node('button', 'aifisher-feedback-button', '提交反馈');
    submit.type = 'button';
    submit.dataset.primary = 'true';
    cancel.addEventListener('click', dialog.dismiss);
    submit.addEventListener('click', () => {
      void (async () => {
        const normalized = textarea.value.trim().normalize('NFC');
        if (!normalized) {
          status.textContent = '请先填写反馈内容。';
          status.dataset.error = 'true';
          textarea.focus();
          return;
        }
        submit.disabled = true;
        cancel.disabled = true;
        status.textContent = '正在提交…';
        delete status.dataset.error;
        try {
          attachments.root.disabled = true;
          const accountBridge = desktopBridge()?.account;
          const submittingAccount = accountBridge ? await accountBridge.status() : null;
          const files = await attachments.read();
          const feedbackBody = {
            content: normalized,
            ...(files.length ? { attachments: files } : {}),
            ...(contact.value.trim() ? { contact: contact.value.trim().normalize('NFC') } : {}),
            surface: 'canvas', pageContext: window.location.pathname,
            clientVersion: document.documentElement.dataset.fisheraiBuild || '1.0.0',
          };
          const remote = accountBridge ? await accountBridge.submitFeedback(feedbackBody, submittingAccount!.userId) : null;
          const response = remote ? new Response(JSON.stringify(remote.payload), { status: remote.status }) : await fetchImpl('/api/auth/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feedbackBody),
          });
          const payload = await responsePayload(response);
          if (!response.ok)
            throw new Error(
              readableError(String(payload.code || ''), '反馈提交失败，请稍后重试。'),
            );
          if (files.length && payload.attachmentCount !== files.length) throw new Error('服务器尚未确认附件已保存，内容已保留。');
          status.textContent = '反馈已提交，谢谢。';
          window.setTimeout(dialog.dismiss, 650);
        } catch (error) {
          status.textContent =
            error instanceof Error ? error.message : '反馈提交失败，请稍后重试。';
          status.dataset.error = 'true';
          attachments.root.disabled = false;
          submit.disabled = false;
          cancel.disabled = false;
        }
      })();
    });
    actions.append(status, cancel, submit);
    dialog.body.append(contentField, attachments.root, contactField, actions);
    textarea.focus();
  };

  const openAdmin = async () => {
    const desktop = desktopBridge();
    if (desktop?.openAdmin) {
      try { await desktop.openAdmin(); }
      catch { createDialog('admin', '管理后台暂未打开', '请检查网络和安装配置后重试。管理员仍需在管理页面独立登录。', adminTrigger); }
      return;
    }
    const dialog = createDialog(
      'admin',
      'AIFISHER 管理后台',
      '查看实时模型调用、错误、账号、API 绑定覆盖和用户反馈。权限、密钥与数据库连接始终只保留在服务端。',
      adminTrigger,
    );
    const toolbar = node('div', 'aifisher-admin-toolbar');
    const refresh = node('button', '', '刷新数据');
    refresh.type = 'button';
    const loading = node('span', 'aifisher-feedback-status', '正在读取服务端数据…');
    const generated = node('span', 'aifisher-admin-generated');
    toolbar.append(refresh, loading, generated);
    const content = node('div');
    dialog.body.append(toolbar, content);

    const renderTable = (headers: string[], rows: HTMLElement[][], empty: string) => {
      const wrap = node('div', 'aifisher-admin-table-wrap');
      if (!rows.length) {
        wrap.append(node('div', 'aifisher-admin-empty', empty));
        return wrap;
      }
      const table = node('table', 'aifisher-admin-table');
      const head = node('thead');
      const headRow = node('tr');
      headers.forEach((label) => headRow.append(node('th', '', label)));
      head.append(headRow);
      const body = node('tbody');
      rows.forEach((cells) => {
        const row = node('tr');
        cells.forEach((cell) => row.append(cell));
        body.append(row);
      });
      table.append(head, body);
      wrap.append(table);
      return wrap;
    };

    let adminLoading = false;
    const load = async (silent = false) => {
      if (adminLoading) return;
      adminLoading = true;
      refresh.disabled = true;
      if (!silent) loading.textContent = '正在读取服务端数据…';
      delete loading.dataset.error;
      try {
        const [monitorResponse, overviewResponse, feedbackResponse, usersResponse] =
          await Promise.all([
            fetchImpl('/api/auth/admin/monitor', { cache: 'no-store' }),
            fetchImpl('/api/auth/admin/overview', { cache: 'no-store' }),
            fetchImpl('/api/auth/admin/feedback?limit=100', { cache: 'no-store' }),
            fetchImpl('/api/auth/admin/users?limit=100', { cache: 'no-store' }),
          ]);
        const responses = [monitorResponse, overviewResponse, feedbackResponse, usersResponse];
        if (!responses.every((response) => response.ok)) {
          const failed = responses.find((response) => !response.ok)!;
          const payload = await responsePayload(failed);
          throw new Error(readableError(String(payload.code || ''), '管理数据读取失败。'));
        }
        const monitor = (await monitorResponse.json()) as AdminMonitor;
        const overview = (await overviewResponse.json()) as AdminOverview;
        const feedback = ((await feedbackResponse.json()) as { items: AdminFeedback[] }).items;
        const users = ((await usersResponse.json()) as { items: AdminUser[] }).items;
        content.replaceChildren();

        const monitorTitle = node('h3', 'aifisher-admin-monitor-title');
        monitorTitle.append(
          node('span', 'aifisher-admin-live-dot'),
          node('span', '', '模型实时监控'),
        );
        content.append(monitorTitle);
        const liveMetrics = node('section', 'aifisher-admin-metrics');
        const liveMetricValues: Array<[string, string]> = [
          ['最近 60 秒调用', String(number(monitor.summary.calls60s))],
          ['当前运行中', String(number(monitor.summary.activeCalls))],
          ['24H 总调用', String(number(monitor.summary.calls24h))],
          ['24H 失败', String(number(monitor.summary.failures24h))],
          ['P95 响应', formatDuration(monitor.summary.p95DurationMs)],
          ['5 分钟活跃用户', String(number(monitor.summary.activeUsers5m))],
          ['平均响应', formatDuration(monitor.summary.averageDurationMs)],
        ];
        liveMetricValues.forEach(([label, value]) => {
          const card = node('article', 'aifisher-admin-metric');
          card.append(node('strong', '', value), node('span', '', label));
          liveMetrics.append(card);
        });
        content.append(liveMetrics);

        const sublineCell = (primary: unknown, secondary: unknown) => {
          const cell = node('td', '', String(primary || '—'));
          cell.append(node('span', 'aifisher-admin-subline', String(secondary || '—')));
          return cell;
        };
        const errorCell = (code: unknown, summary: unknown) => {
          const cell = node('td');
          if (!code) {
            cell.textContent = '—';
            return cell;
          }
          cell.append(
            node('code', 'aifisher-admin-code', String(code)),
            node('span', 'aifisher-admin-subline', String(summary || '—')),
          );
          return cell;
        };

        const healthSection = node('section', 'aifisher-admin-section');
        healthSection.append(node('h3', '', `模型健康（${monitor.modelHealth.length}）`));
        healthSection.append(
          renderTable(
            ['状态', '模型', '来源 / 提供方', '调用', '失败', '运行中', 'P95', '最近错误'],
            monitor.modelHealth.map((item) => {
              const health = modelHealthState(item);
              const statusCell = node('td');
              const status = node('span', 'aifisher-admin-health', health.label);
              status.dataset.state = health.state;
              statusCell.append(status);
              return [
                statusCell,
                sublineCell(modelDisplayName(item.model_name, item.model_id), item.model_id),
                node('td', '', `${sourceLabel(item.source)} · ${String(item.provider || '—')}`),
                node('td', '', String(number(item.calls))),
                node('td', '', String(number(item.failures))),
                node('td', '', String(number(item.active))),
                node('td', '', formatDuration(item.p95_duration_ms)),
                errorCell(item.last_error_code, `${item.failure_category || '原因待确认'}：${item.last_error_summary || ''}`),
              ];
            }),
            '暂时没有模型调用数据。',
          ),
        );
        content.append(healthSection);

        const callsSection = node('section', 'aifisher-admin-section');
        callsSection.append(node('h3', '', `最近调用（${monitor.recentCalls.length}）`));
        callsSection.append(
          renderTable(
            ['时间', '状态', '模型', '来源 / 操作', '耗时', '用户', '错误'],
            monitor.recentCalls.map((item) => [
              node('td', '', formatDate(item.created_at)),
              node('td', '', String(item.status || 'unknown')),
              sublineCell(modelDisplayName(item.model_name, item.model_id), item.model_id),
              node(
                'td',
                '',
                `${sourceLabel(item.source)} · ${String(item.category || '—')}/${String(item.operation || '—')}`,
              ),
              node('td', '', item.duration_ms == null ? '—' : formatDuration(item.duration_ms)),
              node('td', '', String(item.display_name || item.user_id || '—')),
              errorCell(item.error_code, item.error_summary),
            ]),
            '暂时没有最近调用。',
          ),
        );
        content.append(callsSection);

        const errorsSection = node('section', 'aifisher-admin-section');
        errorsSection.append(node('h3', '', `错误聚合（${monitor.errorBreakdown.length}）`));
        errorsSection.append(
          renderTable(
            ['错误码', '模型 / 来源', '次数', '影响用户', '最近发生', '摘要'],
            monitor.errorBreakdown.map((item) => [
              node('td', 'aifisher-admin-code', String(item.error_code || 'UNKNOWN')),
              node(
                'td',
                '',
                `${modelDisplayName(item.model_name, item.model_id)} · ${sourceLabel(item.source)}`,
              ),
              node('td', '', String(number(item.occurrences))),
              node('td', '', String(number(item.affected_users))),
              node('td', '', formatDate(item.last_seen_at)),
              node('td', '', `${item.failure_category || '原因待确认'}：${item.last_summary || '—'}`),
            ]),
            '暂时没有错误记录。',
          ),
        );
        content.append(errorsSection);

        const sourcesSection = node('section', 'aifisher-admin-section aifisher-admin-operations');
        sourcesSection.dataset.fisheraiAdminOperations = 'true';
        const operationsHead = node('div', 'aifisher-admin-operations-head');
        operationsHead.append(adminIcon('activity'), node('h3', '', '运行概览'));
        const signalRail = node('div', 'aifisher-admin-signal-rail');
        signalRail.append(
          signal(
            '服务运行',
            formatDuration(number(monitor.runtime.uptimeSeconds) * 1_000),
            'activity',
          ),
          signal('RSS 内存', formatBytes(monitor.runtime.rssBytes), 'memory'),
          signal('Heap 已用', formatBytes(monitor.runtime.heapUsedBytes), 'heap'),
          signal('Identity 数据库', formatBytes(monitor.runtime.databaseSizeBytes), 'database'),
        );

        const operationsGrid = node('div', 'aifisher-admin-operations-grid');
        const sourcesPanel = node('article', 'aifisher-admin-compact-panel');
        sourcesPanel.append(
          compactTitle(`调用来源（${monitor.sourceDistribution.length}）`, 'source'),
        );
        const sourceList = node('div', 'aifisher-admin-source-list');
        if (!monitor.sourceDistribution.length) {
          sourceList.append(node('div', 'aifisher-admin-compact-empty', '暂无来源调用。'));
        } else {
          monitor.sourceDistribution.forEach((item) => {
            const sourceItem = node('div', 'aifisher-admin-source');
            sourceItem.dataset.fisheraiAdminSource = String(item.source || 'unknown');
            if (number(item.failures) > 0) sourceItem.dataset.state = 'warning';
            const copy = node('div');
            copy.append(
              node('strong', '', sourceLabel(item.source)),
              node(
                'span',
                '',
                `${number(item.failures)} 失败 · 均值 ${formatDuration(item.average_duration_ms)}`,
              ),
            );
            sourceItem.append(
              adminIcon('source'),
              copy,
              node('b', 'aifisher-admin-source-count', String(number(item.calls))),
            );
            sourceList.append(sourceItem);
          });
        }
        sourcesPanel.append(sourceList);

        const trendPanel = node('article', 'aifisher-admin-compact-panel');
        trendPanel.append(compactTitle('24 小时调用趋势', 'trend'));
        const trend = node('div', 'aifisher-admin-trend');
        const trendItems = monitor.hourlyTrend.slice(-24);
        if (!trendItems.length) {
          trend.append(node('div', 'aifisher-admin-compact-empty', '暂无趋势数据。'));
        } else {
          const maximum = Math.max(1, ...trendItems.map((item) => number(item.calls)));
          trendItems.forEach((item) => {
            const calls = number(item.calls);
            const failures = number(item.failures);
            const bar = node('span', 'aifisher-admin-trend-bar');
            bar.dataset.fisheraiAdminTrendBar = 'true';
            bar.style.setProperty(
              '--aifisher-trend-height',
              `${Math.max(4, Math.round((calls / maximum) * 82))}px`,
            );
            bar.style.setProperty(
              '--aifisher-trend-failure',
              `${Math.round((failures / Math.max(1, calls)) * 100)}%`,
            );
            bar.title = `${formatDate(item.hour)} · ${calls} 次 · ${failures} 失败`;
            bar.setAttribute('role', 'img');
            bar.setAttribute('aria-label', bar.title);
            bar.append(node('i'));
            trend.append(bar);
          });
        }
        const trendAxis = node('div', 'aifisher-admin-trend-axis');
        trendAxis.append(node('span', '', '24 小时前'), node('span', '', '现在'));
        trendPanel.append(trend, trendAxis);
        operationsGrid.append(sourcesPanel, trendPanel);

        const topUsers = node('details', 'aifisher-admin-top-users');
        topUsers.dataset.fisheraiAdminTopUsers = 'true';
        const topUsersSummary = node('summary');
        topUsersSummary.append(
          adminIcon('user'),
          node('span', '', `高频用户（${monitor.topUsers.length}）`),
        );
        const userList = node('div', 'aifisher-admin-user-list');
        monitor.topUsers.forEach((item) => {
          const user = node('span', 'aifisher-admin-user');
          user.append(
            adminIcon('user'),
            node('span', '', String(item.display_name || item.user_id || '未知用户')),
            node('b', '', String(number(item.calls))),
          );
          userList.append(user);
        });
        if (!monitor.topUsers.length) {
          userList.append(node('div', 'aifisher-admin-compact-empty', '暂无高频用户。'));
        }
        topUsers.append(topUsersSummary, userList);
        sourcesSection.append(operationsHead, signalRail, operationsGrid, topUsers);
        content.append(sourcesSection);

        const metrics = node('section', 'aifisher-admin-metrics');
        const metricValues: Array<[string, number]> = [
          ['账号总数', overview.totalUsers],
          ['24 小时新账号', overview.newUsers24h],
          ['有效会话', overview.activeSessions],
          ['24 小时活跃用户', overview.activeUsers24h],
          ['已绑定中转 API', overview.relayBoundUsers],
          ['反馈总数', overview.totalFeedback],
          ['待处理反馈', overview.newFeedback],
        ];
        metricValues.forEach(([label, value]) => {
          const card = node('article', 'aifisher-admin-metric');
          card.append(node('strong', '', String(value)), node('span', '', label));
          metrics.append(card);
        });
        content.append(metrics);

        const feedbackSection = node('section', 'aifisher-admin-section');
        feedbackSection.append(node('h3', '', `最近反馈（${feedback.length}）`));
        const feedbackRows = feedback.map((item) => {
          const action = node('div', 'aifisher-admin-status');
          const select = node('select');
          (
            [
              ['new', '待处理'],
              ['read', '已读'],
              ['closed', '已关闭'],
            ] as const
          ).forEach(([value, label]) => {
            const option = node('option', '', label);
            option.value = value;
            option.selected = value === item.status;
            select.append(option);
          });
          const save = node('button', '', '更新');
          save.type = 'button';
          save.addEventListener('click', () => {
            void (async () => {
              save.disabled = true;
              try {
                const response = await fetchImpl(
                  `/api/auth/admin/feedback/${encodeURIComponent(item.id)}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: select.value }),
                  },
                );
                if (!response.ok) throw new Error('反馈状态更新失败。');
                save.textContent = '已更新';
              } catch {
                save.textContent = '重试';
              } finally {
                save.disabled = false;
              }
            })();
          });
          action.append(select, save);
          return [
            node('td', '', item.displayName || '未设置昵称'),
            (() => {
              const cell = node('td', 'aifisher-admin-feedback-copy', item.content);
              cell.append(feedbackAttachmentButtons(item.attachments || [], async index => {
                const response = await fetchImpl(`/api/auth/admin/feedback/${encodeURIComponent(item.id)}/attachments/${index}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('Attachment unavailable');
                return response.json();
              }));
              return cell;
            })(),
            node(
              'td',
              '',
              [item.surface, item.contact, item.clientVersion].filter(Boolean).join(' · ') || '—',
            ),
            node('td', '', formatDate(item.createdAt)),
            (() => {
              const cell = node('td');
              cell.append(action);
              return cell;
            })(),
          ];
        });
        feedbackSection.append(
          renderTable(
            ['用户', '内容', '来源 / 联系方式', '时间', '状态'],
            feedbackRows,
            '还没有用户反馈。',
          ),
        );
        content.append(feedbackSection);

        const usersSection = node('section', 'aifisher-admin-section');
        usersSection.append(node('h3', '', `最近账号（${users.length}）`));
        usersSection.append(
          renderTable(
            ['用户名', '账号标识', '状态', '有效会话', '注册时间'],
            users.map((user) => [
              node('td', '', user.displayName || '未设置昵称'),
              node('td', '', user.id),
              node('td', '', user.status),
              node('td', '', String(user.activeSessions)),
              node('td', '', formatDate(user.createdAt)),
            ]),
            '还没有账号数据。',
          ),
        );
        content.append(usersSection);
        loading.textContent = '数据已更新';
        generated.textContent = `服务端快照：${formatDate(monitor.generatedAt || overview.generatedAt)} · 5 秒自动刷新`;
      } catch (error) {
        loading.textContent = error instanceof Error ? error.message : '管理数据读取失败。';
        loading.dataset.error = 'true';
      } finally {
        refresh.disabled = false;
        adminLoading = false;
      }
    };
    refresh.addEventListener('click', () => {
      void load();
    });
    await load();
    if (adminRefreshTimer !== null) window.clearInterval(adminRefreshTimer);
    adminRefreshTimer = window.setInterval(() => {
      if (!dialog.overlay.isConnected) {
        if (adminRefreshTimer !== null) window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = null;
        return;
      }
      if (document.visibilityState === 'visible') void load(true);
    }, 5_000);
  };

  feedbackTrigger.addEventListener('click', openFeedback);
  adminTrigger.addEventListener('click', () => {
    void openAdmin();
  });
  const observer = new MutationObserver(() => dock(host, root));
  observer.observe(root === document ? document.body : root, { childList: true, subtree: true });
  dock(host, root);
  let destroyed = false;
  let checkingSession = false;
  let refreshPending = false;
  let sessionRetry: number | null = null;
  let failures = 0;
  const clearSessionRetry = () => {
    if (sessionRetry !== null) window.clearTimeout(sessionRetry);
    sessionRetry = null;
  };
  const checkAdminSession = async () => {
    if (destroyed) return;
    if (desktopBridge()?.openAdmin) {
      adminTrigger.hidden = false;
      return;
    }
    if (checkingSession) {
      refreshPending = true;
      return;
    }
    clearSessionRetry();
    checkingSession = true;
    let retry = false;
    try {
      const response = await fetchImpl('/api/auth/admin/session', { cache: 'no-store' });
      const payload = await responsePayload(response);
      if (destroyed) return;
      adminTrigger.hidden = !(
        response.ok &&
        payload.administrator === true &&
        Array.isArray(payload.roles) &&
        payload.roles.includes('admin')
      );
      retry = response.status >= 500 || response.status === 429;
    } catch {
      if (destroyed) return;
      adminTrigger.hidden = true;
      retry = true;
    } finally {
      checkingSession = false;
      if (!destroyed && refreshPending) {
        refreshPending = false;
        void checkAdminSession();
      } else if (!destroyed) {
        failures = retry ? failures + 1 : 0;
        if (retry && failures <= 3) {
          sessionRetry = window.setTimeout(() => {
            void checkAdminSession();
          }, 5_000 * failures);
        }
      }
    }
  };
  const refreshAdminSession = () => {
    if (document.visibilityState === 'hidden') return;
    failures = 0;
    void checkAdminSession();
  };
  window.addEventListener('focus', refreshAdminSession);
  window.addEventListener('online', refreshAdminSession);
  void checkAdminSession();

  return Object.freeze({
    openFeedback,
    openAdmin,
    destroy() {
      accountControl?.destroy();
      destroyed = true;
      clearSessionRetry();
      window.removeEventListener('focus', refreshAdminSession);
      window.removeEventListener('online', refreshAdminSession);
      if (adminRefreshTimer !== null) window.clearInterval(adminRefreshTimer);
      observer.disconnect();
      host.remove();
      document
        .querySelectorAll('[data-fisherai-feedback-overlay]')
        .forEach((element) => element.remove());
    },
  });
}
import { createStableElement as node } from '../design/dom';
