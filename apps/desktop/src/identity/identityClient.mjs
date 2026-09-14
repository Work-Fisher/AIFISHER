import crypto from 'node:crypto';
import { isCanonicalUuid, isJwt, isUrlSafeToken, parseUtcTimestamp } from './identityValidation.mjs';

// Port of IdentityClient in apps/tauri-shell/src-tauri/src/identity.rs.
export const CLIENT_ID = 'aifisher-control-center';
export const REDIRECT_URI = 'aifisher://oauth/callback';
export const DEVICE_LABEL = 'AIFISHER Windows desktop';

export const REQUEST_TIMEOUT_MS = 20_000;
export const ROTATION_TIMEOUT_MS = 6_000;
export const ROTATION_RETRY_DELAY_MS = 1_500;
export const ROTATION_ATTEMPTS = 3;
const MAXIMUM_TOKEN_RESPONSE_BYTES = 16 * 1024;
const MAXIMUM_AUTHORIZATION_RESPONSE_BYTES = 4 * 1024;
const MAXIMUM_AGREEMENTS_RESPONSE_BYTES = 1024 * 1024;
const MAXIMUM_ACTION_RESPONSE_BYTES = 1024;
const AUTHORIZATION_CODE_MAXIMUM_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_FIELDS = [
  'accessToken',
  'accessTokenExpiresAt',
  'refreshToken',
  'refreshTokenExpiresAt',
  'sessionId',
  'userId',
];
const AGREEMENT_FIELDS = ['code', 'content', 'sha256', 'version'];
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const IdentityFailure = Object.freeze({
  InvalidCredentials: 'invalidCredentials',
  InvalidSession: 'invalidSession',
  RateLimited: 'rateLimited',
  ConnectUnavailable: 'connectUnavailable',
  Unavailable: 'unavailable',
  InvalidInput: 'invalidInput',
});

export class IdentityRequestError extends Error {
  constructor(failure, { phase = 'response', timedOut = false } = {}) {
    super(`Identity request failed (${failure})`);
    this.name = 'IdentityRequestError';
    this.failure = failure;
    this.phase = phase;
    this.timedOut = timedOut;
  }
}

const failure = (kind) => new IdentityRequestError(kind);
const unavailable = () => failure(IdentityFailure.Unavailable);

// Failures that happen before any request byte can reach the server (reqwest is_connect()).
// Only these are safe to retry: a replayed refresh token would trip reuse detection.
const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'EHOSTDOWN',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const CHROMIUM_CONNECT_ERROR = /\bnet::ERR_(?:CONNECTION_REFUSED|CONNECTION_FAILED|CONNECTION_TIMED_OUT|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|ADDRESS_INVALID|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED)\b/u;

