import { IdentityFailure } from './identityClient.mjs';
import {
  INVALID_EMAIL_MESSAGE,
  emptyFieldErrors,
  mailboxUrl,
  normalizeEmail,
  validateRegistration,
} from './identityValidation.mjs';

// Port of IdentitySession in apps/tauri-shell/src-tauri/src/identity.rs with the ADR-0035 rule:
// a stored session whose account is known keeps working while Identity is unreachable, and only
// an explicit rejection from Identity sends the user back to sign in.

export const IdentityState = Object.freeze({
  NotConfigured: 'notConfigured',
  SignedOut: 'signedOut',
  Authenticating: 'authenticating',
  Authenticated: 'authenticated',
  InvalidCredentials: 'invalidCredentials',
  RateLimited: 'rateLimited',
  Expired: 'expired',
  NetworkUnavailable: 'networkUnavailable',
});

const STATE_MESSAGES = Object.freeze({
  notConfigured: '账号服务尚未配置，画布可继续使用。',
  signedOut: '请输入 AIFISHER 账号和密码。',
  authenticating: '正在安全验证身份…',
  authenticated: '登录成功，凭证由当前 Windows 用户加密保护。',
  invalidCredentials: '邮箱或密码不正确，请检查后重试。',
  rateLimited: '登录尝试次数过多，请稍后再试。',
  expired: '登录状态已过期，请重新登录。',
  networkUnavailable: '身份服务当前不可用，本次没有保存密码。',
});
export const OFFLINE_MESSAGE = '暂时无法连接身份服务，已按本机登录状态继续使用，联网后自动恢复。';
const CLIENT_UNAVAILABLE_MESSAGE = 'Identity 公开配置无法初始化，请重新检测或使用完整安装器修复。';
const STORAGE_UNAVAILABLE_MESSAGE = '无法初始化当前 Windows 用户的身份安全存储，请重新检测或使用完整安装器修复。';
const MISSING_PASSWORD_MESSAGE = '请输入密码。';
const CHECK_FIELDS_MESSAGE = '请检查标出的内容后重新提交。';
const REGISTRATION_ACCEPTED_MESSAGE = '注册请求已接收。新账号请查收验证邮件；已有画布账号请直接登录，忘记密码可找回。';
const REGISTRATION_FAILURE_MESSAGES = Object.freeze({
  rateLimited: '创建账号请求过多，请稍后再试。',
  invalidInput: '注册信息不符合当前身份服务要求，请检查后重试。',
  unavailable: '暂时无法确认注册结果。请先检查验证邮件；若已验证，请返回登录。未收到邮件时可稍后重试或找回密码。',
});
const RECOVERY_ACCEPTED_MESSAGE = '如果该邮箱存在，找回说明已发送。为保护账号，结果不会透露邮箱是否已注册。';
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

function actionProblem(message, fieldErrors = emptyFieldErrors()) {
  return { accepted: false, problem: true, message, fieldErrors, pendingEmail: null, mailboxUrl: null };
}

function signInFailureState(error) {
  switch (error?.failure) {
    case IdentityFailure.InvalidCredentials: return IdentityState.InvalidCredentials;
    case IdentityFailure.RateLimited: return IdentityState.RateLimited;
    case IdentityFailure.InvalidSession: return IdentityState.Expired;
    default: return IdentityState.NetworkUnavailable;
  }
}

