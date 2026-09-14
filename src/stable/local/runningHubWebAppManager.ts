import type {
  RunningHubWebAppCard,
  RunningHubWebAppCategory,
  RunningHubWebAppClient as WebAppClient,
  WorkflowManagerClient,
} from './workflowManagerClient';
import {
  RUNNINGHUB_PAID_CONFIRMATION_KEY,
  isConfirmationSuppressed,
  requestAnchoredConfirmation,
  resetConfirmationPreference,
} from '../design/designSystem';

export const RUNNINGHUB_WEBAPP_TEST_EVENT = 'fisherai:test-runninghub-webapp';
const STYLE_ID = 'fisherai-runninghub-webapp-manager-styles';
const RUNNINGHUB_CN_KEY_URL =
  'https://www.runninghub.cn/call-api/bill-task?inviteCode=rh-v1270&tab=keys&type=consumer';
const RUNNINGHUB_GLOBAL_KEY_URL =
  'https://www.runninghub.ai/zh-cn/call-api/bill-task?inviteCode=rh-v1270&tab=keys&type=consumer';
type RunningHubWebAppClient = WebAppClient & Pick<WorkflowManagerClient, 'getEditorSnapshot' | 'createCanvasNode'>;

type RunningHubCredentialRef = 'runninghub-cn' | 'runninghub-global';

export function parseRunningHubWebAppReference(value: string): {
  webAppId: string;
  credentialRef: RunningHubCredentialRef | undefined;
} {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('请粘贴 RunningHub 应用详情链接、AI 应用 API 手册链接，或输入应用 ID。');
  }
  if (!normalized.includes('://')) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
      throw new Error('WebApp ID 格式无效。');
    }
    return { webAppId: normalized, credentialRef: undefined };
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('RunningHub WebApp 链接格式无效。');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['runninghub.cn', 'runninghub.ai'].includes(host)) {
    throw new Error('仅支持 RunningHub 国内站或海外站的 WebApp 页面链接。');
  }
  const pathname = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/iu, '');
  const detailMatch = /^\/ai-detail\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname);
  const apiDetailMatch = /^\/call-api\/api-detail\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname);
  const apiType = url.searchParams.get('apiType');
  if (apiDetailMatch && apiType && apiType !== '4') {
    throw new Error('当前只支持 RunningHub AI 应用 API 手册链接。');
  }
  const match = detailMatch || apiDetailMatch;
  if (!match) {
    throw new Error('请粘贴 RunningHub 应用详情链接、AI 应用 API 手册链接，或直接输入应用 ID。');
  }
  return {
    webAppId: match[1],
    credentialRef: host === 'runninghub.ai' ? 'runninghub-global' : 'runninghub-cn',
  };
}

function control(label: string, primary = false) {
  const button = element('button', `rhwm-button${primary ? ' is-primary' : ''}`, label);
  button.type = 'button';
  return button;
}

function configureApiTokenInput(input: HTMLInputElement, name: string) {
  input.classList.add('fisherai-key-input');
  input.type = 'text';
  input.name = name;
  input.autocomplete = 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.setAttribute('aria-autocomplete', 'none');
  input.setAttribute('data-form-type', 'other');
  input.setAttribute('data-lpignore', 'true');
  input.setAttribute('data-1p-ignore', 'true');
  return input;
}

