import { modelDisplayName } from '../../config/modelDisplayName';

type BillingClassification = 'actual' | 'estimate' | 'preauthorization' | 'pending' | 'unknown';

interface RelayBalance {
  status: 'available' | 'stale' | 'unknown';
  amount: number | null;
  currency: string | null;
  observedAt: string | null;
  errorCode?: string | null;
}

interface RelayActivity {
  id: string;
  model: string;
  source: string;
  kind: string;
  status: string;
  taskReference: string | null;
  billing: {
    classification: BillingClassification;
    amount: number | null;
    currency: string | null;
    evidence: string;
  };
  failure: { code: string; message: string; retryable: boolean } | null;
  updatedAt: string;
}

interface RelayAccountSnapshot {
  mappingStatus: string;
  balance: RelayBalance;
  activities: RelayActivity[];
  capabilities?: { selfServiceBinding?: boolean };
}

export interface RelayAccountCenterAdapter {
  refresh(): Promise<void>;
  open(): void;
  close(): void;
  destroy(): void;
}

declare global {
  interface Window {
    __FISHERAI_RELAY_ACCOUNT__?: RelayAccountCenterAdapter;
  }
}

const ENDPOINT = '/api/account/relay';
const RELAY_SITE_URL = 'https://api.work-fisher.com/';
const RELAY_BINDING_CHANGED_EVENT = 'aifisher:relay-binding-changed';
const POLL_INTERVAL_MS = 30_000;
const BILLING_LABELS: Record<BillingClassification, string> = {
  actual: '实扣',
  estimate: '估算',
  preauthorization: '预授权',
  pending: '待结算',
  unknown: '暂无实扣明细',
};
const STATUS_LABELS: Record<string, string> = {
  loading: '进行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  conflict: '结算异常',
  unknown: '状态待确认',
};
const EVIDENCE_LABELS: Record<string, string> = {
  'final-settlement-receipt': '已取得最终结算记录',
  'final-receipt-unavailable': '该历史任务未带回可验证的终态实扣；余额变化不能准确归属本次任务',
  'final-receipt-awaiting-task-reference': '结算记录正在匹配任务',
  'catalog-estimate': '按目录价格估算，不是实际扣费',
  'task-state': '任务进行中，等待结算',
  'receipt-conflict': '结算记录不一致，暂不显示实际扣费',
  'invalid-state': '结算状态暂不可用',
};

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null || !Number.isFinite(amount)) return '--';
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        maximumFractionDigits: 4,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(amount);
}

function formatTime(value: string | null): string {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未同步';
}