export function createIdentitySession({
  issuer = null,
  client = null,
  tokenStore = null,
  preferences = null,
  now = Date.now,
  configurationProblem = null,
} = {}) {
  const canReachIdentity = Boolean(issuer && client);
  const configured = canReachIdentity && Boolean(tokenStore);
  const configurationMessage = configurationProblem
    ?? (!issuer ? STATE_MESSAGES.notConfigured : !client ? CLIENT_UNAVAILABLE_MESSAGE : STORAGE_UNAVAILABLE_MESSAGE);
  let state = configured ? IdentityState.SignedOut : IdentityState.NotConfigured;
  let rememberedEmail = null;
  // account: the user (and session, once Identity confirmed it) the stored refresh token belongs to.
  let account = null;
  let access = null;
  let offline = false;
  let refreshing = null;
  let lastPublished = '';
  const listeners = new Set();

  const ready = (async () => {
    try {
      rememberedEmail = normalizeEmail((await preferences?.load())?.rememberedEmail);
    } catch {
      rememberedEmail = null;
    }
  })();

  let queue = Promise.resolve();
  function exclusive(operation) {
    const result = queue.then(() => ready).then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function currentMessage() {
    if (state === IdentityState.NotConfigured) return configurationMessage;
    if (state === IdentityState.Authenticated && offline) return OFFLINE_MESSAGE;
    return STATE_MESSAGES[state];
  }

  function view(message = currentMessage()) {
    return {
      state,
      authenticated: state === IdentityState.Authenticated,
      rememberedEmail,
      message,
      offline: state === IdentityState.Authenticated && offline,
    };
  }

  function publish() {
    const snapshot = view();
    const key = JSON.stringify(snapshot);
    if (key === lastPublished) return;
    lastPublished = key;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // A failing listener must not change the identity outcome.
      }
    }
  }

  function settle(next) {
    state = next;
    if (next !== IdentityState.Authenticated) {
      account = null;
      access = null;
      offline = false;
    }
  }

  const hasFreshAccess = () => access !== null && access.expiresAt - now() > ACCESS_TOKEN_REFRESH_MARGIN_MS;

  async function acceptTokens(tokens) {
    try {
      await tokenStore.save({ refreshToken: tokens.refreshToken, userId: tokens.userId });
    } catch {
      await client.revoke(tokens.refreshToken).catch(() => {});
      settle(IdentityState.NetworkUnavailable);
      return false;
    }
    account = { userId: tokens.userId, sessionId: tokens.sessionId };
    access = { token: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt };
    offline = false;
    settle(IdentityState.Authenticated);
    return true;
  }

  async function expire() {
    await tokenStore.clear().catch(() => {});
    settle(IdentityState.Expired);
  }

  // A rotation must stay on the account (and session) it was issued for; anything else is revoked.
  async function adoptRotation(tokens, expected) {
    if (
      (expected.userId && tokens.userId !== expected.userId)
      || (expected.sessionId && tokens.sessionId !== expected.sessionId)
    ) {
      await client.revoke(tokens.refreshToken).catch(() => {});
      await expire();
      return false;
    }
    return acceptTokens(tokens);
  }

  function signIn({ email, password, rememberEmail } = {}) {
    return exclusive(async () => {
      if (!configured) {
        settle(IdentityState.NotConfigured);
        publish();
        return view();
      }
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || typeof password !== 'string' || password === '') {
        settle(IdentityState.InvalidCredentials);
        publish();
        return view(normalizedEmail ? MISSING_PASSWORD_MESSAGE : INVALID_EMAIL_MESSAGE);
      }
      settle(IdentityState.Authenticating);
      publish();
      let tokens;
      try {
        tokens = await client.exchange(await client.authorize({ email: normalizedEmail, password }));
      } catch (error) {
        settle(signInFailureState(error));
        publish();
        return view();
      }
      if (await acceptTokens(tokens)) {
        rememberedEmail = rememberEmail === true ? normalizedEmail : null;
        try {
          await preferences?.save({ rememberedEmail });
        } catch {
          // Remembering the email is a convenience; the sign-in already succeeded.
        }
      }
      publish();
      return view();
    });
  }

  function restore() {
    return exclusive(async () => {
      if (!configured) {
        settle(IdentityState.NotConfigured);
        publish();
        return view();
      }
      let stored;
      try {
        stored = await tokenStore.load();
      } catch {
        settle(IdentityState.NetworkUnavailable);
        publish();
        return view();
      }
      if (!stored) {
        settle(IdentityState.SignedOut);
        publish();
        return view();
      }
      const expected = {
        userId: stored.userId,
        sessionId: stored.userId && account?.userId === stored.userId ? account.sessionId : null,
      };
      state = IdentityState.Authenticating;
      publish();
      let tokens;
      try {
        tokens = await client.rotate(stored.refreshToken);
      } catch (error) {
        if (error?.failure === IdentityFailure.InvalidSession) {
          await expire();
        } else if (stored.userId) {
          account = expected;
          access = null;
          offline = true;
          settle(IdentityState.Authenticated);
        } else {
          settle(IdentityState.NetworkUnavailable);
        }
        publish();
        return view();
      }
      await adoptRotation(tokens, expected);
      publish();
      return view();
    });
  }

  async function refreshAccess() {
    if (state !== IdentityState.Authenticated || !account) return null;
    if (hasFreshAccess()) return access.token;
    let stored;
    try {
      stored = await tokenStore.load();
    } catch {
      return null;
    }
    if (!stored) {
      settle(IdentityState.Expired);
      publish();
      return null;
    }
    const expected = { ...account };
    let tokens;
    try {
      tokens = await client.rotate(stored.refreshToken);
    } catch (error) {
      if (error?.failure === IdentityFailure.InvalidSession) {
        await expire();
        publish();
        return null;
      }
      if (access && access.expiresAt > now()) return access.token;
      // Keep the verified account for a later retry; an expired token is never handed out.
      access = null;
      offline = true;
      publish();
      return null;
    }
    const accepted = await adoptRotation(tokens, expected);
    publish();
    return accepted ? access.token : null;
  }

  // Concurrent callers share one rotation: presenting the same refresh token twice would
  // trip Identity's reuse detection.
  function getAccessToken() {
    if (state === IdentityState.Authenticated && hasFreshAccess()) return Promise.resolve(access.token);
    refreshing ??= exclusive(refreshAccess)
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function signOut() {
    return exclusive(async () => {
      let stored;
      if (tokenStore) {
        stored = await tokenStore.load().catch(() => null);
        // A failed local clear must not be reported as logout: restart would restore it.
        await tokenStore.clear();
      }
      settle(configured ? IdentityState.SignedOut : IdentityState.NotConfigured);
      publish();
      if (canReachIdentity && stored) await client.revoke(stored.refreshToken).catch(() => {});
      return view();
    });
  }

  async function register(request) {
    const { registration, fieldErrors } = validateRegistration(request);
    if (!registration) return actionProblem(CHECK_FIELDS_MESSAGE, fieldErrors);
    if (!canReachIdentity) return actionProblem('身份服务尚未连接。本次不会创建账号或发送邮件。');
    try {
      await client.register(registration);
    } catch (error) {
      return actionProblem(
        REGISTRATION_FAILURE_MESSAGES[error?.failure] ?? REGISTRATION_FAILURE_MESSAGES.unavailable,
      );
    }
    return {
      accepted: true,
      problem: false,
      message: REGISTRATION_ACCEPTED_MESSAGE,
      fieldErrors: emptyFieldErrors(),
      pendingEmail: registration.email,
      mailboxUrl: mailboxUrl(registration.email),
    };
  }

  async function recoverPassword({ email } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const emailProblem = { ...emptyFieldErrors(), email: INVALID_EMAIL_MESSAGE };
    if (!normalizedEmail) return actionProblem(CHECK_FIELDS_MESSAGE, emailProblem);
    if (!canReachIdentity) return actionProblem('身份服务尚未连接。本次不会发送邮件。');
    try {
      await client.recoverPassword(normalizedEmail);
    } catch (error) {
      if (error?.failure === IdentityFailure.RateLimited) {
        return actionProblem('找回密码请求过多，请稍后再试。');
      }
      if (error?.failure === IdentityFailure.InvalidInput) {
        return actionProblem(INVALID_EMAIL_MESSAGE, emailProblem);
      }
      return actionProblem('身份服务当前不可用。本次没有发送邮件。');
    }
    return {
      accepted: true,
      problem: false,
      message: RECOVERY_ACCEPTED_MESSAGE,
      fieldErrors: emptyFieldErrors(),
      pendingEmail: null,
      mailboxUrl: null,
    };
  }

  async function status() {
    await ready;
    return view();
  }

  function userId() {
    return state === IdentityState.Authenticated ? account?.userId ?? null : null;
  }

  function onChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('Identity listener must be a function');
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return Object.freeze({
    status,
    restore,
    signIn,
    register,
    recoverPassword,
    signOut,
    getAccessToken,
    userId,
    onChange,
  });
}
