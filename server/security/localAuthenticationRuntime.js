import { createUserScopeResolver } from '../workspace/userScopeResolver.js';
import { createIdentityProfileClient } from './identityProfileClient.js';
import { createIdentityAccountClient } from './identityAccountClient.js';

function configured(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function trustedOrigins(value, port) {
  const configuredOrigins = configured(value);
  return configuredOrigins
    ? configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

// runtimeControl still passes only the session-status URL; its origin is the Identity origin.
function identityOrigin(env) {
  const source = configured(env.AIFISHER_IDENTITY_ORIGIN) || configured(env.AIFISHER_SESSION_STATUS_URL);
  if (!source) return null;
  try {
    const origin = new URL(source).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

// Identity is optional at runtime: offline or unconfigured, the canvas keeps working and
// only the account features (profile, feedback, admin, telemetry delivery) are unavailable.
function createIdentityClients(origin) {
  if (!origin) return { identityProfileClient: null, identityAccountClient: null };
  try {
    return {
      identityProfileClient: createIdentityProfileClient({ endpoint: new URL('/v1/profile', origin).href }),
      identityAccountClient: createIdentityAccountClient({ origin: `${origin}/` }),
    };
  } catch {
    return { identityProfileClient: null, identityAccountClient: null };
  }
}

export function inspectLocalAuthenticationConfiguration({
  env = process.env,
  runtimePaths,
  port,
} = {}) {
  const activeOpaqueUserId = runtimePaths?.ACTIVE_OPAQUE_USER_ID;
  if (!activeOpaqueUserId) return Object.freeze({ ready: false, code: 'LOCAL_AUTHENTICATION_LOCKED' });
  try {
    const userScopeResolver = createUserScopeResolver({
      usersDirectory: runtimePaths.USERS_DATA_DIR,
      globalDirectory: runtimePaths.GLOBAL_DATA_DIR,
    });
    return Object.freeze({
      ready: true,
      activeOpaqueUserId,
      userScopeResolver,
      ...createIdentityClients(identityOrigin(env)),
      trustedOrigins: Number.isInteger(port) ? trustedOrigins(env.AIFISHER_TRUSTED_ORIGINS, port) : null,
    });
  } catch {
    return Object.freeze({ ready: false, code: 'LOCAL_AUTHENTICATION_LOCKED' });
  }
}