function installStyles() {
  if (document.getElementById('aifisher-relay-account-styles')) return;
  const style = document.createElement('style');
  style.id = 'aifisher-relay-account-styles';
  style.textContent = `
.aifisher-account-center{position:relative;pointer-events:auto;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif}
.aifisher-account-trigger{min-height:26px;padding:4px 9px;border:1px solid var(--af-border-control);border-radius:999px;background:var(--af-surface);color:var(--af-text);font-size:10px;font-weight:650;line-height:1;cursor:pointer}
.aifisher-account-trigger:hover,.aifisher-account-trigger:focus-visible{border-color:var(--af-border-control);color:var(--af-text);outline:none}
.aifisher-account-trigger:focus-visible,.aifisher-account-refresh:focus-visible,.aifisher-account-bind-button:focus-visible,.aifisher-account-unbind:focus-visible,.aifisher-account-key:focus-visible,.aifisher-account-site:focus-visible,.aifisher-account-activities-toggle:focus-visible,.aifisher-account-delete:focus-visible,.aifisher-account-delete-cancel:focus-visible,.aifisher-account-delete-apply:focus-visible{box-shadow:0 0 0 2px var(--af-surface),0 0 0 4px var(--af-focus);outline:none}
.aifisher-account-panel{position:absolute;right:0;top:calc(100% + 9px);z-index:230;display:flex;flex-direction:column;width:min(360px,calc(100vw - 24px));max-height:min(580px,calc(100vh - 82px));overflow:hidden;border:1px solid var(--af-border);border-radius:12px;background:var(--af-surface);color:var(--af-text);box-shadow:var(--af-shadow);will-change:auto}
.aifisher-account-panel[hidden]{display:none}
.aifisher-account-head{display:grid;flex:none;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:16px;border-bottom:1px solid var(--af-border);background:var(--af-surface)}
.aifisher-account-heading{display:contents}
.aifisher-account-caption{grid-column:1/-1}
.aifisher-account-actions{grid-column:2;grid-row:1;display:flex;align-items:center;gap:6px}
.aifisher-account-actions .aifisher-account-refresh,.aifisher-account-actions .aifisher-account-site{display:inline-flex;align-items:center;justify-content:center;flex:none;white-space:nowrap;min-height:28px;padding:4px 8px;margin:0;border:1px solid var(--af-border);border-radius:7px;background:var(--af-surface-raised);font-size:11px;line-height:18px;text-decoration:none}
.aifisher-account-title{margin:0;font-size:14px;font-weight:720}
.aifisher-account-caption{margin:5px 0 0;color:var(--af-text-muted);font-size:10px;line-height:1.45}
.aifisher-account-refresh{margin-left:auto;min-height:30px;padding:5px 9px;border:1px solid var(--af-border);border-radius:8px;background:var(--af-surface-raised);color:var(--af-text);font-size:10px;cursor:pointer}
.aifisher-account-refresh:disabled{cursor:wait;opacity:.55}
.aifisher-account-balance{flex:none;padding:16px;border-bottom:1px solid var(--af-border)}
.aifisher-account-balance-label{color:var(--af-text-secondary);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.aifisher-account-balance-value{margin-top:5px;font-size:25px;font-weight:750;letter-spacing:-.03em}
.aifisher-account-balance-meta{margin-top:6px;color:var(--af-text-muted);font-size:10px}
.aifisher-account-balance-meta[data-state="stale"],.aifisher-account-error{color:var(--af-warning)}
.aifisher-account-binding{display:grid;flex:none;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:14px 16px;border-bottom:1px solid var(--af-border);background:var(--af-input)}
.aifisher-account-binding[hidden]{display:none}
.aifisher-account-binding-intro{grid-column:1/-1;display:flex;align-items:start;justify-content:space-between;gap:12px}
.aifisher-account-binding-label{min-width:0;color:var(--af-text-secondary);font-size:10px;line-height:1.5}
.aifisher-account-site{flex:none;color:var(--af-text);font-size:12px;line-height:1.5;text-decoration:underline;text-decoration-color:var(--af-text-muted);text-underline-offset:3px}
.aifisher-account-site:hover{color:var(--af-text);text-decoration-color:var(--af-text-secondary)}
.aifisher-account-key{min-width:0;height:34px;padding:0 10px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-surface);color:var(--af-text);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}
.aifisher-account-key::placeholder{color:var(--af-text-muted)}
.aifisher-account-bind-button,.aifisher-account-unbind{min-height:34px;padding:0 11px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-primary);color:var(--af-on-primary);font-size:10px;font-weight:700;cursor:pointer}
.aifisher-account-unbind{grid-column:1/-1;justify-self:start;min-height:28px;background:transparent;color:var(--af-text-secondary)}
.aifisher-account-binding-status{grid-column:1/-1;min-height:15px;color:var(--af-text-muted);font-size:9px;line-height:1.5}
.aifisher-account-binding-status[data-error="true"]{color:var(--af-danger)}
.aifisher-account-binding button:disabled,.aifisher-account-key:disabled{cursor:wait;opacity:.55}
.aifisher-account-activity-section{display:flex;flex:1 1 auto;min-height:0;flex-direction:column;border-top:1px solid var(--af-border)}
.aifisher-account-activities-head{display:flex;flex:none;align-items:center;gap:8px;min-height:42px;padding:8px 16px;background:var(--af-surface)}
.aifisher-account-activities-title{color:var(--af-text);font-size:10px;font-weight:700}
.aifisher-account-activities-count{color:var(--af-text-muted);font-size:9px}
.aifisher-account-activities-toggle{margin-left:auto;min-height:26px;padding:4px 8px;border:1px solid var(--af-border);border-radius:6px;background:var(--af-surface);color:var(--af-text-secondary);font-size:9px;cursor:pointer}
.aifisher-account-activities-toggle:hover{border-color:var(--af-border-control);color:var(--af-text)}.aifisher-account-activities-toggle[hidden]{display:none}
.aifisher-account-activities{flex:1 1 auto;min-height:0;overflow:auto;padding:8px}
.aifisher-account-empty{padding:30px 12px;text-align:center;color:var(--af-text-muted);font-size:11px;line-height:1.6}
.aifisher-account-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;padding:10px;border-radius:8px}
.aifisher-account-row+.aifisher-account-row{border-top:1px solid var(--af-border)}
.aifisher-account-model{overflow:hidden;color:var(--af-text);font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.aifisher-account-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.aifisher-account-billing{font-size:10px;font-weight:700;white-space:nowrap}
.aifisher-account-billing[data-kind="actual"]{color:var(--af-success)}.aifisher-account-billing[data-kind="estimate"]{color:var(--af-info)}.aifisher-account-billing[data-kind="preauthorization"],.aifisher-account-billing[data-kind="pending"]{color:var(--af-warning)}.aifisher-account-billing[data-kind="unknown"]{color:var(--af-text-secondary)}
.aifisher-account-delete{padding:2px 0;border:0;background:transparent;color:var(--af-text-muted);font-size:9px;cursor:pointer}.aifisher-account-delete:hover{color:var(--af-danger)}
.aifisher-account-detail{overflow:hidden;color:var(--af-text-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}
.aifisher-account-failure{grid-column:1/-1;color:var(--af-danger);font-size:9px;line-height:1.45}
.aifisher-account-delete-confirm{grid-column:1/-1;display:flex;align-items:center;gap:10px;margin-top:4px;padding:9px 10px;border:1px solid var(--af-border);border-radius:8px;background:var(--af-surface)}
.aifisher-account-delete-copy{min-width:0;color:var(--af-text);font-size:9px;line-height:1.45}.aifisher-account-delete-copy[data-error="true"]{color:var(--af-danger)}
.aifisher-account-delete-controls{display:flex;gap:6px;margin-left:auto}.aifisher-account-delete-cancel,.aifisher-account-delete-apply{min-height:25px;padding:3px 7px;border:1px solid var(--af-border-control);border-radius:6px;background:var(--af-surface);color:var(--af-text-secondary);font-size:9px;cursor:pointer}.aifisher-account-delete-apply{border-color:var(--af-danger);background:var(--af-danger);color:var(--af-on-primary);font-weight:700}.aifisher-account-delete-confirm button:disabled{cursor:wait;opacity:.55}
.aifisher-account-foot{flex:none;padding:10px 16px;border-top:1px solid var(--af-border);color:var(--af-text-muted);font-size:9px;line-height:1.5}
@media(max-width:560px){.aifisher-account-panel{position:fixed;right:12px;top:64px;width:calc(100vw - 24px)}}
`;
  document.head.append(style);
}

