import { desktopBridge, type CanvasAccountView } from '../desktop/desktopBridge';
import { createStableElement as node } from '../design/dom';
import { preferenceStorage } from '../persistence/preferenceStore';
import './canvasAccount.css';

const INTRO_KEY = 'fisherai.account-intro.opt-out.v2';

type AccountDialog = { body: HTMLElement; dismiss(): void };
export function createCanvasAccountControl(openDialog: (trigger: HTMLElement) => AccountDialog) {
  const bridge = desktopBridge()?.account;
  if (!bridge) return null;
  const button = node('button', 'aifisher-admin-trigger', '未登录');
  button.type = 'button';
  button.dataset.fisheraiAccountTrigger = 'true';
  let current: CanvasAccountView | null = null;
  let dialog: AccountDialog | null = null;
  let mode: 'login' | 'register' | 'recover' = 'login';
  let busy = false;
  let email = '';
  let destroyed = false;
  let eventRevision = 0;
  let intro: HTMLElement | null = null;
  let introTimer: ReturnType<typeof setTimeout> | undefined;
  const dismissIntro = (remember = false) => {
    clearTimeout(introTimer); intro?.remove(); intro = null;
    if (remember) preferenceStorage().setItem(INTRO_KEY, 'true');
  };
  const showIntro = () => {
    if (destroyed || current?.authenticated || dialog?.body.isConnected || preferenceStorage().getItem(INTRO_KEY) === 'true') return;
    if (document.querySelector('[aria-modal="true"]')) return;
    intro = node('aside', 'aifisher-account-intro');
    intro.setAttribute('aria-label', '账号登录提示');
    const close = node('button', 'aifisher-account-intro-close', '×'); close.type = 'button';
    close.setAttribute('aria-label', '关闭登录提示'); close.addEventListener('click', () => dismissIntro());
    const actions = node('div', 'aifisher-account-intro-actions');
    const later = node('button', '', '直接开始创作'); later.type = 'button'; later.addEventListener('click', () => dismissIntro());
    const never = node('button', 'aifisher-account-intro-opt-out', '不再提醒'); never.type = 'button';
    never.addEventListener('click', () => dismissIntro(true));
    const login = node('button', '', '登录 / 注册'); login.type = 'button'; login.dataset.primary = 'true'; login.addEventListener('click', () => button.click());
    actions.append(never, later, login);
    intro.append(close, node('strong', '', '登录，让反馈更好跟进'),
      node('p', '', '登录后提交的反馈会关联到你的账号，方便我们定位问题、跟进处理。'),
      node('p', 'aifisher-account-intro-note', '也可以直接使用本地画布，稍后从顶部账号入口登录。'), actions);
    document.body.append(intro);
  };
  const clearPasswords = () => dialog?.body.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => { input.value = ''; });
  const update = (view: CanvasAccountView) => {
    if (destroyed) return;
    const firstStatus = current === null;
    const accountChanged = (current?.userId ?? null) !== view.userId || (current?.authenticated ?? false) !== view.authenticated;
    current = view;
    button.textContent = view.authenticated ? (view.displayName || '已登录') : '未登录';
    button.title = view.authenticated ? '管理 AIFISHER 账号' : '登录 AIFISHER 账号（不影响本机画布）';
    button.setAttribute('aria-label', view.authenticated ? `账号：${view.displayName || '已登录'}` : '登录 / 注册 AIFISHER 账号');
    if (view.authenticated) dismissIntro();
    else if (firstStatus) introTimer = setTimeout(showIntro, 2500);
    if (!email) email = view.rememberedEmail || '';
    if (!busy && accountChanged) render();
  };
  const receive = (view: CanvasAccountView) => { eventRevision += 1; update(view); };
  const readStatus = () => {
    const expectedRevision = eventRevision;
    return bridge.status().then(view => { if (eventRevision === expectedRevision) update(view); });
  };
  function render(message = '') {
    if (!dialog?.body.isConnected) return;
    const body = dialog.body;
    body.classList.add('aifisher-account-body');
    const panel = body.closest('.aifisher-feedback-dialog');
    panel?.classList.add('aifisher-account-dialog');
    const heading = panel?.querySelector('h2');
    if (heading) heading.textContent = current?.authenticated ? 'AIFISHER 账号' : mode === 'register' ? '创建 AIFISHER 账号' : mode === 'recover' ? '找回密码' : '登录 AIFISHER';
    clearPasswords();
    body.replaceChildren();
    const status = node('p', 'aifisher-feedback-status', message);
    status.setAttribute('role', 'status');
    const action = (label: string, run: () => Promise<unknown>) => {
      const control = node('button', 'aifisher-feedback-button', label);
      control.type = 'button';
      control.addEventListener('click', () => {
        if (busy) return;
        busy = true; control.disabled = true;
        let message = '';
        void run().catch(() => { message = '退出账号未完成，请重试。当前本机工作区不受影响。'; })
          .finally(() => { busy = false; render(message); });
      });
      return control;
    };
    if (current?.authenticated) {
      const profile = node('div', 'aifisher-account-profile');
      const avatar = node('span', 'aifisher-account-avatar', Array.from(current.displayName || 'A')[0]); avatar.setAttribute('aria-hidden', 'true');
      const identity = node('div', 'aifisher-account-identity');
      identity.append(node('strong', '', current.displayName || 'AIFISHER 账号'), node('span', '', current.offline ? '暂时离线 · 画布仍可使用' : '已登录'));
      profile.append(avatar, identity);
      const details = node('div', 'aifisher-account-details');
      details.append(node('p', '', '反馈关联当前账号，方便定位和跟进问题。'), node('p', '', '项目与 API Key 保留在本机，退出后仍可继续创作。'));
      const footer = node('div', 'aifisher-account-footer');
      const logout = action('退出账号', async () => { receive(await bridge!.signOut()); render(); }); logout.classList.add('aifisher-account-logout');
      footer.append(node('span', '', '仅退出当前云端账号'), logout);
      body.append(profile, details, footer);
      if (message) body.append(status);
      return;
    }
    const tabs = node('div', 'aifisher-account-tabs');
    for (const [value, label] of [['login', '登录'], ['register', '注册']] as const) {
      const tab = node('button', 'aifisher-feedback-button', label);
      tab.type = 'button'; tab.disabled = busy;
      tab.setAttribute('aria-pressed', String(value === mode));
      tab.addEventListener('click', () => { if (!busy) { mode = value; render(); } });
      tabs.append(tab);
    }
    const switchMode = (label: string, value: typeof mode) => {
      const link = node('button', 'aifisher-account-link', label);
      link.type = 'button'; link.disabled = busy;
      link.addEventListener('click', () => { if (!busy) { mode = value; render(); } });
      return link;
    };
    if (mode === 'recover') body.append(switchMode('返回登录', 'login'), node('p', 'aifisher-account-recovery-note', '输入注册邮箱，我们会发送密码重置邮件。'));
    else body.append(tabs);
    const form = node('form');
    const field = (label: string, type: string, autocomplete: HTMLInputElement['autocomplete']) => {
      const wrapper = node('label', 'aifisher-feedback-field');
      const input = node('input'); input.type = type; input.autocomplete = autocomplete; input.required = true;
      wrapper.append(node('span', 'aifisher-feedback-label', label), input); form.append(wrapper); return input;
    };
    const emailInput = field('邮箱', 'email', 'email'); emailInput.value = email;
    emailInput.addEventListener('input', () => { email = emailInput.value; });
    const name = mode === 'register' ? field('昵称', 'text', 'off') : null;
    const password = mode !== 'recover' ? field('密码', 'password', mode === 'login' ? 'current-password' : 'new-password') : null;
    if (mode === 'login') form.append(switchMode('忘记密码？', 'recover'));
    const confirmation = mode === 'register' ? field('再次输入密码', 'password', 'new-password') : null;
    confirmation?.addEventListener('paste', event => event.preventDefault());
    if (mode === 'register') form.append(node('p', 'aifisher-account-legal', '创建账号即表示同意 AIFISHER 服务条款和隐私政策。请在收到邮件后完成邮箱验证。'));
    const submit = node('button', 'aifisher-feedback-button', mode === 'register' ? '创建账号' : mode === 'recover' ? '发送找回邮件' : '登录账号');
    submit.type = 'submit'; submit.dataset.primary = 'true'; submit.disabled = busy;
    form.append(status, submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); if (busy) return;
      const input = { email: emailInput.value, password: password?.value || '',
        displayName: name?.value || '', confirmation: confirmation?.value || '', confirmationWasPasted: false, rememberEmail: true };
      busy = true; submit.disabled = true; clearPasswords(); status.textContent = '正在处理…';
      void (async () => {
        if (mode === 'login') { const view = await bridge!.signIn(input); receive(view); return view.message; }
        const result = mode === 'register' ? await bridge!.register(input) : await bridge!.recoverPassword(input);
        return [result.message, ...Object.values(result.fieldErrors).filter(Boolean)].join(' ');
      })().then(message => { busy = false; render(message); }, () => {
        busy = false; render('账号服务暂不可用，请稍后重试。画布可继续使用。');
      });
    });
    body.append(form, node('p', 'aifisher-account-local-note', '项目与 API Key 保留在本机，可随时关闭并继续创作。'));
  }
  button.addEventListener('click', () => {
    dismissIntro();
    dialog?.dismiss(); dialog = openDialog(button); render();
    void readStatus().catch(() => render('账号状态暂不可用，画布可继续使用。'));
  });
  const unsubscribe = bridge.onChange(receive);
  const clearSecrets = bridge.onClearSecrets(clearPasswords);
  void readStatus().catch(() => {});
  return { button, destroy() { destroyed = true; dismissIntro(); clearPasswords(); dialog?.dismiss(); unsubscribe(); clearSecrets(); button.remove(); } };
}
