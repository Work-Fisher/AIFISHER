import {
  createActiveUserAuthenticationContext,
  UserScopeError,
} from '../workspace/userScopeResolver.js';

const PROXY_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
];
const REQUEST_CONTEXTS = new WeakMap();
const DESKTOP_SESSION_ID = 'desktop';
// The backend lives no longer than one signed-in desktop session; the far expiry only keeps
// consumers that compare it (external Codex grants) working.
const ACTIVE_USER_CONTEXT_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

function publicError(response, status, code, message) {
  response.status(status).json({ error: message, code });
}

function parseTrustedOrigins(values) {
  const origins = new Set();
  for (const value of values || []) {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) throw new Error('Trusted browser origin is invalid');
    origins.add(parsed.origin);
  }
  if (origins.size === 0) throw new Error('At least one trusted browser origin is required');
  return origins;
}

function hasProxyHeaders(request) {
  return PROXY_HEADERS.some((header) => request.headers[header] !== undefined);
}

// Only for the loopback TCP listener: it keeps other web pages in the user's browser away
// from the local port. The named pipe is unreachable from browsers and needs no such check.
export function createExactLocalBoundary({ trustedOrigins }) {
  const allowedOrigins = parseTrustedOrigins(trustedOrigins);
  const allowedHeaders = 'Content-Type, X-Request-Id';
  const allowedMethods = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

  return (request, response, next) => {
    if (hasProxyHeaders(request)) {
      publicError(response, 403, 'UNTRUSTED_PROXY', '请求来源不受信任');
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      publicError(response, 403, 'UNTRUSTED_ORIGIN', '请求来源不受信任');
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Headers', allowedHeaders);
      response.setHeader('Access-Control-Allow-Methods', allowedMethods);
      response.setHeader('Access-Control-Max-Age', '600');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Every request that reaches the backend comes from the active user's own desktop window,
 * so the request context is fixed at startup: the user chosen by the main process, that
 * user's directories, and a way to ask the main process for a current Identity token.
 */
export function createActiveUserContext({
  activeOpaqueUserId,
  userScopeResolver,
  getAccessToken,
  clock = () => new Date(),
} = {}) {
  if (typeof userScopeResolver?.ensureDirectories !== 'function') {
    throw new Error('User-scope resolver is missing');
  }
  if (typeof getAccessToken !== 'function') throw new Error('Access-token provider is missing');
  const issuedAt = Math.floor(clock().getTime() / 1_000);
  const identity = Object.freeze({
    opaqueUserId: activeOpaqueUserId,
    sessionId: DESKTOP_SESSION_ID,
    tokenId: DESKTOP_SESSION_ID,
    issuedAt,
    expiresAt: issuedAt + ACTIVE_USER_CONTEXT_TTL_SECONDS,
  });
  const scope = userScopeResolver.ensureDirectories(createActiveUserAuthenticationContext(identity));
  async function readAccessToken() {
    try {
      const token = await getAccessToken();
      return typeof token === 'string' && token ? token : null;
    } catch {
      return null;
    }
  }
  return Object.freeze({ identity, scope, getAccessToken: readAccessToken });
}

export function attachActiveUserContext(context) {
  if (!context?.identity || !context?.scope || typeof context.getAccessToken !== 'function') {
    throw new Error('Active-user context is invalid');
  }
  return (request, _response, next) => {
    REQUEST_CONTEXTS.set(request, context);
    next();
  };
}

export function getAuthenticatedRequest(request) {
  const context = REQUEST_CONTEXTS.get(request);
  if (!context) {
    throw new UserScopeError('请求缺少服务端认证上下文', 'SERVER_AUTH_CONTEXT_REQUIRED');
  }
  return context;
}
