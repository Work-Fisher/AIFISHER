/**
 * sourceSettings.ts
 *
 * 设置页「闭源服务」的连接结构：AIFISHER API / RH CN / RH AI / 厂商直连。
 *
 * 稳定版原来是一长串按厂商排的密钥卡，看不出"填了这个密钥点亮了什么"。
 * 各来源卖的是同一批模型，所以设置页以「站 / 厂商」为一级；
 * 密钥与模型目录默认收起，需要时再展开，不让设置页被几十个模型名淹没。
 *
 * 注意这与画布模型下拉的切法相反：画布是一级模型名、二级来源，
 * 因为在画布上用户已经知道要哪个模型，只需要决定从哪买。
 *
 * 来源读取失败保留草稿并提供重试；旧版工作流字段使用同一个配置接口独立保存。
 */

import { isLikelyProviderApiKey, modelOverrideKey } from '../../shared/modelOverrideKey.js';
import type {
  MediaKind,
  SourceBlock,
  SourceMedia,
  SourceModel,
  SourceSecret,
  SourceSettingsClient,
} from './sourceSettingsClient';
import { createStableTextElement as textElement } from '../design/dom';
import { scopeSourceSettingsClient } from './sourceSettingsClient';
import { createSettingsScope, type SettingsScope } from './sourceSettingsScope';
import { createLegacyRunningHubSettings } from './legacyRunningHubSettings';
import { libTvCliVendor } from './libTvCliSettings';

const PANEL_ATTRIBUTE = 'data-fisherai-source-settings';
const MEDIA_LABELS: Record<MediaKind, string> = {
  image: '图像',
  video: '视频',
  text: '文本',
  audio: '音频',
};

const BLOCK_NOTES: Record<string, string> = {
  relay:
    '画布账号与 AIFISHER API 站账号不互通。请先在 API 站单独注册、登录并创建 API Key，再粘贴到这里保存。',
  // RH 两个站是两个账号：各自注册、各自充值、各自 API Key，余额不互通。
  // 「全能图片」标准模型系列已从 CN 站下线迁到 RH AI站。
  runninghub_global:
    '与画布、RH CN 站账号不互通，需要在 RH AI 站单独注册充值，并保存本站的 API Key。',
  runninghub:
    '与画布、RH AI 站账号不互通，需要在 RH CN 站单独注册并创建 API Key。两站余额不互通；「全能图片」系列已迁到 RH AI 站。',
  official: '每家厂商各自独立的密钥，填哪家亮哪家。价格以各厂商账单为准。',
};

function blockNote(block: SourceBlock) {
  if (block.source === 'relay' && block.accountManaged) {
    return 'API 站账号需单独注册，与画布账号不互通。绑定状态由当前 AIFISHER 账号统一管理，无需在设置页重复填写。';
  }
  return BLOCK_NOTES[block.source] ?? '';
}

const SOURCE_ORDER = ['relay', 'runninghub', 'runninghub_global', 'official'] as const;
const DIRECT_VENDOR_ORDER = ['豆包', 'Kimi', 'DeepSeek', '智谱 GLM', 'OpenAI'] as const;
const DREAMINA_CLI_INSTALL_COMMAND = 'curl -fsSL https://jimeng.jianying.com/cli | bash';
const DREAMINA_LOGIN_ORIGIN = 'https://jimeng.jianying.com';
const DREAMINA_LOGIN_PATH = '/ai-tool/cli-auth';
const DREAMINA_DEVICE_CONFIRM_PATH = '/passport/open/scan_user_code/';

function isOfficialDreaminaLoginUrl(value: string | undefined, userCode: string | undefined) {
  if (!value || !userCode) return false;
  let outer: URL;
  try {
    outer = new URL(value);
  } catch {
    return false;
  }
  if (
    outer.origin !== DREAMINA_LOGIN_ORIGIN ||
    outer.pathname !== DREAMINA_LOGIN_PATH ||
    outer.username ||
    outer.password ||
    outer.hash
  )
    return false;
  if (!outer.search) return true;
  const outerKeys = [...outer.searchParams.keys()];
  const nestedValues = outer.searchParams.getAll('verification_uri');
  if (outerKeys.length !== 1 || outerKeys[0] !== 'verification_uri' || nestedValues.length !== 1)
    return false;
  let nested: URL;
  try {
    nested = new URL(nestedValues[0]);
  } catch {
    return false;
  }
  const nestedKeys = [...nested.searchParams.keys()];
  const nestedCodes = nested.searchParams.getAll('user_code');
  return (
    nested.origin === DREAMINA_LOGIN_ORIGIN &&
    nested.pathname === DREAMINA_DEVICE_CONFIRM_PATH &&
    !nested.username &&
    !nested.password &&
    !nested.hash &&
    nestedKeys.length === 1 &&
    nestedKeys[0] === 'user_code' &&
    nestedCodes.length === 1 &&
    nestedCodes[0] === userCode
  );
}

/**
 * 密钥的展示信息。后端只给键名，中文厂商名与取密钥的链接属于界面知识。
 * 没登记的键名不吞掉：后端加了新厂商，这里也要能填，只是没有中文名和链接。
 */