function createActivityRow(
  activity: RelayActivity,
  onDelete: (activityId: string) => Promise<void>,
): HTMLElement {
  const row = element('article', 'aifisher-account-row');
  row.dataset.activityId = activity.id;
  const model = element(
    'div',
    'aifisher-account-model',
    modelDisplayName(activity.model || '未标注模型'),
  );
  const classification = activity.billing?.classification || 'unknown';
  const amount =
    activity.billing?.amount == null
      ? ''
      : ` ${formatMoney(activity.billing.amount, activity.billing.currency)}`;
  const billing = element(
    'div',
    'aifisher-account-billing',
    `${BILLING_LABELS[classification]}${amount}`,
  );
  billing.dataset.kind = classification;
  const actions = element('div', 'aifisher-account-row-actions');
  const deleteButton = element('button', 'aifisher-account-delete', '删除');
  deleteButton.type = 'button';
  deleteButton.setAttribute(
    'aria-label',
    `删除 ${modelDisplayName(activity.model || '未标注模型')} 的本机活动记录`,
  );
  actions.append(billing, deleteButton);
  const detail = element(
    'div',
    'aifisher-account-detail',
    [
      activity.source,
      STATUS_LABELS[activity.status] || '状态待确认',
      activity.taskReference,
      formatTime(activity.updatedAt),
    ]
      .filter(Boolean)
      .join(' · '),
  );
  const evidenceCode = activity.billing?.evidence || '';
  const evidence = element(
    'div',
    'aifisher-account-detail',
    EVIDENCE_LABELS[evidenceCode] || '结算记录暂不可用',
  );
  row.append(model, actions, detail, evidence);
  if (activity.failure) {
    row.append(element('div', 'aifisher-account-failure', activity.failure.message));
  }
  deleteButton.addEventListener('click', () => {
    if (row.querySelector('.aifisher-account-delete-confirm')) return;
    deleteButton.hidden = true;
    const confirmation = element('div', 'aifisher-account-delete-confirm');
    confirmation.setAttribute('role', 'group');
    confirmation.setAttribute('aria-label', '确认删除本机活动记录');
    const copy = element(
      'div',
      'aifisher-account-delete-copy',
      '只删除本机活动记录，不影响中转账单。',
    );
    const controls = element('div', 'aifisher-account-delete-controls');
    const cancel = element('button', 'aifisher-account-delete-cancel', '取消');
    const apply = element('button', 'aifisher-account-delete-apply', '确认删除');
    cancel.type = 'button';
    apply.type = 'button';
    controls.append(cancel, apply);
    confirmation.append(copy, controls);
    row.append(confirmation);
    cancel.addEventListener('click', () => {
      confirmation.remove();
      deleteButton.hidden = false;
      deleteButton.focus();
    });
    apply.addEventListener('click', async () => {
      cancel.disabled = true;
      apply.disabled = true;
      apply.textContent = '删除中';
      try {
        await onDelete(activity.id);
      } catch {
        copy.dataset.error = 'true';
        copy.textContent = '暂时无法删除，请稍后重试。';
        cancel.disabled = false;
        apply.disabled = false;
        apply.textContent = '重新删除';
      }
    });
  });
  return row;
}