function externalControl(label: string, href: string, site: 'cn' | 'global') {
  const anchor = element('a', 'rhwm-key-link fisherai-button is-primary fisherai-key-link', label);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.setAttribute('data-fisherai-rh-get-key', site);
  anchor.setAttribute('aria-label', `${label}（在新窗口打开）`);
  anchor.append(document.createTextNode(' ↗'));
  return anchor;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = element('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-fisherai-runninghub-webapps] { color:var(--af-text); font-family:Inter,'Microsoft YaHei UI',system-ui,sans-serif; }
    .rhwm-shell { display:grid; gap:20px; padding-bottom:32px; }
    .rhwm-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
    .rhwm-head > :first-child { min-width:0; }
    .rhwm-kicker { margin:0 0 7px; color:var(--af-text-muted); font:600 11px/1.4 'Cascadia Code',Consolas,monospace; letter-spacing:.15em; }
    .rhwm-title { margin:0; color:var(--af-text); font-size:24px; line-height:1.25; font-weight:700; }
    .rhwm-subtitle { margin:7px 0 0; max-width:760px; color:var(--af-text-muted); font-size:13px; line-height:1.6; }
    .rhwm-button { min-height:34px; flex:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0 13px; border:1px solid var(--af-border-control); border-radius:7px; background:var(--af-surface-raised); color:var(--af-text); font-size:11px; font-weight:650; line-height:1; letter-spacing:.01em; white-space:nowrap; cursor:pointer; box-shadow:none; transition:transform .14s ease,background-color .14s ease,color .14s ease,border-color .14s ease,box-shadow .14s ease; }
    .rhwm-button:hover:not(:disabled) { border-color:var(--af-border-control); background:var(--af-surface-raised); color:var(--af-text); }
    .rhwm-button:active:not(:disabled) { transform:translateY(1px); }
    .rhwm-button:focus-visible { outline:2px solid var(--af-info); outline-offset:2px; }
    .rhwm-button.is-primary { border-color:var(--af-border-control); background:var(--af-primary); color:var(--af-on-primary); box-shadow:var(--af-shadow); }
    .rhwm-button.is-primary:hover:not(:disabled) { border-color:var(--af-border-control); background:var(--af-primary); color:var(--af-on-primary); box-shadow:var(--af-shadow); transform:translateY(-1px); }
    .rhwm-button.is-primary:active:not(:disabled) { background:var(--af-primary); box-shadow:var(--af-shadow); transform:translateY(0); }
    .rhwm-button.is-commit { min-height:36px; padding-inline:16px; }
    .rhwm-button:disabled { opacity:.45; cursor:not-allowed; }
    .rhwm-credentials { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; padding:18px; border:1px solid var(--af-border); border-radius:12px; background:var(--af-surface); }
    .rhwm-section-copy { grid-column:1/-1; display:flex; justify-content:space-between; align-items:baseline; gap:16px; }
    .rhwm-section-copy strong { font-size:14px; }
    .rhwm-section-copy span { color:var(--af-text-muted); font-size:11px; }
    .rhwm-key-card { min-width:0; display:grid; gap:9px; padding:14px; border-left:2px solid var(--af-info); background:var(--af-input); }
    .rhwm-key-card.is-valid { border-left-color:var(--af-success); }
    .rhwm-key-card.is-error { border-left-color:var(--af-danger); }
    .rhwm-key-head,.rhwm-key-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .rhwm-key-head label { display:flex; align-items:center; gap:7px; color:var(--af-text-secondary); font-size:11px; font-weight:700; }
    .rhwm-key-state { color:var(--af-text-muted); font-size:10px; }
    .rhwm-key-state.is-valid { color:var(--af-success); }
    .rhwm-key-state.is-error { color:var(--af-danger); }
    .rhwm-credential-actions { grid-column:1/-1; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:12px; padding-top:2px; }
    .rhwm-credential-actions span { color:var(--af-text-muted); font-size:10px; line-height:1.5; }
    .rhwm-status-dot { width:6px; height:6px; border-radius:999px; background:var(--af-hover); }
    .rhwm-status-dot.is-ready { background:var(--af-success); }
    .rhwm-status-dot.is-error { background:var(--af-danger); }
    .rhwm-input { width:100%; min-height:38px; padding:0 11px; border:1px solid var(--af-border-control); border-radius:8px; background:var(--af-input); color:var(--af-text); font-size:12px; outline:none; }
    .rhwm-input:focus { border-color:var(--af-info); box-shadow:0 0 0 1px #60a5fa; }
    .rhwm-category-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .rhwm-chip { min-height:30px; padding:0 11px; border:0; border-radius:999px; background:var(--af-surface); color:var(--af-text-muted); font-size:11px; cursor:pointer; }
    .rhwm-chip.is-active { background:var(--af-primary); color:var(--af-on-primary); }
    .rhwm-quick-add { display:grid; gap:18px; padding:14px 0 16px; border-top:1px solid var(--af-border); border-bottom:1px solid var(--af-border); }
    .rhwm-quick-copy { display:flex; align-items:baseline; justify-content:space-between; gap:16px; }
    .rhwm-quick-copy strong { font-size:14px; }
    .rhwm-quick-copy span { color:var(--af-text-muted); font-size:10px; }
    .rhwm-stage { min-width:0; border:1px solid var(--af-border); border-radius:12px; background:var(--af-input); }
    .rhwm-stage.is-account { border-color:var(--af-info); background:var(--af-surface); }
    .rhwm-stage.is-workflow { display:grid; gap:14px; padding:18px; background:var(--af-surface); }
    .rhwm-stage-heading { grid-column:1/-1; display:grid; grid-template-columns:auto minmax(0,1fr); gap:5px 12px; align-items:center; padding-bottom:13px; border-bottom:1px solid var(--af-border); }
    .rhwm-stage-index { grid-row:1/3; min-width:32px; color:var(--af-info); font:700 11px/1 'Cascadia Code',Consolas,monospace; letter-spacing:.08em; }
    .rhwm-stage-heading h3 { margin:0; color:var(--af-text); font-size:14px; line-height:1.35; font-weight:700; }
    .rhwm-stage-heading p { margin:0; color:var(--af-text-muted); font-size:10px; line-height:1.5; }
    .rhwm-stage.is-workflow .rhwm-stage-index { color:var(--af-text-secondary); }
    .rhwm-quick-belt { display:grid; grid-template-columns:auto minmax(260px,1fr) auto auto; gap:10px; align-items:center; }
    .rhwm-segment { display:inline-flex; gap:3px; padding:3px; border:1px solid var(--af-border); border-radius:8px; background:var(--af-input); }
    .rhwm-segment button { min-height:30px; padding:0 10px; border:0; border-radius:5px; background:transparent; color:var(--af-text-muted); font-size:11px; font-weight:700; cursor:pointer; }
    .rhwm-segment button.is-active { background:var(--af-primary); color:var(--af-on-primary); }
    .rhwm-auto-category { min-height:30px; display:inline-flex; align-items:center; padding:0 10px; border:1px solid var(--af-border); border-radius:999px; background:var(--af-surface); color:var(--af-text-secondary); font-size:10px; white-space:nowrap; }
    .rhwm-quick-credentials { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto; gap:12px; align-items:end; padding:18px; }
    .rhwm-quick-key { min-width:0; display:grid; gap:7px; }
    .rhwm-quick-key-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--af-text-secondary); font-size:10px; font-weight:700; }
    .rhwm-quick-key-status { min-height:16px; margin:0; color:var(--af-text-muted); font-size:10px; }
    .rhwm-quick-key-status.is-success { color:var(--af-success); }
    .rhwm-quick-key-status.is-error { color:var(--af-danger); }
    .rhwm-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .rhwm-empty { grid-column:1/-1; min-height:180px; display:grid; place-items:center; padding:24px; border:1px dashed var(--af-border); border-radius:12px; color:var(--af-text-muted); text-align:center; font-size:12px; }
    .rhwm-card { min-width:0; overflow:hidden; border:1px solid var(--af-border); border-radius:12px; background:var(--af-surface); }
    .rhwm-card-cover { position:relative; height:180px; display:flex; flex-direction:column; justify-content:space-between; padding:15px; background:var(--af-input); border-bottom:1px solid var(--af-border); }
    .rhwm-card-cover::after { content:''; position:absolute; left:15px; right:15px; bottom:15px; height:1px; background:var(--af-info-bg); }
    .rhwm-card-badges { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .rhwm-badge { padding:4px 7px; border-radius:6px; background:var(--af-surface-raised); color:var(--af-text-secondary); font:600 9px/1.2 'Cascadia Code',Consolas,monospace; letter-spacing:.06em; }
    .rhwm-badge.is-ready { color:var(--af-success); background:var(--af-success-bg); }
    .rhwm-card-mark { color:var(--af-info); font:700 30px/1 'Cascadia Code',Consolas,monospace; letter-spacing:-.06em; }
    .rhwm-card-body { display:grid; gap:11px; padding:15px; }
    .rhwm-card-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; font-weight:700; }
    .rhwm-card-description { min-height:36px; color:var(--af-text-muted); font-size:11px; line-height:1.55; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .rhwm-card-meta { display:flex; align-items:center; gap:7px; color:var(--af-text-muted); font:500 10px/1.4 'Cascadia Code',Consolas,monospace; }
    .rhwm-card-actions { display:grid; grid-template-columns:auto 1fr; gap:8px; }
    .rhwm-delete { border-color:transparent; background:transparent; color:var(--af-danger); }
    .rhwm-notice { min-height:18px; margin:0; color:var(--af-text-muted); font-size:11px; }
    .rhwm-notice.is-error { color:var(--af-danger); }
    .rhwm-notice.is-success { color:var(--af-success); }
    @media (max-width:1280px) { .rhwm-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:900px) { .rhwm-head { align-items:stretch; flex-direction:column; } .rhwm-credentials,.rhwm-quick-credentials { grid-template-columns:1fr; } .rhwm-quick-belt { grid-template-columns:1fr; } .rhwm-grid { grid-template-columns:1fr; } .rhwm-credential-actions { grid-template-columns:1fr; align-items:stretch; } .rhwm-credential-actions .rhwm-button { justify-self:start; } }
    @media (prefers-reduced-motion:reduce) { .rhwm-button { transition-duration:.01ms; } .rhwm-button:hover:not(:disabled),.rhwm-button:active:not(:disabled) { transform:none; } }
  `;
  document.head.append(style);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请检查网络和 RunningHub 配置。';
}

function stageHeading(index: string, title: string, description: string, titleId: string) {
  const heading = element('div', 'rhwm-stage-heading');
  const titleNode = element('h3', '', title);
  titleNode.id = titleId;
  heading.append(
    element('span', 'rhwm-stage-index', index),
    titleNode,
    element('p', '', description),
  );
  return heading;
}

export function createRunningHubQuickAdd(
  client: RunningHubWebAppClient,
  options: {
    onCreated?: (app: RunningHubWebAppCard) => void | Promise<void>;
    showCredentials?: boolean;
    connectDomesticOnly?: { onConnected: () => void | Promise<void> };
  } = {},
) {
  injectStyles();
  const root = element('section', 'rhwm-quick-add');
  root.setAttribute('data-fisherai-rh-quick-add', 'true');
  const copy = element('div', 'rhwm-quick-copy');
  copy.append(
    element('strong', '', '直接加载云端工作流'),
    element('span', '', '添加时只读取开放字段，不会创建任务或产生费用。'),
  );
  const belt = element('div', 'rhwm-quick-belt');
  const site = element('div', 'rhwm-segment');
  site.setAttribute('role', 'group');
  site.setAttribute('aria-label', 'RunningHub 站点');
  let selectedSite: RunningHubCredentialRef = 'runninghub-cn';
  const siteButtons = new Map<RunningHubCredentialRef, HTMLButtonElement>();
  const selectSite = (value: RunningHubCredentialRef) => {
    selectedSite = value;
    for (const [id, button] of siteButtons) button.classList.toggle('is-active', id === value);
  };
  for (const [id, label] of [
    ['runninghub-cn', 'CN'],
    ['runninghub-global', 'AI'],
  ] as const) {
    const button = element('button', '', label);
    button.type = 'button';
    button.setAttribute('data-fisherai-rh-site', id);
    button.addEventListener('click', () => selectSite(id));
    siteButtons.set(id, button);
    site.append(button);
  }
  selectSite(selectedSite);
  const reference = element('input', 'rhwm-input');
  reference.setAttribute('data-fisherai-rh-webapp-id', 'true');
  reference.placeholder = '粘贴 RunningHub 链接或输入应用 ID';
  const automaticCategory = element('span', 'rhwm-auto-category', '分类自动识别');
  const create = control('读取并添加', true);
  create.classList.add('is-commit');
  const notice = element('p', 'rhwm-notice');
  reference.addEventListener('input', () => {
    try {
      const parsed = parseRunningHubWebAppReference(reference.value);
      if (parsed.credentialRef) selectSite(parsed.credentialRef);
      notice.textContent = parsed.credentialRef ? '已从链接识别站点。' : '';
      notice.className = 'rhwm-notice is-success';
    } catch (error) {
      notice.textContent = reference.value.trim() ? message(error) : '';
      notice.className = 'rhwm-notice is-error';
    }
  });
  create.addEventListener('click', () => {
    void (async () => {
      const previous = create.textContent || '';
      create.disabled = true;
      create.textContent = '正在读取…';
      const adapter = window.__FISHERAI_WORKFLOW_NODES__;
      try {
        const parsed = parseRunningHubWebAppReference(reference.value);
        const credentialRef = parsed.credentialRef || selectedSite;
        selectSite(credentialRef);
        const status = await client.getRunningHubCredentialStatus();
        const configured =
          credentialRef === 'runninghub-cn' ? status.cnConfigured : status.globalConfigured;
        if (!configured) throw new Error('请先在上方保存对应站点的 API Key。');
        const app = await client.createRunningHubWebApp({
          webAppId: parsed.webAppId,
          credentialRef,
        });
        reference.value = '';
        notice.textContent = '云端工作流已加载，可直接添加到画布。';
        notice.className = 'rhwm-notice is-success';
        await options.onCreated?.(app);
        if (adapter) {
          const snapshot = await client.getEditorSnapshot(app.definitionId);
          if (!snapshot.deployment || !snapshot.bindingSet) throw new Error('工作流已导入，但参数尚未就绪，请在工作流库中检查后添加。');
          const blueprint = await client.createCanvasNode(app.definitionId, {
            deploymentId: snapshot.deployment.id,
            bindingSetId: snapshot.bindingSet.id,
            title: app.title,
          });
          if (window.__FISHERAI_WORKFLOW_NODES__ !== adapter) throw new Error('工作流已导入，当前项目已切换，请从工作流库添加。');
          const insertion = await adapter.addToCanvas(blueprint);
          window.__FISHERAI_FOCUS_NODES__?.(insertion.nodeIds);
          notice.textContent = '云端工作流已添加到画布，连接素材后即可运行。';
        }
      } catch (error) {
        notice.textContent = message(error);
        notice.className = 'rhwm-notice is-error';
      } finally {
        create.disabled = false;
        create.textContent = previous;
      }
    })();
  });
  belt.append(site, reference, automaticCategory, create);
  root.append(copy);

  if (options.showCredentials || options.connectDomesticOnly) {
    copy.remove();
    const credentials = element('section', 'rhwm-quick-credentials rhwm-stage is-account');
    credentials.setAttribute('data-fisherai-rh-stage', 'credentials');
    const credentialTitleId = `rhwm-credential-stage-${Math.random().toString(36).slice(2)}`;
    credentials.setAttribute('aria-labelledby', credentialTitleId);
    const quickNotice = element('p', 'rhwm-quick-key-status');
    const makeKey = (
      siteId: 'cn' | 'global',
      label: string,
      placeholder: string,
      linkLabel: string,
      href: string,
    ) => {
      const wrapper = element('label', 'rhwm-quick-key');
      const head = element('span', 'rhwm-quick-key-head');
      head.append(document.createTextNode(label), externalControl(linkLabel, href, siteId));
      const input = configureApiTokenInput(
        element('input', 'rhwm-input'),
        `runninghub-${siteId}-api-token`,
      );
      input.placeholder = placeholder;
      input.setAttribute('data-fisherai-rh-quick-key', siteId);
      wrapper.append(head, input);
      return { wrapper, input };
    };
    const cn = makeKey(
      'cn',
      'CN 国内站 API Key',
      '输入 runninghub.cn API Key',
      '获取连接',
      RUNNINGHUB_CN_KEY_URL,
    );
    const global = makeKey(
      'global',
      'AI 海外站 API Key',
      '输入 runninghub.ai API Key',
      '获取连接',
      RUNNINGHUB_GLOBAL_KEY_URL,
    );
    const save = control('保存并验证', true);
    save.classList.add('is-commit');
    let quickCredentialStatus = { cnConfigured: false, globalConfigured: false };
    void client
      .getRunningHubCredentialStatus()
      .then((status) => {
        quickCredentialStatus = status;
        cn.input.placeholder = status.cnConfigured
          ? '已长期保存；仅更换时输入新 Key'
          : '输入 runninghub.cn API Key';
        global.input.placeholder = status.globalConfigured
          ? '已长期保存；仅更换时输入新 Key'
          : '输入 runninghub.ai API Key';
        quickNotice.textContent =
          status.cnConfigured && status.globalConfigured
            ? 'CN 与 AI 站 Key 已长期保存在当前账号，本次无需重新输入。'
            : status.cnConfigured
              ? 'CN Key 已长期保存在当前账号；AI 站未配置。'
              : status.globalConfigured
                ? 'AI 站 Key 已长期保存在当前账号；CN 未配置。'
                : 'Key 将按当前账号长期保存在本机，重启和更新后继续使用。';
      })
      .catch(() => undefined);
    save.addEventListener('click', () => {
      void (async () => {
        const cnValue = cn.input.value.trim();
        const globalValue = global.input.value.trim();
        const references: RunningHubCredentialRef[] = [];
        if (cnValue || quickCredentialStatus.cnConfigured) references.push('runninghub-cn');
        if (!options.connectDomesticOnly && (globalValue || quickCredentialStatus.globalConfigured))
          references.push('runninghub-global');
        if (!references.length) {
          quickNotice.textContent = '请先输入至少一个 RunningHub API Key。';
          quickNotice.className = 'rhwm-quick-key-status is-error';
          return;
        }
        const previous = save.textContent || '';
        save.disabled = true;
        save.textContent = '验证中…';
        try {
          if (cnValue || globalValue) {
            await client.saveRunningHubCredentials({
              cnApiKey: cnValue,
              globalApiKey: globalValue,
            });
            quickCredentialStatus.cnConfigured ||= Boolean(cnValue);
            quickCredentialStatus.globalConfigured ||= Boolean(globalValue);
            cn.input.placeholder = quickCredentialStatus.cnConfigured
              ? '已长期保存；仅更换时输入新 Key'
              : '输入 runninghub.cn API Key';
            global.input.placeholder = quickCredentialStatus.globalConfigured
              ? '已长期保存；仅更换时输入新 Key'
              : '输入 runninghub.ai API Key';
          }
          cn.input.value = '';
          global.input.value = '';
          await Promise.all(
            references.map((credentialRef) => client.validateRunningHubCredential(credentialRef)),
          );
          quickNotice.textContent = references
            .map((credentialRef) =>
              credentialRef === 'runninghub-cn'
                ? '国内站 API Key 验证通过'
                : '海外站 API Key 验证通过',
            )
            .join('；');
          quickNotice.className = 'rhwm-quick-key-status is-success';
          if (root.isConnected) await options.connectDomesticOnly?.onConnected();
        } catch (error) {
          quickNotice.textContent = message(error);
          quickNotice.className = 'rhwm-quick-key-status is-error';
        } finally {
          save.disabled = false;
          save.textContent = previous;
        }
      })();
    });
    credentials.append(
      stageHeading(
        '01',
        '连接 RunningHub 账号',
        '这里只填写 API Key；保存后由当前账号在本机长期使用。',
        credentialTitleId,
      ),
      cn.wrapper,
      global.wrapper,
      save,
      quickNotice,
    );
    root.append(credentials);
    if (options.connectDomesticOnly) {
      global.wrapper.remove();
      save.textContent = '保存连接，返回官方推荐';
      return root;
    }
  }

  if (options.showCredentials) {
    const workflow = element('section', 'rhwm-stage is-workflow');
    workflow.setAttribute('data-fisherai-rh-stage', 'workflow');
    const workflowTitleId = `rhwm-workflow-stage-${Math.random().toString(36).slice(2)}`;
    workflow.setAttribute('aria-labelledby', workflowTitleId);
    workflow.append(
      stageHeading(
        '02',
        '添加云端工作流',
        '这里只粘贴 RunningHub 工作流链接或应用 ID，不要填写 API Key。',
        workflowTitleId,
      ),
      belt,
      notice,
    );
    root.append(workflow);
  } else {
    root.append(belt, notice);
  }
  return root;
}

export function createRunningHubWebAppManager(client: RunningHubWebAppClient) {
  injectStyles();
  const root = element('section');
  root.setAttribute('data-fisherai-runninghub-webapps', 'true');
  const shell = element('div', 'rhwm-shell');
  const notice = element('p', 'rhwm-notice');
  let apps: RunningHubWebAppCard[] = [];
  let categories: RunningHubWebAppCategory[] = [];
  let activeCategory = 'all';
  let credentialStatus = { cnConfigured: false, globalConfigured: false };
  const credentialValidation: Record<'cn' | 'global', 'idle' | 'valid' | 'error'> = {
    cn: 'idle',
    global: 'idle',
  };

  const head = element('div', 'rhwm-head');
  const headCopy = element('div');
  headCopy.append(
    element('p', 'rhwm-kicker', 'RUNNINGHUB WEBAPP / 云端应用'),
    element('h3', 'rhwm-title', '云端工作流'),
    element(
      'p',
      'rhwm-subtitle',
      '粘贴 RunningHub 应用详情或 AI 应用 API 手册链接，也可直接输入应用 ID。云端应用作为黑盒执行，只展示 RunningHub 实际开放的输入。',
    ),
  );
  head.append(headCopy);

  const credentials = element('section', 'rhwm-credentials');
  const credentialCopy = element('div', 'rhwm-section-copy');
  credentialCopy.append(
    element('strong', '', 'RunningHub 连接'),
    element('span', '', '与“闭源服务”共用安全凭证，这里单独提供云端工作流入口。'),
  );
  const cnCard = element('div', 'rhwm-key-card');
  const cnHead = element('div', 'rhwm-key-head');
  const cnTitle = element('label');
  cnTitle.htmlFor = 'fisherai-runninghub-cn-key';
  const cnDot = element('i', 'rhwm-status-dot');
  cnTitle.append(cnDot, document.createTextNode('国内站 API Key'));
  const cnState = element('span', 'rhwm-key-state', '未配置');
  cnHead.append(cnTitle, cnState);
  const cnKey = configureApiTokenInput(element('input', 'rhwm-input'), 'runninghub-cn-api-token');
  cnKey.id = 'fisherai-runninghub-cn-key';
  cnKey.setAttribute('data-fisherai-rh-key', 'cn');
  cnKey.placeholder = '输入 runninghub.cn API Key';
  const cnFoot = element('div', 'rhwm-key-foot');
  cnFoot.append(
    element('span', 'rhwm-key-state', '国内站 · 支持个人与团队密钥'),
    externalControl('一键获取国内站 API Key', RUNNINGHUB_CN_KEY_URL, 'cn'),
  );
  cnCard.append(cnHead, cnKey, cnFoot);
  const globalCard = element('div', 'rhwm-key-card');
  const globalHead = element('div', 'rhwm-key-head');
  const globalTitle = element('label');
  globalTitle.htmlFor = 'fisherai-runninghub-global-key';
  const globalDot = element('i', 'rhwm-status-dot');
  globalTitle.append(globalDot, document.createTextNode('海外站 API Key'));
  const globalState = element('span', 'rhwm-key-state', '未配置');
  globalHead.append(globalTitle, globalState);
  const globalKey = configureApiTokenInput(
    element('input', 'rhwm-input'),
    'runninghub-global-api-token',
  );
  globalKey.id = 'fisherai-runninghub-global-key';
  globalKey.setAttribute('data-fisherai-rh-key', 'global');
  globalKey.placeholder = '输入 runninghub.ai API Key';
  const globalFoot = element('div', 'rhwm-key-foot');
  globalFoot.append(
    element('span', 'rhwm-key-state', '海外站 · 独立账号与密钥'),
    externalControl('获取海外站 API Key', RUNNINGHUB_GLOBAL_KEY_URL, 'global'),
  );
  globalCard.append(globalHead, globalKey, globalFoot);
  const credentialActions = element('div', 'rhwm-credential-actions');
  credentialActions.append(
    element(
      'span',
      '',
      '密钥按当前账号长期保存在本机；重启和更新后继续使用。验证只查询账户状态，不会产生费用。',
    ),
  );
  const saveKeys = control('保存并验证', true);
  saveKeys.classList.add('is-commit');
  const resetPaidWarning = control('付费提醒已开启');
  resetPaidWarning.addEventListener('click', () => {
    resetConfirmationPreference(RUNNINGHUB_PAID_CONFIRMATION_KEY);
    renderCredentials();
    setNotice('已恢复 RunningHub 付费任务提醒。', 'success');
  });
  credentialActions.append(resetPaidWarning, saveKeys);
  credentials.append(credentialCopy, cnCard, globalCard, credentialActions);

  const categoryBar = element('div', 'rhwm-category-bar');
  const grid = element('div', 'rhwm-grid');
  const quickAdd = createRunningHubQuickAdd(client, {
    onCreated: async () => {
      await load();
      setNotice('云端工作流已加载，可直接添加到画布。', 'success');
    },
  });
  shell.append(head, credentials, quickAdd, categoryBar, grid, notice);
  root.append(shell);

  const setNotice = (text: string, tone: '' | 'error' | 'success' = '') => {
    notice.textContent = text;
    notice.className = `rhwm-notice${tone ? ` is-${tone}` : ''}`;
  };

  const busy = async (button: HTMLButtonElement, label: string, action: () => Promise<void>) => {
    const previous = button.textContent || '';
    button.disabled = true;
    button.textContent = label;
    try {
      await action();
    } catch (error) {
      setNotice(message(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  };

  const renderCredentials = () => {
    const renderCredential = (
      card: HTMLElement,
      dot: HTMLElement,
      state: HTMLElement,
      configured: boolean,
      validation: 'idle' | 'valid' | 'error',
    ) => {
      card.classList.toggle('is-valid', validation === 'valid');
      card.classList.toggle('is-error', validation === 'error');
      dot.classList.toggle('is-ready', validation === 'valid');
      dot.classList.toggle('is-error', validation === 'error');
      state.className = `rhwm-key-state${validation === 'valid' ? ' is-valid' : validation === 'error' ? ' is-error' : ''}`;
      state.textContent =
        validation === 'valid'
          ? '验证通过'
          : validation === 'error'
            ? '验证失败'
            : configured
              ? '已长期保存 · 待验证'
              : '未配置';
    };
    renderCredential(
      cnCard,
      cnDot,
      cnState,
      credentialStatus.cnConfigured,
      credentialValidation.cn,
    );
    renderCredential(
      globalCard,
      globalDot,
      globalState,
      credentialStatus.globalConfigured,
      credentialValidation.global,
    );
    cnKey.placeholder = credentialStatus.cnConfigured
      ? '已长期保存；仅更换时输入新 Key'
      : '输入 runninghub.cn API Key';
    globalKey.placeholder = credentialStatus.globalConfigured
      ? '已长期保存；仅更换时输入新 Key'
      : '输入 runninghub.ai API Key';
    const paidWarningSuppressed = isConfirmationSuppressed(RUNNINGHUB_PAID_CONFIRMATION_KEY);
    resetPaidWarning.textContent = paidWarningSuppressed ? '恢复付费提醒' : '付费提醒已开启';
    resetPaidWarning.disabled = !paidWarningSuppressed;
  };

  const renderCategories = () => {
    categoryBar.replaceChildren();
    const all = element(
      'button',
      `rhwm-chip${activeCategory === 'all' ? ' is-active' : ''}`,
      `全部 ${apps.length}`,
    );
    all.type = 'button';
    all.addEventListener('click', () => {
      activeCategory = 'all';
      render();
    });
    categoryBar.append(all);
    for (const item of categories) {
      const count = apps.filter((app) => app.categoryId === item.id).length;
      const chip = element(
        'button',
        `rhwm-chip${activeCategory === item.id ? ' is-active' : ''}`,
        `${item.name} ${count}`,
      );
      chip.type = 'button';
      chip.addEventListener('click', () => {
        activeCategory = item.id;
        render();
      });
      categoryBar.append(chip);
    }
  };

  const createCard = (app: RunningHubWebAppCard) => {
    const card = element('article', 'rhwm-card');
    card.setAttribute('data-fisherai-rh-webapp-card', app.definitionId);
    const cover = element('div', 'rhwm-card-cover');
    const badges = element('div', 'rhwm-card-badges');
    badges.append(
      element('span', 'rhwm-badge', app.site === 'global' ? 'AI' : 'CN'),
      element(
        'span',
        `rhwm-badge${app.verified ? ' is-ready' : ''}`,
        app.verified ? '已验证' : '可使用',
      ),
    );
    if (app.coverUrl) {
      const image = document.createElement('img');
      image.src = app.coverUrl;
      image.alt = app.title;
      image.loading = 'lazy';
      image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      cover.append(image);
      badges.style.cssText = 'position:relative;z-index:1';
    }
    cover.append(badges);
    if (!app.coverUrl) cover.append(element('div', 'rhwm-card-mark', 'WEBAPP'));
    const body = element('div', 'rhwm-card-body');
    body.append(
      element('div', 'rhwm-card-title', app.title),
      element(
        'div',
        'rhwm-card-description',
        app.description || `${app.categoryName} · RunningHub 云端应用`,
      ),
    );
    const meta = element('div', 'rhwm-card-meta');
    meta.append(
      element('span', '', app.categoryName),
      element('span', '', '·'),
      element('span', '', `${app.fieldCount} 个输入`),
      element('span', '', '·'),
      element('span', '', app.webAppId),
    );
    const actions = element('div', 'rhwm-card-actions');
    const remove = control('删除');
    remove.classList.add('rhwm-delete');
    remove.addEventListener('click', () => {
      void (async () => {
        const confirmed = await requestAnchoredConfirmation({
          anchor: remove,
          intent: 'destructive',
          title: '删除云端工作流？',
          description: `“${app.title}”将从本机列表删除；已添加到画布的节点仍保留。`,
          confirmLabel: '删除',
        });
        if (!confirmed) return;
        await busy(remove, '删除中…', async () => {
          await client.deleteRunningHubWebApp(app.definitionId);
          await load();
          setNotice('云端工作流已删除。', 'success');
        });
      })();
    });
    const test = control(app.verified ? '查看字段与输出' : '设置字段', true);
    test.addEventListener('click', () => {
      window.dispatchEvent(
        new CustomEvent(RUNNINGHUB_WEBAPP_TEST_EVENT, {
          detail: { definitionId: app.definitionId, title: app.title },
        }),
      );
    });
    actions.append(remove, test);
    body.append(meta, actions);
    card.append(cover, body);
    return card;
  };

  const render = () => {
    renderCredentials();
    renderCategories();
    grid.replaceChildren();
    const visible =
      activeCategory === 'all' ? apps : apps.filter((app) => app.categoryId === activeCategory);
    if (!visible.length) {
      grid.append(
        element(
          'div',
          'rhwm-empty',
          apps.length
            ? '该分类还没有云端工作流。'
            : '还没有云端工作流。填写 API Key 后，输入 WebApp ID 即可添加。',
        ),
      );
      return;
    }
    for (const app of visible) grid.append(createCard(app));
  };

  const load = async () => {
    const [library, status] = await Promise.all([
      client.listRunningHubWebApps(),
      client.getRunningHubCredentialStatus(),
    ]);
    apps = library.apps;
    categories = library.categories;
    credentialStatus = status;
    render();
  };

  const saveAndValidateCredentials = async () => {
    const cnValue = cnKey.value.trim();
    const globalValue = globalKey.value.trim();
    const hasNewValue = Boolean(cnValue || globalValue);
    if (hasNewValue) {
      await client.saveRunningHubCredentials({ cnApiKey: cnValue, globalApiKey: globalValue });
      credentialStatus.cnConfigured ||= Boolean(cnValue);
      credentialStatus.globalConfigured ||= Boolean(globalValue);
      if (cnValue) credentialValidation.cn = 'idle';
      if (globalValue) credentialValidation.global = 'idle';
      cnKey.value = '';
      globalKey.value = '';
    }
    const references: RunningHubCredentialRef[] = [];
    if (cnValue || (!hasNewValue && credentialStatus.cnConfigured))
      references.push('runninghub-cn');
    if (globalValue || (!hasNewValue && credentialStatus.globalConfigured)) {
      references.push('runninghub-global');
    }
    if (!references.length) throw new Error('请先输入至少一个 RunningHub API Key。');
    const failures: unknown[] = [];
    await Promise.all(
      references.map(async (reference) => {
        const state = reference === 'runninghub-cn' ? 'cn' : 'global';
        try {
          await client.validateRunningHubCredential(reference);
          credentialValidation[state] = 'valid';
        } catch (error) {
          credentialValidation[state] = 'error';
          failures.push(error);
        }
      }),
    );
    renderCredentials();
    if (failures.length) {
      throw new Error(`${hasNewValue ? 'API Key 已保存，但' : ''}${message(failures[0])}`);
    }
    const labels = references.map((reference) =>
      reference === 'runninghub-cn' ? '国内站 API Key' : '海外站 API Key',
    );
    setNotice(`${labels.join('、')} 验证通过。`, 'success');
  };

  saveKeys.addEventListener('click', () => {
    void busy(saveKeys, '正在验证…', saveAndValidateCredentials);
  });
  void load().catch((error) => setNotice(message(error), 'error'));
  return root;
}
import { createStableElement as element } from '../design/dom';
