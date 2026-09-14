import { createStableTextElement as textElement } from '../design/dom';
import type { LibTvCliStatus, SourceSettingsClient } from './sourceSettingsClient';
import type { SettingsScope } from './sourceSettingsScope';

export function libTvCliVendor(client: SourceSettingsClient, scope: SettingsScope) {
  const panel = document.createElement('section');
  panel.className = 'rounded-lg border border-[var(--af-border)] p-5 space-y-3';
  panel.setAttribute('data-fisherai-source-vendor', 'LibTV CLI');
  const title = textElement(
    'button',
    'LibTV CLI · 检测中',
    'text-lg font-bold text-[var(--af-text)] cursor-pointer',
  ) as HTMLButtonElement;
  title.type = 'button';
  title.setAttribute('data-fisherai-vendor-toggle', 'true');
  title.setAttribute('aria-expanded', 'false');
  const body = document.createElement('div');
  body.hidden = true;
  body.setAttribute('data-fisherai-vendor-body', 'true');
  body.className = 'space-y-3';
  title.addEventListener('click', () => {
    body.hidden = !body.hidden;
    title.setAttribute('aria-expanded', String(!body.hidden));
  });
  const state = textElement('p', '检测本机 LibTV…', 'text-sm text-[var(--af-text-secondary)]');
  state.setAttribute('role', 'status');
  const login = document.createElement('button');
  login.type = 'button';
  login.textContent = '登录 LibTV';
  login.className = 'fisherai-button is-primary';
  login.disabled = true;
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = '刷新状态';
  refresh.className = 'fisherai-button ml-3';
  const link = document.createElement('a');
  link.href = 'https://liblibai-web-static.liblib.cloud/cli/1.1.3/libtv-cli-skill.zip';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '下载安装包与 Skill';
  link.className = 'text-sm text-[var(--af-info)]';
  link.hidden = true;
  const note = textElement(
    'p',
    '登录后可在画布生图、生视频的模型来源中选择 LibTV CLI。参考素材会上传至 LibTV，生成结果自动回到当前画布；费用以 LibTV 积分账单为准。',
    'text-sm leading-6 text-[var(--af-text-secondary)]',
  );
  const actions = document.createElement('div');
  actions.append(login, refresh);
  body.append(note, state, actions, link);
  panel.append(title, body);
  let timer: number | undefined;
  scope.onDispose(() => window.clearTimeout(timer));
  function apply(status: LibTvCliStatus) {
    if (!scope.active()) return;
    window.clearTimeout(timer);
    title.textContent = `LibTV CLI · ${status.authenticated ? '已连接' : status.installed ? '待登录' : '未安装'}`;
    state.textContent = status.loginRunning
      ? '已打开官方浏览器登录，完成后自动刷新。切换账号时请先在官方网页选择目标账号。'
      : status.authenticated
        ? `当前账号：${status.accountName}。可以回到画布选择 LibTV 模型。`
        : status.message ||
          (status.installed
            ? '请在浏览器完成登录，绑定到当前画布账号。'
            : '请下载官方安装包，按包内说明安装到本机后刷新。');
    login.textContent = status.authenticated ? '重新登录 / 切换账号' : '登录 LibTV';
    login.disabled = !status.installed || status.loginRunning;
    link.hidden = status.installed;
    if (status.loginRunning) timer = window.setTimeout(() => void update(), 2000);
  }
  async function update() {
    refresh.disabled = true;
    try {
      apply(await client.getLibTvCliStatus());
    } catch (error) {
      if (scope.active())
        state.textContent = error instanceof Error ? error.message : 'LibTV 状态读取失败。';
    } finally {
      if (scope.active()) refresh.disabled = false;
    }
  }
  login.addEventListener('click', () => {
    login.disabled = true;
    void client
      .loginLibTvCli()
      .then(apply)
      .catch((error) => {
        if (scope.active()) {
          login.disabled = false;
          state.textContent = error instanceof Error ? error.message : 'LibTV 登录失败。';
        }
      });
  });
  refresh.addEventListener('click', () => void update());
  void update();
  return panel;
}