export function isConnectFailure(error) {
  const pending = [error];
  for (let inspected = 0; pending.length > 0 && inspected < 8; inspected += 1) {
    const current = pending.shift();
    if (!current || typeof current !== 'object') continue;
    if (CONNECT_ERROR_CODES.has(current.code)) return true;
    if (typeof current.message === 'string' && CHROMIUM_CONNECT_ERROR.test(current.message)) return true;
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return false;
}

export function parseIssuer(issuer, { allowInsecure = false } = {}) {
  let url;
  try {
    url = new URL(String(issuer));
  } catch {
    throw new Error('Identity issuer is invalid');
  }
  const schemeAllowed = url.protocol === 'https:' || (allowInsecure && url.protocol === 'http:');
  if (!schemeAllowed || url.href !== `${url.origin}/`) throw new Error('Identity issuer is invalid');
  return url;
}

function discard(response) {
  response.body?.cancel().catch(() => {});
}

async function readBounded(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (declaredLength > maximumBytes || !response.body) {
    discard(response);
    throw unavailable();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        reader.cancel().catch(() => {});
        throw unavailable();
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch {
    throw unavailable();
  }
  if (total < 2) throw unavailable();
  return Buffer.concat(chunks);
}

function parseJson(bytes) {
  try {
    return JSON.parse(utf8.decode(bytes));
  } catch {
    throw unavailable();
  } finally {
    bytes.fill(0);
  }
}

function isExactObject(value, fields) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function validAgreement(document, expectedCode) {
  return isExactObject(document, AGREEMENT_FIELDS)
    && AGREEMENT_FIELDS.every((field) => typeof document[field] === 'string')
    && document.code === expectedCode
    && document.content.trim() !== ''
    && document.version.trim() !== ''
    && Buffer.byteLength(document.version, 'utf8') <= 64
    && SHA256_HEX.test(document.sha256);
}

function asActionFailure(error) {
  return error?.failure === IdentityFailure.RateLimited || error?.failure === IdentityFailure.InvalidInput
    ? error
    : unavailable();
}

async function parseActionResponse(response) {
  if (response.status === 202) {
    const value = parseJson(await readBounded(response, MAXIMUM_ACTION_RESPONSE_BYTES));
    if (!isExactObject(value, ['accepted']) || value.accepted !== true) throw unavailable();
    return;
  }
  discard(response);
  if (response.status === 429) throw failure(IdentityFailure.RateLimited);
  if (response.status === 422) throw failure(IdentityFailure.InvalidInput);
  throw unavailable();
}

function registrationStatusEvent(status) {
  switch (status) {
    case 202: return 'registration-http-accepted';
    case 403: return 'registration-http-forbidden';
    case 409: return 'registration-agreements-changed';
    case 422: return 'registration-input-rejected';
    case 429: return 'registration-rate-limited';
    default: return status >= 500 && status <= 599
      ? 'registration-http-unavailable'
      : 'registration-http-unexpected';
  }
}

export function createIdentityClient({
  issuer,
  fetchImpl,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onDiagnostic = () => {},
  allowInsecureIssuerForTests = false,
} = {}) {
  const origin = parseIssuer(issuer, { allowInsecure: allowInsecureIssuerForTests === true });
  if (typeof fetchImpl !== 'function') throw new Error('Identity fetch implementation is required');
  const record = (event) => {
    try {
      onDiagnostic(event);
    } catch {
      // Diagnostics never change the identity result.
    }
  };

  // The timeout covers the whole exchange, body included, like reqwest's request timeout.
  async function send(pathname, { method = 'POST', body, timeoutMs = REQUEST_TIMEOUT_MS }, handle) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(new URL(pathname, origin).href, {
          method,
          headers: body === undefined
            ? { 'Cache-Control': 'no-store' }
            : { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = controller.signal.aborted;
        throw new IdentityRequestError(
          !timedOut && isConnectFailure(error) ? IdentityFailure.ConnectUnavailable : IdentityFailure.Unavailable,
          { phase: 'send', timedOut },
        );
      }
      if (response.redirected) {
        discard(response);
        throw unavailable();
      }
      try {
        return await handle(response);
      } catch (error) {
        if (error instanceof IdentityRequestError) throw error;
        throw unavailable();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function authorize({ email, password }) {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
    const body = {
      email,
      password,
      deviceLabel: DEVICE_LABEL,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge,
      codeChallengeMethod: 'S256',
    };
    let authorizationCode;
    try {
      authorizationCode = await send('v1/authorization-codes', { body }, async (response) => {
        if (response.status !== 201) {
          discard(response);
          if (response.status === 401) throw failure(IdentityFailure.InvalidCredentials);
          if (response.status === 429) throw failure(IdentityFailure.RateLimited);
          throw unavailable();
        }
        const value = parseJson(await readBounded(response, MAXIMUM_AUTHORIZATION_RESPONSE_BYTES));
        if (
          !isExactObject(value, ['authorizationCode', 'expiresAt'])
          || typeof value.authorizationCode !== 'string'
          || typeof value.expiresAt !== 'string'
        ) {
          throw unavailable();
        }
        const expiresAt = parseUtcTimestamp(value.expiresAt);
        const current = now();
        if (
          expiresAt === null
          || !isUrlSafeToken(value.authorizationCode, 43)
          || expiresAt <= current
          || expiresAt - current > AUTHORIZATION_CODE_MAXIMUM_LIFETIME_MS
        ) {
          throw unavailable();
        }
        return value.authorizationCode;
      });
    } catch (error) {
      throw error?.failure === IdentityFailure.ConnectUnavailable ? unavailable() : error;
    }
    return { authorizationCode, codeVerifier };
  }

  function tokenRequest(body, timeoutMs = REQUEST_TIMEOUT_MS, endpoint = 'v1/token-exchanges') {
    return send(endpoint, { body, timeoutMs }, async (response) => {
      if (response.status !== 200) {
        discard(response);
        if (response.status === 401 || response.status === 403) throw failure(IdentityFailure.InvalidSession);
        if (response.status === 429) throw failure(IdentityFailure.RateLimited);
        throw unavailable();
      }
      const value = parseJson(await readBounded(response, MAXIMUM_TOKEN_RESPONSE_BYTES));
      if (!isExactObject(value, TOKEN_FIELDS) || TOKEN_FIELDS.some((field) => typeof value[field] !== 'string')) {
        throw unavailable();
      }
      const accessTokenExpiresAt = parseUtcTimestamp(value.accessTokenExpiresAt);
      const refreshTokenExpiresAt = parseUtcTimestamp(value.refreshTokenExpiresAt);
      if (
        accessTokenExpiresAt === null
        || refreshTokenExpiresAt === null
        || !isCanonicalUuid(value.userId)
        || !isCanonicalUuid(value.sessionId)
        || !isJwt(value.accessToken)
        || !isUrlSafeToken(value.refreshToken, 43)
        || accessTokenExpiresAt <= now()
        || refreshTokenExpiresAt <= accessTokenExpiresAt
      ) {
        throw unavailable();
      }
      return {
        userId: value.userId,
        sessionId: value.sessionId,
        accessToken: value.accessToken,
        accessTokenExpiresAt,
        refreshToken: value.refreshToken,
      };
    });
  }

  function exchange({ authorizationCode, codeVerifier }) {
    return tokenRequest({
      grantType: 'authorization_code',
      authorizationCode,
      codeVerifier,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    });
  }

  async function rotate(refreshToken) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await tokenRequest({ grantType: 'refresh_token', refreshToken }, ROTATION_TIMEOUT_MS);
      } catch (error) {
        if (error?.failure !== IdentityFailure.ConnectUnavailable || attempt >= ROTATION_ATTEMPTS - 1) {
          throw error;
        }
      }
      await sleep(ROTATION_RETRY_DELAY_MS);
    }
  }

  async function revoke(refreshToken) {
    try {
      await send('v1/session-revocations', { body: { refreshToken } }, async (response) => {
        discard(response);
        if (response.status === 204) return;
        throw response.status === 401 ? failure(IdentityFailure.InvalidSession) : unavailable();
      });
    } catch (error) {
      throw error?.failure === IdentityFailure.ConnectUnavailable ? unavailable() : error;
    }
  }

  async function fetchAgreements() {
    try {
      return await send('v1/agreements/current', { method: 'GET' }, async (response) => {
        if (response.status !== 200) {
          discard(response);
          throw unavailable();
        }
        const value = parseJson(await readBounded(response, MAXIMUM_AGREEMENTS_RESPONSE_BYTES));
        if (
          !isExactObject(value, ['terms', 'privacy'])
          || !validAgreement(value.terms, 'terms')
          || !validAgreement(value.privacy, 'privacy')
        ) {
          throw unavailable();
        }
        return { terms: value.terms, privacy: value.privacy };
      });
    } catch {
      throw unavailable();
    }
  }

  // A 409 means the agreements changed between reading and submitting: re-read them once.
  async function register({ email, displayName, password }) {
    record('registration-started');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let agreements;
      try {
        agreements = await fetchAgreements();
      } catch (error) {
        record('registration-agreements-failed');
        throw error;
      }
      const body = {
        email,
        displayName,
        password,
        agreements: {
          termsVersion: agreements.terms.version,
          privacyVersion: agreements.privacy.version,
          termsAccepted: true,
          privacyAccepted: true,
        },
      };
      let retry = false;
      try {
        await send('v1/registrations', { body }, async (response) => {
          record(registrationStatusEvent(response.status));
          if (response.status === 409 && attempt === 0) {
            discard(response);
            retry = true;
            return;
          }
          await parseActionResponse(response);
        });
      } catch (error) {
        if (error?.phase === 'send') {
          record(error.timedOut
            ? 'registration-send-timeout'
            : error.failure === IdentityFailure.ConnectUnavailable
              ? 'registration-connect-failed'
              : 'registration-send-failed');
        }
        throw asActionFailure(error);
      }
      if (!retry) return;
    }
    throw unavailable();
  }

  async function recoverPassword(email) {
    try {
      await send(
        'v1/password-reset-requests',
        { body: { email, deviceLabel: DEVICE_LABEL } },
        parseActionResponse,
      );
    } catch (error) {
      throw asActionFailure(error);
    }
  }

  return Object.freeze({
    issuer: origin.href,
    deviceSession: ({ deviceId, secret }) => tokenRequest({ deviceId, secret }, ROTATION_TIMEOUT_MS, 'v1/device-sessions'),
    authorize,
    exchange,
    rotate,
    revoke,
    fetchAgreements,
    register,
    recoverPassword,
  });
}