function mountRelayAccountCenter(
  slot: HTMLElement,
  fetchImpl: typeof fetch,
  pollIntervalMs: number,
): RelayAccountCenterAdapter {
  installStyles();
  slot.dataset.aifisherAccountMounted = 'true';
  const root = element('div', 'aifisher-account-center');
  const trigger = element('button', 'aifisher-account-trigger', '余额 --');
  const panel = element('section', 'aifisher-account-panel');
  const titleId = `aifisher-account-title-${Math.random().toString(36).slice(2)}`;
  const panelId = `aifisher-account-panel-${Math.random().toString(36).slice(2)}`;
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panelId);
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', titleId);

  const head = element('div', 'aifisher-account-head');
  const heading = element('div', 'aifisher-account-heading');
  const title = element('h2', 'aifisher-account-title', '余额与活动');
  title.id = titleId;
  const caption = element(
    'p',
    'aifisher-account-caption',
    '画布账号与 AIFISHER API 站账号不互通。请在 API 站单独注册、登录并创建 API Key，再在这里绑定。余额与活动来自你绑定的 API Key。',
  );
  const refresh = element('button', 'aifisher-account-refresh', '刷新');
  refresh.type = 'button';
  heading.append(title, caption);
  head.append(heading, refresh);

  const balance = element('div', 'aifisher-account-balance');
  const balanceLabel = element('div', 'aifisher-account-balance-label', '当前钱包余额');
  const balanceValue = element('div', 'aifisher-account-balance-value', '--');
  const balanceMeta = element('div', 'aifisher-account-balance-meta', '尚未同步');
  balanceMeta.setAttribute('aria-live', 'polite');
  balance.append(balanceLabel, balanceValue, balanceMeta);
  const binding = element('div', 'aifisher-account-binding');
  binding.hidden = true;
  const bindingIntro = element('div', 'aifisher-account-binding-intro');
  const bindingLabel = element(
    'label',
    'aifisher-account-binding-label',
    '输入你自己的中转站 API Key；验证成功后只加密保存在本机。',
  );
  const relaySite = element('a', 'aifisher-account-site', '打开API站');
  relaySite.href = RELAY_SITE_URL;
  relaySite.target = '_blank';
  relaySite.rel = 'noopener noreferrer';
  const apiKeyInput = element('input', 'aifisher-account-key fisherai-key-input');
  apiKeyInput.type = 'password';
  apiKeyInput.placeholder = '粘贴 API Key';
  apiKeyInput.autocomplete = 'off';
  apiKeyInput.spellcheck = false;
  bindingLabel.htmlFor = `aifisher-relay-key-${Math.random().toString(36).slice(2)}`;
  apiKeyInput.id = bindingLabel.htmlFor;
  const bindButton = element('button', 'aifisher-account-bind-button', '验证并绑定');
  bindButton.type = 'button';
  const unbindButton = element('button', 'aifisher-account-unbind', '解除当前绑定');
  unbindButton.type = 'button';
  unbindButton.hidden = true;
  const bindingStatus = element('div', 'aifisher-account-binding-status');
  bindingStatus.setAttribute('aria-live', 'polite');
  const headActions = element('div', 'aifisher-account-actions');
  headActions.append(relaySite, refresh);
  head.append(headActions);
  bindingIntro.append(bindingLabel);
  binding.append(bindingIntro, apiKeyInput, bindButton, unbindButton, bindingStatus);
  const activitySection = element('section', 'aifisher-account-activity-section');
  const activitiesHead = element('div', 'aifisher-account-activities-head');
  const activitiesTitle = element('div', 'aifisher-account-activities-title', '最近活动');
  const activitiesCount = element('div', 'aifisher-account-activities-count', '0 条');
  const activitiesToggle = element('button', 'aifisher-account-activities-toggle', '展开');
  const activities = element('div', 'aifisher-account-activities');
  activities.id = `aifisher-account-activities-${Math.random().toString(36).slice(2)}`;
  activitiesToggle.type = 'button';
  activitiesToggle.hidden = true;
  activitiesToggle.setAttribute('aria-expanded', 'false');
  activitiesToggle.setAttribute('aria-controls', activities.id);
  activitiesHead.append(activitiesTitle, activitiesCount, activitiesToggle);
  activities.append(element('div', 'aifisher-account-empty', '暂无本机生成活动。'));
  activitySection.append(activitiesHead, activities);
  const foot = element(
    'div',
    'aifisher-account-foot',
    '新完成的 AIFISHER API 任务会从终态回执显示实际消费；历史或缺失回执仍不推算。',
  );
  panel.append(head, balance, binding, activitySection, foot);
  root.append(trigger, panel);
  slot.replaceChildren(root);

  let latest: RelayAccountSnapshot | null = null;
  let loading = false;
  let activitiesExpanded = false;
  let useLocalCredentialStorage = true;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const renderActivities = () => {
    const records = latest?.activities.slice(0, 20) || [];
    activitiesCount.textContent = `${records.length} 条`;
    activitiesToggle.hidden = records.length <= 1;
    activitiesToggle.textContent = activitiesExpanded
      ? '收起'
      : `展开其余 ${records.length - 1} 条`;
    activitiesToggle.setAttribute('aria-expanded', String(activitiesExpanded));
    activities.replaceChildren(
      ...(records.length
        ? (activitiesExpanded ? records : records.slice(0, 1)).map((activity) =>
            createActivityRow(activity, deleteActivity),
          )
        : [element('div', 'aifisher-account-empty', '暂无本机生成活动。')]),
    );
  };

  const render = (snapshot: RelayAccountSnapshot) => {
    latest = snapshot;
    const current = snapshot.balance;
    const relayNotBound = current.errorCode === 'RELAY_ACCOUNT_NOT_BOUND';
    const relayNotConfigured = current.errorCode === 'RELAY_ACCOUNT_NOT_CONFIGURED';
    const selfServiceBinding = snapshot.capabilities?.selfServiceBinding === true;
    useLocalCredentialStorage = !selfServiceBinding;
    const formatted = formatMoney(current.amount, current.currency);
    trigger.textContent = relayNotConfigured
      ? 'API 未配置'
      : relayNotBound
        ? 'API 待开通'
        : current.status === 'stale'
          ? `余额 ${formatted}*`
          : `余额 ${formatted}`;
    balanceValue.textContent = formatted;
    balanceMeta.dataset.state = current.status;
    balanceMeta.textContent = relayNotConfigured
      ? '请填写你自己的 AIFISHER API Key。'
      : relayNotBound
        ? '当前账号尚未开通中转服务；不影响本地画布。'
        : current.status === 'available'
          ? `更新于 ${formatTime(current.observedAt)}`
          : current.status === 'stale'
            ? `离线 · 保留上次可信值（${formatTime(current.observedAt)}）`
            : '余额未知；未显示为 0';
    renderActivities();
    binding.hidden = false;
    if (useLocalCredentialStorage) {
      const configured = snapshot.mappingStatus === 'linked' && !relayNotConfigured;
      bindingLabel.textContent = configured
        ? '当前 Key 已加密保存在本机。粘贴新 Key 可直接替换。'
        : '输入你自己的中转站 API Key；只加密保存在本机。';
      apiKeyInput.placeholder = configured ? '•••••••••••••••• · 已保存' : '粘贴 API Key';
      bindButton.textContent = configured ? '保存并更换' : '保存 Key';
      unbindButton.hidden = !configured;
      if (!bindingStatus.dataset.error) {
        bindingStatus.textContent = configured
          ? '浏览器不会保存或取回明文 Key。'
          : '未填写 Key 时不能使用 AIFISHER API 生成。';
      }
    } else {
      bindingLabel.textContent = relayNotBound
        ? '输入你自己的中转站 API Key；验证成功后只加密保存在本机。'
        : '当前账号已绑定独立中转 Key。粘贴新 Key 可验证并替换，失败不会覆盖旧绑定。';
      apiKeyInput.placeholder = relayNotBound ? '粘贴 API Key' : '•••••••••••••••• · 已保存';
      bindButton.textContent = relayNotBound ? '验证并绑定' : '验证并更换';
      unbindButton.hidden = relayNotBound;
      if (!bindingStatus.dataset.error) {
        bindingStatus.textContent = relayNotBound
          ? '未输入 Key 时不能使用中转生成，本地画布功能不受影响。'
          : '已配置；浏览器不会保存或取回明文 Key。';
      }
    }
    foot.textContent = useLocalCredentialStorage
      ? 'Key 使用 Windows DPAPI 按当前用户加密，由本机 Node 直连中转站；新成功任务仍会显示终态实际消费。'
      : relayNotBound
        ? '每个 AIFISHER 用户只使用自己的中转 API Key；未配置时不会共享其他 Key。'
        : snapshot.mappingStatus === 'unsupported'
          ? '请在「设置 → 模型服务」填写你自己的 AIFISHER API Key；密钥只加密保存在本机。新成功任务仍会显示终态实际消费。'
          : '新完成的 AIFISHER API 任务会从终态回执显示实际消费；历史或缺失回执仍不推算。';
  };

  const setBindingBusy = (busy: boolean) => {
    apiKeyInput.disabled = busy;
    bindButton.disabled = busy;
    unbindButton.disabled = busy;
  };

  const deleteActivity = async (activityId: string) => {
    const response = await fetchImpl(`${ENDPOINT}/activities/${encodeURIComponent(activityId)}`, {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const body = (await response.json().catch(() => null)) as
      (RelayAccountSnapshot & { error?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.error || 'activity delete failed');
    render(body);
  };

  const changeBinding = async (method: 'PUT' | 'DELETE') => {
    const apiKey = apiKeyInput.value;
    if (method === 'PUT' && (apiKey.length < 16 || apiKey !== apiKey.trim())) {
      bindingStatus.dataset.error = 'true';
      bindingStatus.textContent = '请输入完整、前后没有空格的中转 API Key。';
      return;
    }
    setBindingBusy(true);
    bindingStatus.dataset.error = '';
    bindingStatus.textContent = useLocalCredentialStorage
      ? method === 'PUT'
        ? '正在加密保存…'
        : '正在清除本机 Key…'
      : method === 'PUT'
        ? '正在只读验证并绑定…'
        : '正在解除绑定…';
    try {
      if (useLocalCredentialStorage) {
        const response = await fetchImpl('/api/config/keys', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RELAY_API_KEY: method === 'PUT' ? apiKey : '' }),
        });
        if (!response.ok) throw new Error('本机 Key 保存失败，请稍后重试。');
        apiKeyInput.value = '';
        await load();
        bindingStatus.dataset.error = '';
        bindingStatus.textContent =
          method === 'PUT' ? 'Key 已加密保存在本机，余额已刷新。' : '本机 Key 已清除。';
        window.dispatchEvent(
          new CustomEvent(RELAY_BINDING_CHANGED_EVENT, {
            detail: { bound: method === 'PUT' },
          }),
        );
        return;
      }
      const response = await fetchImpl(`${ENDPOINT}/binding`, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: method === 'PUT' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'PUT' ? JSON.stringify({ apiKey }) : undefined,
      });
      apiKeyInput.value = '';
      const body = (await response.json().catch(() => null)) as
        (RelayAccountSnapshot & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || 'binding failed');
      render(body);
      bindingStatus.dataset.error = '';
      bindingStatus.textContent =
        method === 'PUT' ? '绑定成功，AIFISHER API 已启用。' : '已解除绑定。';
      window.dispatchEvent(
        new CustomEvent(RELAY_BINDING_CHANGED_EVENT, {
          detail: { bound: method === 'PUT' },
        }),
      );
    } catch (error) {
      apiKeyInput.value = '';
      bindingStatus.dataset.error = 'true';
      bindingStatus.textContent =
        error instanceof Error && error.message !== 'binding failed'
          ? error.message
          : '中转绑定暂时不可用，请稍后重试。';
    } finally {
      setBindingBusy(false);
    }
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    refresh.textContent = '同步中';
    try {
      const response = await fetchImpl(`${ENDPOINT}?refresh=1`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('relay account request failed');
      render((await response.json()) as RelayAccountSnapshot);
    } catch {
      balanceMeta.dataset.state = 'stale';
      balanceMeta.textContent =
        latest?.balance.amount != null
          ? '离线 · 保留上次可信值'
          : '账户状态暂不可用；余额未显示为 0';
    } finally {
      loading = false;
      refresh.disabled = false;
      refresh.textContent = '刷新';
    }
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
  const startPolling = () => {
    stopPolling();
    if (!panel.hidden && document.visibilityState === 'visible') {
      pollTimer = setInterval(() => {
        void load();
      }, pollIntervalMs);
    }
  };
  const open = () => {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    void load();
    startPolling();
    queueMicrotask(() => refresh.focus());
  };
  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    stopPolling();
  };
  const toggle = () => (panel.hidden ? open() : close());
  const onPointerDown = (event: PointerEvent) => {
    if (!root.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      close();
      trigger.focus();
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') startPolling();
    else stopPolling();
  };
  trigger.addEventListener('click', toggle);
  refresh.addEventListener('click', () => {
    void load();
  });
  activitiesToggle.addEventListener('click', () => {
    activitiesExpanded = !activitiesExpanded;
    renderActivities();
  });
  bindButton.addEventListener('click', () => {
    void changeBinding('PUT');
  });
  unbindButton.addEventListener('click', () => {
    if (window.confirm('解除后将不能使用中转生成，确定继续吗？')) {
      void changeBinding('DELETE');
    }
  });
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);
  void load();

  return Object.freeze({
    refresh: load,
    open,
    close,
    destroy() {
      stopPolling();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      root.remove();
      delete slot.dataset.aifisherAccountMounted;
    },
  });
}