const SECRET_META: Record<string, { vendor: string; label: string; link?: string }> = {
  RELAY_API_KEY: {
    vendor: 'AIFISHER API',
    label: 'API Key',
    link: 'https://api.work-fisher.com/',
  },
  RUNNINGHUB_API_KEY: {
    vendor: 'RH CN站',
    label: 'API Key',
    link: 'https://www.runninghub.cn/call-api/bill-task?inviteCode=rh-v1270&tab=keys&type=consumer',
  },
  RUNNINGHUB_GLOBAL_API_KEY: {
    vendor: 'RH AI站',
    label: 'API Key',
    link: 'https://www.runninghub.ai/zh-cn/call-api/bill-task?inviteCode=rh-v1270&tab=keys&type=consumer',
  },
  JIMENG_ACCESS_KEY: {
    vendor: '即梦 (Jimeng)',
    label: 'Access Key',
    link: 'https://console.volcengine.com/iam/keymanage',
  },
  JIMENG_SECRET_KEY: {
    vendor: '即梦 (Jimeng)',
    label: 'Secret Key',
    link: 'https://console.volcengine.com/iam/keymanage',
  },
  ARK_API_KEY: {
    vendor: '豆包',
    label: 'API Key',
    link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  KLING_ACCESS_KEY: {
    vendor: '可灵 (Kling)',
    label: 'Access Key',
    link: 'https://klingai.com/dev/api-key',
  },
  KLING_SECRET_KEY: {
    vendor: '可灵 (Kling)',
    label: 'Secret Key',
    link: 'https://klingai.com/dev/api-key',
  },
  OPENAI_API_KEY: {
    vendor: 'OpenAI',
    label: 'OpenAI API Key',
    link: 'https://platform.openai.com/api-keys',
  },
  DEEPSEEK_API_KEY: {
    vendor: 'DeepSeek',
    label: 'DeepSeek API Key',
    link: 'https://platform.deepseek.com/api_keys',
  },
  ZHIPU_API_KEY: {
    vendor: '智谱 GLM',
    label: 'API Key',
    link: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  MOONSHOT_API_KEY: {
    vendor: 'Kimi',
    label: 'API Key',
    link: 'https://platform.kimi.com/',
  },
  ALIYUN_API_KEY: {
    vendor: '阿里云 (Aliyun)',
    label: 'Aliyun API Key',
    link: 'https://dashscope.console.aliyun.com/apiKey',
  },
  MUREKA_API_KEY: {
    vendor: 'Mureka',
    label: 'Mureka API Key',
    link: 'https://platform.mureka.cn/',
  },
};

function secretMeta(key: string) {
  return SECRET_META[key] ?? { vendor: key, label: key };
}

function vendorLink(href: string) {
  const link = document.createElement('a');
  link.textContent = '获取密钥';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'fisherai-button is-primary fisherai-key-link';
  link.setAttribute('aria-label', '获取密钥（在浏览器打开）');
  return link;
}

function badge(text: string, tone: 'on' | 'off' | 'accent') {
  const styles = {
    on: 'bg-[var(--af-success-bg)] text-[var(--af-success)]',
    off: 'bg-[var(--af-surface-raised)] text-[var(--af-text-muted)]',
    accent: 'bg-[var(--af-info-bg)] text-[var(--af-info)]',
  };
  return textElement('span', text, `text-xs px-2 py-0.5 rounded-full font-bold ${styles[tone]}`);
}

/** 同一家厂商的多个密钥（Access Key + Secret Key）必须画在一起，否则填漏一个而不自知。 */
function groupByVendor(secrets: SourceSecret[]) {
  const groups = new Map<string, { vendor: string; link?: string; secrets: SourceSecret[] }>();
  for (const secret of secrets) {
    const meta = secretMeta(secret.key);
    const group = groups.get(meta.vendor) ?? { vendor: meta.vendor, link: meta.link, secrets: [] };
    group.secrets.push(secret);
    groups.set(meta.vendor, group);
  }
  const vendorOrder = new Map<string, number>(
    DIRECT_VENDOR_ORDER.map((vendor, index) => [vendor, index]),
  );
  return [...groups.values()].sort((left, right) => {
    const leftOrder = vendorOrder.get(left.vendor) ?? DIRECT_VENDOR_ORDER.length;
    const rightOrder = vendorOrder.get(right.vendor) ?? DIRECT_VENDOR_ORDER.length;
    return leftOrder - rightOrder;
  });
}

function disclosureButton(
  label: HTMLElement,
  body: HTMLElement,
  attribute: string,
  className: string,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute(attribute, 'true');
  button.setAttribute('aria-expanded', 'false');

  const affordance = textElement('span', '展开', 'text-xs font-medium text-[var(--af-text-muted)]');
  affordance.setAttribute('data-fisherai-disclosure-affordance', 'true');
  button.append(label, affordance);
  body.hidden = true;
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
    affordance.textContent = expanded ? '展开' : '收起';
  });
  return button;
}

function secretField(secret: SourceSecret, onDirty: (key: string, value: string) => void) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-6';
  row.setAttribute('data-fisherai-secret-field', secret.key);

  row.append(
    textElement(
      'div',
      secretMeta(secret.key).label,
      'w-48 shrink-0 text-base font-medium text-[var(--af-text-secondary)] whitespace-nowrap',
    ),
  );

  const input = document.createElement('input');
  input.type = 'password';
  input.value = '';
  // 已配置的密钥不回填值——后端只给布尔量，回填只能是伪造的掩码，
  // 用户一旦选中修改就会把掩码本身当成密钥存回去。
  input.placeholder = secret.configured ? '•••••••••••••••• · 已保存' : '未配置';
  input.className = 'fisherai-key-input w-full rounded-lg px-6 py-4 pr-16 text-base';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', secretMeta(secret.key).label);
  input.addEventListener('input', () => {
    input.dataset.fisheraiDirty = 'true';
    onDirty(secret.key, input.value);
  });

  // 密钥不回填，用户只能盲打几十个字符——不给查看开关就只能靠保存后报错才发现打错。
  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.textContent = '显示';
  reveal.setAttribute('data-fisherai-secret-reveal', secret.key);
  reveal.className =
    'absolute right-4 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-[var(--af-info)] hover:bg-[var(--af-info-bg)] hover:text-[var(--af-info)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)]';
  reveal.addEventListener('click', () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? '隐藏' : '显示';
  });

  const field = document.createElement('div');
  field.className = 'flex-1 relative';
  field.append(input, reveal);
  row.append(field);
  return row;
}

function modelChip(model: SourceModel) {
  const chip = textElement(
    'span',
    model.name,
    `px-3 py-1 rounded-md border text-xs ${
      model.configured
        ? 'border-[var(--af-border-control)] text-[var(--af-text)]'
        : 'border-[var(--af-border)] text-[var(--af-text-muted)]'
    }`,
  );
  chip.setAttribute('data-fisherai-source-model', model.name);
  chip.setAttribute('data-fisherai-configured', String(model.configured));
  return chip;
}

function mediaSection(media: SourceMedia) {
  const section = document.createElement('div');
  section.setAttribute('data-fisherai-source-media', media.kind);
  const heading = document.createElement('div');
  heading.className = 'flex items-center gap-2 mb-2';
  heading.append(
    textElement(
      'span',
      MEDIA_LABELS[media.kind] ?? media.kind,
      'text-sm font-bold text-[var(--af-text-secondary)]',
    ),
    textElement('span', `${media.models.length} 个模型`, 'text-xs text-[var(--af-text-muted)]'),
  );
  const chips = document.createElement('div');
  chips.className = 'flex flex-wrap gap-2';
  for (const model of media.models) chips.append(modelChip(model));
  section.append(heading, chips);
  return section;
}

function modelCatalogDisclosure(
  media: readonly SourceMedia[],
  saveConfiguration: (values: Record<string, string>) => Promise<void>,
) {
  const wrapper = document.createElement('section');
  wrapper.className =
    'rounded-lg border border-[var(--af-border)] bg-[var(--af-input)] overflow-hidden';
  const modelCount = media.reduce((total, section) => total + section.models.length, 0);
  const summary = document.createElement('span');
  summary.className = 'flex min-w-0 items-center gap-3 text-left';
  summary.append(
    textElement('span', '可用模型', 'text-sm font-bold text-[var(--af-text)]'),
    textElement('span', `${modelCount} 个`, 'text-xs text-[var(--af-text-muted)]'),
  );
  const body = document.createElement('div');
  body.className = 'space-y-4 border-t border-[var(--af-border)] px-5 py-4';
  body.setAttribute('data-fisherai-models-body', 'true');
  for (const section of media) {
    body.append(mediaSection(section), adaptedModelSelector(section.models, saveConfiguration));
  }
  const toggle = disclosureButton(
    summary,
    body,
    'data-fisherai-models-toggle',
    'flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--af-input)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400',
  );
  wrapper.append(toggle, body);
  return wrapper;
}