export function installRelayAccountCenter({
  fetchImpl = window.fetch.bind(window),
  pollIntervalMs = POLL_INTERVAL_MS,
}: { fetchImpl?: typeof fetch; pollIntervalMs?: number } = {}): RelayAccountCenterAdapter {
  let current: RelayAccountCenterAdapter | null = null;
  let destroyed = false;
  const mount = () => {
    if (destroyed) return;
    const slot = document.querySelector<HTMLElement>('[data-fisherai-account-center-slot="true"]');
    if (!slot || slot.dataset.aifisherAccountMounted === 'true') return;
    current?.destroy();
    current = mountRelayAccountCenter(slot, fetchImpl, pollIntervalMs);
  };
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const controller: RelayAccountCenterAdapter = Object.freeze({
    refresh: () => current?.refresh() ?? Promise.resolve(),
    open: () => current?.open(),
    close: () => current?.close(),
    destroy() {
      destroyed = true;
      observer.disconnect();
      current?.destroy();
      current = null;
      if (window.__FISHERAI_RELAY_ACCOUNT__ === controller) {
        delete window.__FISHERAI_RELAY_ACCOUNT__;
      }
    },
  });
  window.__FISHERAI_RELAY_ACCOUNT__ = controller;
  mount();
  return controller;
}
import { createStableElement as element } from '../design/dom';