function dreaminaCliVendor(client: SourceSettingsClient, scope: SettingsScope) {
  const vendor = document.createElement('section');
  vendor.className =
    'rounded-lg border border-[var(--af-border)] bg-[var(--af-surface-raised)] overflow-hidden';
  vendor.setAttribute('data-fisherai-source-vendor', '即梦 CLI');

  const title = document.createElement('span');
  title.className = 'flex min-w-0 items-center gap-3 text-left';
  const statusBadge = badge('检测中', 'off');
  title.append(
    textElement('span', '即梦 CLI', 'text-lg font-bold text-[var(--af-text)]'),
    statusBadge,
  );

  const body = document.createElement('div');
  body.className = 'space-y-4 border-t border-[var(--af-border)] px-5 py-5';
  body.setAttribute('data-fisherai-vendor-body', 'true');
  body.append(
    textElement(
      'p',
      'AIFISHER 会从即梦官方源安装到当前账号的本机私有目录，无需 Git Bash，也不会申请管理员权限。',
      'text-sm leading-6 text-[var(--af-text-secondary)]',
    ),
  );

  const state = textElement(
    'p',
    '正在检测本机安装状态…',
    'text-sm leading-6 text-[var(--af-text-secondary)]',
  );
  state.setAttribute('role', 'status');
  state.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap items-center gap-3';
  const install = document.createElement('button');
  install.type = 'button';
  install.textContent = '检测中…';
  install.disabled = true;
  install.setAttribute('data-fisherai-dreamina-install', 'true');
  install.className =
    'rounded-lg bg-[var(--af-primary)] px-5 py-3 text-sm font-bold text-[var(--af-on-primary)] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--af-focus)] disabled:cursor-not-allowed disabled:opacity-40';
  const login = document.createElement('button');
  login.type = 'button';
  login.textContent = '登录即梦';
  login.hidden = true;
  login.setAttribute('data-fisherai-dreamina-login', 'true');
  login.className =
    'rounded-lg border border-[var(--af-border-control)] px-5 py-3 text-sm font-medium text-[var(--af-text)] hover:border-[var(--af-border-control)] hover:text-[var(--af-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40';
  const browser = document.createElement('select');
  browser.setAttribute('aria-label', '即梦授权浏览器');
  browser.className =
    'rounded-lg border border-[var(--af-border-control)] bg-[var(--af-input)] px-3 py-3 text-sm text-[var(--af-text)]';
  for (const [value, label] of [
    ['default', '默认浏览器'],
    ['edge', 'Microsoft Edge'],
    ['chrome', 'Google Chrome'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    browser.append(option);
  }
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = '刷新账号';
  refresh.className = login.className;
  refresh.setAttribute('data-fisherai-dreamina-refresh', 'true');
  let authenticated = false;
  actions.append(browser, login, refresh, install);

  const loginDetails = document.createElement('div');
  loginDetails.hidden = true;
  loginDetails.className =
    'space-y-3 rounded-lg border border-[var(--af-info)] bg-[var(--af-info-bg)] p-4';
  loginDetails.setAttribute('data-fisherai-dreamina-login-details', 'true');
  const loginInstruction = textElement(
    'p',
    '在即梦官方页面核对下方用户码，授权完成后 AIFISHER 会自动确认。',
    'text-xs leading-5 text-[var(--af-text-secondary)]',
  );
  const loginCode = textElement(
    'code',
    '',
    'block select-all break-all rounded-md border border-[var(--af-border)] bg-[var(--af-input)] px-3 py-2 text-sm text-[var(--af-text)]',
  );
  loginCode.setAttribute('data-fisherai-dreamina-user-code', 'true');
  const loginLink = document.createElement('a');
  loginLink.target = '_blank';
  loginLink.rel = 'noopener noreferrer';
  loginLink.textContent = '打开即梦官方授权页';
  loginLink.className =
    'inline-flex text-sm font-medium text-[var(--af-info)] hover:text-[var(--af-info)]';
  loginLink.setAttribute('data-fisherai-dreamina-login-link', 'true');
  loginDetails.append(loginInstruction, loginCode, loginLink);

  const fallback = document.createElement('div');
  fallback.hidden = true;
  fallback.className =
    'space-y-3 rounded-lg border border-[var(--af-border)] bg-[var(--af-input)] p-4';
  fallback.setAttribute('data-fisherai-dreamina-fallback', 'true');
  fallback.append(
    textElement(
      'p',
      '自动安装未完成。你可以重试，或使用即梦官方命令手动安装。',
      'text-xs leading-5 text-[var(--af-text-muted)]',
    ),
  );
  const commandRow = document.createElement('div');
  commandRow.className = 'flex items-center gap-3';
  const command = textElement(
    'code',
    DREAMINA_CLI_INSTALL_COMMAND,
    'min-w-0 flex-1 overflow-x-auto text-xs text-[var(--af-text-secondary)]',
  );
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制备用命令';
  copy.className =
    'shrink-0 rounded-lg border border-[var(--af-border-control)] px-3 py-2 text-xs font-medium text-[var(--af-text-secondary)] hover:border-[var(--af-border-control)] hover:text-[var(--af-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
  copy.addEventListener('click', () => {
    if (!navigator.clipboard) {
      copy.textContent = '请手动复制';
      return;
    }
    void navigator.clipboard
      .writeText(DREAMINA_CLI_INSTALL_COMMAND)
      .then(() => {
        copy.textContent = '已复制';
      })
      .catch(() => {
        copy.textContent = '请手动复制';
      });
  });
  commandRow.append(command, copy);
  const installLink = vendorLink('https://jimeng.jianying.com/cli');
  installLink.textContent = '查看即梦官方安装入口';
  fallback.append(commandRow, installLink);
  body.append(state, actions, loginDetails, fallback);

  let loginPollTimer: number | null = null;
  let loginDeadline = 0;
  const stopLoginPolling = () => {
    if (loginPollTimer !== null) window.clearTimeout(loginPollTimer);
    loginPollTimer = null;
  };
  scope.onDispose(stopLoginPolling);
  const showLoginDetails = (
    result: Awaited<ReturnType<SourceSettingsClient['loginDreaminaCli']>>,
  ) => {
    const validLink = isOfficialDreaminaLoginUrl(result.verificationUri, result.userCode);
    loginDetails.hidden = !(validLink && result.userCode);
    loginCode.textContent = result.userCode || '';
    if (validLink) loginLink.href = result.verificationUri!;
    else loginLink.removeAttribute('href');
  };
  const applyLoginResult = (
    result: Awaited<ReturnType<SourceSettingsClient['loginDreaminaCli']>>,
    refreshIdentity = true,
  ) => {
    if (!scope.active()) return;
    state.textContent = result.message;
    if (result.status === 'awaiting-authorization') {
      login.disabled = true;
      login.textContent = '等待授权…';
      showLoginDetails(result);
      const remoteDeadline = Date.parse(result.expiresAt || '');
      loginDeadline = Number.isFinite(remoteDeadline)
        ? remoteDeadline
        : Date.now() + 5 * 60 * 1_000;
      return;
    }
    stopLoginPolling();
    loginDetails.hidden = true;
    if (result.status === 'authenticated') {
      authenticated = true;
      login.disabled = false;
      login.textContent = '切换账号';
      if (refreshIdentity) void refreshAccount();
      window.dispatchEvent(new CustomEvent('fisherai:model-sources-changed'));
      return;
    }
    authenticated = false;
    login.disabled = false;
    login.textContent = result.status === 'idle' ? '登录即梦' : '重试登录';
  };
  const pollLogin = async () => {
    if (!scope.active() || !vendor.isConnected) {
      stopLoginPolling();
      return;
    }
    if (loginDeadline > 0 && Date.now() >= loginDeadline) {
      applyLoginResult({
        status: 'expired',
        loginRunning: false,
        retryable: true,
        message: '即梦登录已超时，请重新发起登录。',
      });
      return;
    }
    try {
      const result = await client.checkDreaminaCliLogin();
      if (!scope.active()) return;
      applyLoginResult(result);
      if (result.status === 'awaiting-authorization') {
        const delay = Math.min(5_000, Math.max(1_000, Number(result.pollAfterMs) || 1_000));
        loginPollTimer = window.setTimeout(() => {
          void pollLogin();
        }, delay);
      }
    } catch (error: unknown) {
      if (!scope.active()) return;
      stopLoginPolling();
      login.disabled = false;
      login.textContent = '重试登录';
      state.textContent = error instanceof Error ? error.message : '检测即梦登录失败。';
    }
  };

  const applyStatus = (
    status: Awaited<ReturnType<SourceSettingsClient['getDreaminaCliStatus']>>,
  ) => {
    if (!scope.active()) return;
    install.disabled = !status.installable;
    login.hidden = status.status !== 'installed';
    login.disabled = Boolean(status.loginRunning);
    fallback.hidden = true;
    if (status.status === 'installed') {
      statusBadge.textContent = '已安装';
      statusBadge.className = badge('已安装', 'on').className;
      install.textContent = '检查更新';
      login.textContent = status.loginRunning ? '登录进行中…' : '登录即梦';
      state.textContent =
        `即梦 CLI ${status.version || ''} 已就绪。登录后即可在 AIFISHER 中使用。`.replace(
          '  ',
          ' ',
        );
      if (status.login) {
        applyLoginResult(status.login, false);
        if (status.account)
          state.textContent = `${status.account.nickname || '即梦账号'} · UID ${status.account.uid}`;
        if (status.login.status === 'awaiting-authorization') void pollLogin();
      }
      return;
    }
    statusBadge.textContent = status.status === 'unsupported' ? '不支持' : '未安装';
    statusBadge.className = badge('未安装', 'off').className;
    install.textContent = status.status === 'invalid' ? '重新安装' : '一键安装';
    state.textContent =
      status.message ||
      (status.status === 'unsupported'
        ? '当前系统不支持自动安装。'
        : '尚未安装。点击一次即可完成，不需要打开终端。');
  };

  install.addEventListener('click', () => {
    if (install.disabled || !scope.active()) return;
    install.disabled = true;
    login.hidden = true;
    fallback.hidden = true;
    install.textContent = '正在安装…';
    state.textContent = '正在从即梦官方源下载并校验，请保持网络连接。';
    void client
      .installDreaminaCli()
      .then(applyStatus)
      .catch((error: unknown) => {
        if (!scope.active()) return;
        statusBadge.textContent = '安装失败';
        statusBadge.className = badge('未安装', 'off').className;
        install.disabled = false;
        install.textContent = '重试安装';
        state.textContent = error instanceof Error ? error.message : '安装即梦 CLI 失败。';
        fallback.hidden = false;
      });
  });

  const openLogin = (force: boolean) => {
    if (login.disabled || !scope.active()) return;
    stopLoginPolling();
    login.disabled = true;
    login.textContent = '正在打开…';
    state.textContent = '正在打开即梦官方 OAuth 登录…';
    void client
      .loginDreaminaCli({ force, browser: browser.value as 'default' | 'edge' | 'chrome' })
      .then((result) => {
        applyLoginResult(result);
        if (result.status === 'awaiting-authorization') void pollLogin();
      })
      .catch((error: unknown) => {
        if (!scope.active()) return;
        login.disabled = false;
        login.textContent = '重新登录';
        state.textContent = error instanceof Error ? error.message : '启动即梦登录失败。';
      });
  };
  login.addEventListener('click', () => openLogin(authenticated));
  loginLink.addEventListener('click', (event) => {
    event.preventDefault();
    openLogin(false);
  });

  const refreshAccount = async () => {
    refresh.disabled = true;
    try {
      const status = await client.getDreaminaCliStatus();
      if (scope.active()) applyStatus(status);
    } catch (error) {
      if (scope.active())
        state.textContent = error instanceof Error ? error.message : '检测账号失败，请重试。';
    } finally {
      if (scope.active()) refresh.disabled = false;
    }
  };
  refresh.addEventListener('click', () => {
    void refreshAccount();
  });
  void client
    .getDreaminaCliStatus()
    .then(applyStatus)
    .catch((error: unknown) => {
      if (!scope.active()) return;
      statusBadge.textContent = '检测失败';
      statusBadge.className = badge('未安装', 'off').className;
      install.disabled = false;
      install.textContent = '重试安装';
      state.textContent = error instanceof Error ? error.message : '检测即梦 CLI 失败。';
      fallback.hidden = false;
    });

  const toggle = disclosureButton(
    title,
    body,
    'data-fisherai-vendor-toggle',
    'flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--af-input)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400',
  );
  vendor.append(toggle, body);
  return vendor;
}

function directVendorDisclosure(
  block: SourceBlock,
  group: { vendor: string; link?: string; secrets: SourceSecret[] },
  onDirty: (key: string, value: string) => void,
  saveConfiguration: (values: Record<string, string>, keys: string[]) => Promise<void>,
) {
  const vendor = document.createElement('section');
  vendor.className =
    'rounded-lg border border-[var(--af-border)] bg-[var(--af-surface-raised)] overflow-hidden';
  vendor.setAttribute('data-fisherai-source-vendor', group.vendor);
  const configuredCount = group.secrets.filter((secret) => secret.configured).length;

  const title = document.createElement('span');
  title.className = 'flex min-w-0 items-center gap-3 text-left';
  title.append(textElement('span', group.vendor, 'text-lg font-bold text-[var(--af-text)]'));
  const configurationBadge =
    configuredCount === group.secrets.length
      ? badge('已配置', 'on')
      : badge(
          configuredCount ? `已配置 ${configuredCount}/${group.secrets.length}` : '未配置',
          'off',
        );
  configurationBadge.dataset.fisheraiVendorStatus = 'true';
  title.append(configurationBadge);

  const body = document.createElement('div');
  body.className = 'space-y-4 border-t border-[var(--af-border)] px-5 py-5';
  body.setAttribute('data-fisherai-vendor-body', 'true');
  if (group.link) body.append(vendorLink(group.link));
  for (const secret of group.secrets) body.append(secretField(secret, onDirty));
  body.append(
    adaptedModelSelector(
      adaptedModelsForVendor(
        block,
        group.secrets.map((secret) => secret.key),
      ),
      (values) =>
        saveConfiguration(
          values,
          group.secrets.map((secret) => secret.key),
        ),
    ),
  );

  const toggle = disclosureButton(
    title,
    body,
    'data-fisherai-vendor-toggle',
    'flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--af-input)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400',
  );
  vendor.append(toggle, body);
  return vendor;
}

function adaptedModelsForVendor(block: SourceBlock, secretKeys: readonly string[]) {
  const keySet = new Set(secretKeys);
  const models = block.media
    .flatMap((media) => media.models)
    .filter(
      (model) =>
        model.requiredSecrets.length > 0 &&
        model.requiredSecrets.every((secret) => keySet.has(secret)),
    );
  return [...new Map(models.map((model) => [model.name, model])).values()];
}

function adaptedModelSelector(availableModels: readonly SourceModel[], saveConfiguration: (values: Record<string, string>) => Promise<void>) {
  const models = [...availableModels].sort((a, b) => Number(b.vision === 'supported') - Number(a.vision === 'supported'));
  const wrapper = document.createElement('div');
  wrapper.className = 'grid gap-3';
  wrapper.setAttribute('data-fisherai-adapted-models', 'true');
  wrapper.append(
    textElement(
      'span',
      `已适配模型（${models.length}）`,
      'text-sm text-[var(--af-text-secondary)]',
    ),
  );
  const select = document.createElement('select');
  select.setAttribute('aria-label', '已适配模型');
  select.className =
    'w-full rounded-lg border border-[var(--af-border)] bg-[var(--af-input)] px-4 py-3 text-sm text-[var(--af-text)] outline-none focus:border-[var(--af-info)]';
  if (!models.length) {
    select.disabled = true;
    select.append(new Option('暂无已适配模型', ''));
  } else {
    for (const model of models) {
      const capability = model.vision === 'supported' ? '有视觉 · 推荐用于画布' : model.vision === 'unsupported' ? '无视觉 · 仅文字' : model.vision === 'unknown' ? '视觉未确认' : '';
      const option = new Option(`${model.name}${capability ? ` · ${capability}` : ''}`, model.name);
      option.setAttribute('data-fisherai-source-model', model.name);
      option.setAttribute('data-fisherai-configured', String(model.configured));
      select.append(option);
    }
  }
  wrapper.append(select);
  const capabilityNote = textElement('p', '', 'text-xs leading-relaxed text-neutral-400');
  capabilityNote.setAttribute('data-fisherai-model-capability', 'true');
  wrapper.append(capabilityNote);
  const editor = document.createElement('div');
  editor.className = 'flex flex-wrap items-center gap-2';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 200;
  input.setAttribute('aria-label', '自定义模型 ID');
  input.className =
    'min-w-0 flex-1 rounded-lg border border-[var(--af-border)] bg-[var(--af-input)] px-3 py-2 text-sm text-[var(--af-text)]';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = '保存密钥和模型';
  save.className = 'fisherai-button is-primary';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复默认';
  reset.className = 'fisherai-button';
  const status = textElement('p', '', 'text-xs text-[var(--af-text-secondary)]');
  status.setAttribute('role', 'status');
  const refreshModel = () => {
    const model = models.find((item) => item.name === select.value);
    capabilityNote.textContent = model?.vision === 'unsupported'
      ? '此模型无视觉，只能依据文字和节点信息判断，无法直接分析画布图片。需要看图时，推荐选择标有“有视觉”的模型。'
      : model?.vision === 'unknown' ? '当前模型视觉能力未确认；自定义模型 ID 的能力以实际服务商为准。' : '';
    capabilityNote.hidden = !capabilityNote.textContent;
    input.value = model?.customModelId || '';
    input.placeholder = model?.modelIds?.length
      ? `默认：${[...new Set(model.modelIds)].join(' / ')}`
      : '填写服务商提供的模型 ID';
    status.textContent = '留空使用默认。自定义模型沿用所选接口格式与能力，费用以服务商账单为准。';
  };
  select.addEventListener('change', refreshModel);
  const persist = async (value: string) => {
    if (value && !/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]{0,199}$/.test(value)) {
      status.textContent = '请输入有效模型 ID，不能包含空格或换行。';
      return;
    }
    if (isLikelyProviderApiKey(value)) {
      status.textContent = '这里填写模型 ID，不是 API Key；请在上方密钥输入框填写 API Key。';
      return;
    }
    save.disabled = reset.disabled = select.disabled = input.disabled = true;
    const model = models.find((item) => item.name === select.value);
    try {
      await saveConfiguration({ [modelOverrideKey(select.value)]: value });
      if (model) model.customModelId = value;
      input.value = value;
      status.textContent = '密钥和模型已保存，可以回到画布或 Agent 选择。';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '保存失败，请重试。';
    } finally {
      save.disabled = reset.disabled = select.disabled = input.disabled = false;
    }
  };
  save.addEventListener('click', () => {
    void persist(input.value.trim());
  });
  reset.addEventListener('click', () => {
    void persist('');
  });
  refreshModel();
  if (!models.length) save.disabled = reset.disabled = input.disabled = true;
  editor.append(input, save, reset);
  wrapper.append(editor, status);
  return wrapper;
}

function renderBlock(
  block: SourceBlock,
  client: SourceSettingsClient,
  reload: () => void,
  parentScope: SettingsScope,
) {
  const card = document.createElement('div');
  card.className =
    'rounded-lg border border-[var(--af-border)] bg-[var(--af-surface-raised)] overflow-hidden';
  card.setAttribute('data-fisherai-source-block', block.source);
  const scope = createSettingsScope(card, parentScope.signal);
  client = scopeSourceSettingsClient(client, scope.signal);

  const vendors = groupByVendor(block.secrets);
  const configuredCount = block.secrets.filter((secret) => secret.configured).length;
  const heading = document.createElement('div');
  heading.className = 'flex items-center gap-3';
  heading.append(textElement('h3', block.label, 'text-[var(--af-text)] text-xl font-bold'));
  if (block.source === 'relay') heading.append(badge('核心推荐', 'accent'));
  const configurationBadge =
    configuredCount === block.secrets.length
      ? badge('已配置', 'on')
      : badge(
          configuredCount ? `已配置 ${configuredCount}/${block.secrets.length}` : '未配置',
          'off',
        );
  configurationBadge.setAttribute('data-fisherai-source-status', 'true');
  heading.append(configurationBadge);
  if (block.accountManaged && block.singleKey && vendors[0]?.link) {
    heading.append(vendorLink(vendors[0].link));
  }

  const header = document.createElement('div');
  header.className = 'min-w-0 space-y-1 text-left';
  header.append(heading);
  const note = blockNote(block);
  if (note) {
    header.append(textElement('p', note, 'text-sm text-[var(--af-text-muted)] font-medium'));
  }
  const dirty = new Map<string, string>();
  const onDirty = (key: string, value: string) => {
    dirty.set(key, value);
  };
  let saving = false;
  const saveConfiguration = async (values: Record<string, string>, keys?: string[]) => {
    if (saving) throw new Error('配置正在保存，请稍候。');
    const snapshot = new Map([...dirty].filter(([key]) => !keys || keys.includes(key)));
    saving = true;
    try {
      await client.saveKeys({ ...Object.fromEntries(snapshot), ...values });
      if (!scope.active()) return;
      for (const [key, value] of snapshot) {
        if (dirty.get(key) !== value) continue;
        dirty.delete(key);
        const row = [...card.querySelectorAll<HTMLElement>('[data-fisherai-secret-field]')].find(
          (field) => field.dataset.fisheraiSecretField === key,
        );
        const field = row?.querySelector('input');
        if (field) {
          field.value = '';
          field.removeAttribute('data-fisherai-dirty');
        }
      }
      window.dispatchEvent(new CustomEvent('fisherai:model-sources-changed'));
      reload();
    } finally {
      saving = false;
    }
  };

  const keys = document.createElement('div');
  keys.className = 'space-y-3';
  if (block.source === 'relay' && block.accountManaged) {
    const managed = document.createElement('div');
    managed.setAttribute('data-fisherai-relay-account-managed', 'true');
    managed.className =
      'rounded-lg border border-[var(--af-border)] bg-[var(--af-input)] px-5 py-4';
    const bound = block.secrets.some((secret) => secret.configured);
    managed.append(
      textElement(
        'p',
        bound
          ? '当前 AIFISHER 账号已绑定中转 API，画布中可直接选择 AIFISHER API 来源。'
          : '请在画布右上角「余额与活动」中绑定中转 API Key。',
        bound
          ? 'text-sm leading-6 text-[var(--af-text-secondary)]'
          : 'text-sm leading-6 text-[var(--af-warning)]',
      ),
    );
    keys.append(managed);
  } else if (block.source === 'official') {
    keys.append(dreaminaCliVendor(client, scope));
    keys.append(libTvCliVendor(client, scope));
    for (const group of vendors)
      keys.append(directVendorDisclosure(block, group, onDirty, saveConfiguration));
  } else {
    for (const group of vendors) {
      const vendor = document.createElement('div');
      vendor.className = 'space-y-3';
      vendor.setAttribute('data-fisherai-source-vendor', group.vendor);
      // 单密钥的站不再重复一遍站名——标题已经写着「AIFISHER API」了。
      if (!block.singleKey) {
        const vendorRow = document.createElement('div');
        vendorRow.className = 'flex items-center gap-3';
        vendorRow.append(
          textElement('h4', group.vendor, 'text-base font-bold text-[var(--af-text)]'),
        );
        if (group.link) vendorRow.append(vendorLink(group.link));
        vendor.append(vendorRow);
      }
      for (const secret of group.secrets) vendor.append(secretField(secret, onDirty));
      keys.append(vendor);
    }
  }

  const body = document.createElement('div');
  body.className = 'space-y-6 border-t border-[var(--af-border)] px-6 py-6';
  body.setAttribute('data-fisherai-source-body', 'true');
  body.append(keys);

  // 密钥配置和模型目录是两件事。打开站点只显示连接配置，
  // 大量模型标签仍需再显式展开，避免设置页成为模型选择器。
  if (block.source !== 'official')
    body.append(modelCatalogDisclosure(block.media, saveConfiguration));

  if (!block.accountManaged) {
    const footer = document.createElement('div');
    footer.className = 'flex items-center gap-4';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '保存密钥';
    save.setAttribute('data-fisherai-source-save', block.source);
    save.className = 'fisherai-button is-primary';
    const message = textElement('span', '', 'text-sm text-[var(--af-text-secondary)]');
    message.setAttribute('role', 'status');
    save.addEventListener('click', () => {
      if (save.disabled || !scope.active()) return;
      if (!dirty.size) {
        message.textContent = '没有修改过的密钥。';
        return;
      }
      save.setAttribute('disabled', 'true');
      message.textContent = '保存中…';
      void saveConfiguration({})
        .then(() => {
          if (!scope.active()) return;
          message.textContent = dirty.size
            ? '已保存提交内容，仍有新修改尚未保存。'
            : '连接配置已保存，可以回到画布选择模型。';
        })
        .catch((error: unknown) => {
          if (!scope.active()) return;
          message.textContent = error instanceof Error ? error.message : '保存失败。';
        })
        .finally(() => {
          if (scope.active()) save.disabled = false;
        });
    });
    footer.append(save);
    if (block.singleKey && vendors[0]?.link) footer.append(vendorLink(vendors[0].link));
    footer.append(message);
    body.append(footer);
  }

  const legacy =
    block.source === 'runninghub' ? createLegacyRunningHubSettings(client, scope) : null;
  if (legacy) body.append(legacy);

  const sourceToggle = disclosureButton(
    header,
    body,
    'data-fisherai-source-toggle',
    'flex w-full items-center justify-between gap-5 px-6 py-5 text-left hover:bg-[var(--af-input)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400',
  );
  card.append(sourceToggle, body);
  return card;
}

/** Updates server metadata without rebuilding inputs or discarding another card's draft. */
function updateBlockMetadata(card: HTMLElement, block: SourceBlock) {
  const header = card.querySelector('[data-fisherai-source-toggle]');
  const status = header?.querySelector('[data-fisherai-source-status]');
  const count = block.secrets.filter((secret) => secret.configured).length;
  if (status) {
    status.textContent =
      count === block.secrets.length
        ? '已配置'
        : count
          ? `已配置 ${count}/${block.secrets.length}`
          : '未配置';
    status.className = badge('', count === block.secrets.length ? 'on' : 'off').className;
  }
  const managed = card.querySelector('[data-fisherai-relay-account-managed] p');
  if (managed) {
    managed.textContent = count
      ? '当前 AIFISHER 账号已绑定中转 API，画布中可直接选择 AIFISHER API 来源。'
      : '请在画布右上角「余额与活动」中绑定中转 API Key。';
    managed.className = count
      ? 'text-sm leading-6 text-[var(--af-text-secondary)]'
      : 'text-sm leading-6 text-[var(--af-warning)]';
  }
  for (const group of groupByVendor(block.secrets)) {
    const vendor = [...card.querySelectorAll<HTMLElement>('[data-fisherai-source-vendor]')].find(
      (element) => element.dataset.fisheraiSourceVendor === group.vendor,
    );
    const vendorStatus = vendor?.querySelector('[data-fisherai-vendor-status]');
    const configured = group.secrets.filter((secret) => secret.configured).length;
    if (vendorStatus) {
      vendorStatus.textContent =
        configured === group.secrets.length
          ? '已配置'
          : configured
            ? `已配置 ${configured}/${group.secrets.length}`
            : '未配置';
      vendorStatus.className = badge(
        '',
        configured === group.secrets.length ? 'on' : 'off',
      ).className;
    }
  }
  for (const row of card.querySelectorAll<HTMLElement>('[data-fisherai-secret-field]')) {
    const secret = block.secrets.find((item) => item.key === row.dataset.fisheraiSecretField);
    const input = row.querySelector('input');
    if (input && secret)
      input.placeholder = secret.configured ? '•••••••••••••••• · 已保存' : '未配置';
  }
  const models = new Map(
    block.media.flatMap((media) => media.models.map((model) => [model.name, model] as const)),
  );
  for (const element of card.querySelectorAll<HTMLElement>('[data-fisherai-source-model]')) {
    const model = models.get(element.dataset.fisheraiSourceModel || '');
    if (!model) continue;
    element.dataset.fisheraiConfigured = String(model.configured);
    if (element.tagName === 'SPAN') element.className = modelChip(model).className;
  }
}

export function mountSourceSettings(host: HTMLElement, client: SourceSettingsClient): () => void {
  const panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTRIBUTE, 'true');
  panel.className = 'space-y-8';
  const notice = textElement('div', '正在读取生成来源…', 'text-sm text-[var(--af-text-secondary)]'),
    retry = document.createElement('button'),
    cards = document.createElement('div');
  cards.className = 'space-y-8';
  notice.setAttribute('role', 'status');
  retry.type = 'button';
  retry.textContent = '重新读取生成来源';
  retry.className = 'fisherai-button';
  retry.hidden = true;
  panel.append(notice, retry, cards);
  host.prepend(panel);
  const scope = createSettingsScope(panel);
  let read: AbortController | undefined,
    epoch = 0;
  scope.onDispose(() => read?.abort());
  const load = () => {
    if (!scope.active()) return;
    read?.abort();
    read = new AbortController();
    const owner = ++epoch;
    retry.hidden = true;
    void client
      .getBlocks({ signal: read.signal })
      .then((blocks) => {
        if (!scope.active() || owner !== epoch) return;
        const order = new Map(SOURCE_ORDER.map((source, index) => [source, index]));
        const sorted = blocks
          // 即梦使用厂商直连里的专用登录卡，完整来源数据仍供助手使用。
          .filter((block) => !['dreamina_cli', 'libtv_cli'].includes(block.source))
          .map((block, index) => ({ block, index }))
          .sort(
            (a, b) =>
              (order.get(a.block.source as (typeof SOURCE_ORDER)[number]) ?? SOURCE_ORDER.length) -
                (order.get(b.block.source as (typeof SOURCE_ORDER)[number]) ??
                  SOURCE_ORDER.length) || a.index - b.index,
          );
        for (const { block } of sorted) {
          const existing = [...cards.children].find(
            (child) =>
              child instanceof HTMLElement && child.dataset.fisheraiSourceBlock === block.source,
          ) as HTMLElement | undefined;
          if (existing) updateBlockMetadata(existing, block);
          else cards.append(renderBlock(block, client, load, scope));
        }
        notice.hidden = true;
        retry.hidden = true;
      })
      .catch((error) => {
        if (!scope.active() || owner !== epoch) return;
        notice.hidden = false;
        notice.setAttribute('role', 'alert');
        notice.textContent = error instanceof Error ? error.message : '读取生成来源失败。';
        retry.hidden = false;
      });
  };
  retry.addEventListener('click', load);
  const refresh = () => load();
  window.addEventListener('aifisher:relay-binding-changed', refresh);
  scope.onDispose(() => window.removeEventListener('aifisher:relay-binding-changed', refresh));
  load();
  return () => {
    scope.dispose();
    panel.remove();
  };
}
