import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SHARED_RESOURCE_ALLOWLIST } from './resourceOwnership.js';

const AUTHENTICATION_CONTEXTS = new WeakMap();
const CANONICAL_OPAQUE_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESERVED_NAMES = new Set([
  '.',
  '..',
  'aux',
  'com1',
  'con',
  'global',
  'lpt1',
  'nul',
  'prn',
  'shared',
  'system',
  'temp',
  'tmp',
  'users',
]);
const WINDOWS_RESERVED_NAME = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/;

export class UserScopeError extends Error {
  constructor(message, code = 'USER_SCOPE_INVALID', status = 403) {
    super(message);
    this.name = 'UserScopeError';
    this.code = code;
    this.status = status;
  }
}

export function assertCanonicalOpaqueUserId(value) {
  if (typeof value !== 'string' || !value) {
    throw new UserScopeError('认证主体缺少不透明用户标识', 'USER_SCOPE_SUBJECT_MISSING', 401);
  }
  if (value !== value.normalize('NFC') || /[^\x20-\x7e]/.test(value)) {
    throw new UserScopeError('认证主体不是规范 ASCII 标识', 'USER_SCOPE_SUBJECT_CONFUSABLE');
  }
  if (value !== value.toLowerCase()) {
    throw new UserScopeError('认证主体大小写不规范', 'USER_SCOPE_SUBJECT_NON_CANONICAL');
  }
  if (
    RESERVED_NAMES.has(value)
    || WINDOWS_RESERVED_NAME.test(value)
    || value.includes('/')
    || value.includes('\\')
  ) {
    throw new UserScopeError('认证主体使用了保留名称或路径字符', 'USER_SCOPE_SUBJECT_RESERVED');
  }
  if (!CANONICAL_OPAQUE_USER_ID.test(value) || value === '00000000-0000-0000-0000-000000000000') {
    throw new UserScopeError('认证主体不是规范不透明用户标识', 'USER_SCOPE_SUBJECT_INVALID');
  }
  return value;
}

function assertContained(rootDirectory, candidate) {
  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new UserScopeError('用户路径越出作用域', 'USER_SCOPE_PATH_ESCAPE');
  }
  return resolved;
}

function validateAllowlist(allowlist) {
  const normalized = {};
  for (const [resourceId, relativePath] of Object.entries(allowlist || {})) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(resourceId)) {
      throw new UserScopeError('共享资源标识无效', 'SHARED_RESOURCE_ALLOWLIST_INVALID', 500);
    }
    const raw = String(relativePath || '').replaceAll('\\', '/');
    const safe = path.posix.normalize(raw);
    if (!safe || safe === '..' || safe.startsWith('../') || safe.startsWith('/')) {
      throw new UserScopeError('共享资源路径无效', 'SHARED_RESOURCE_ALLOWLIST_INVALID', 500);
    }
    normalized[resourceId] = safe;
  }
  return Object.freeze(normalized);
}

function registerAuthenticationContext({ opaqueUserId, sessionId, tokenId, issuedAt, expiresAt }) {
  const context = Object.freeze({ authenticated: true });
  AUTHENTICATION_CONTEXTS.set(context, Object.freeze({
    opaqueUserId: assertCanonicalOpaqueUserId(opaqueUserId),
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    tokenId: typeof tokenId === 'string' ? tokenId : null,
    issuedAt: Number.isSafeInteger(issuedAt) ? issuedAt : null,
    expiresAt: Number.isSafeInteger(expiresAt) ? expiresAt : null,
  }));
  return context;
}

/**
 * Creates the only context accepted by the user-scope resolver. The verifier is
 * the server-side signed-token verifier; request headers, cookies, query values,
 * bodies and collaboration room names never become identity inputs here.
 */
export async function createServerAuthenticationContext({ accessToken, verifier }) {
  if (!verifier || typeof verifier.verify !== 'function') {
    throw new UserScopeError('服务端认证验证器缺失', 'AUTHENTICATION_VERIFIER_MISSING', 500);
  }
  const claims = await verifier.verify(accessToken);
  return registerAuthenticationContext({
    opaqueUserId: claims?.sub,
    sessionId: claims?.sid,
    tokenId: claims?.jti,
    issuedAt: claims?.iat,
    expiresAt: claims?.exp,
  });
}

/**
 * The desktop backend serves exactly one user, chosen by the Electron main process
 * before it starts the backend; no request input can change it.
 */
export function createActiveUserAuthenticationContext(identity) {
  return registerAuthenticationContext(identity || {});
}

export function resolveServerAuthenticationIdentity(authenticationContext) {
  const identity = AUTHENTICATION_CONTEXTS.get(authenticationContext);
  if (!identity) {
    throw new UserScopeError('仅接受服务端已验证认证上下文', 'SERVER_AUTH_CONTEXT_REQUIRED');
  }
  return identity;
}

export function createUserScopeResolver({
  usersDirectory,
  globalDirectory,
  sharedResourceAllowlist = DEFAULT_SHARED_RESOURCE_ALLOWLIST,
} = {}) {
  if (!usersDirectory || !globalDirectory) {
    throw new UserScopeError('用户或全局数据根目录缺失', 'USER_SCOPE_ROOT_MISSING', 500);
  }
  const usersRoot = path.resolve(usersDirectory);
  const globalRoot = path.resolve(globalDirectory);
  const sharedAllowlist = validateAllowlist(sharedResourceAllowlist);
  const initializedScopes = new Map();

  function resolve(authenticationContext) {
    const identity = resolveServerAuthenticationIdentity(authenticationContext);
    const opaqueUserId = assertCanonicalOpaqueUserId(identity.opaqueUserId);
    const rootDirectory = assertContained(usersRoot, path.join(usersRoot, opaqueUserId));
    const libraryDirectory = assertContained(rootDirectory, path.join(rootDirectory, 'library'));
    const privateDirectory = assertContained(rootDirectory, path.join(rootDirectory, 'private'));
    const temporaryDirectory = assertContained(rootDirectory, path.join(rootDirectory, 'tmp'));
    return Object.freeze({
      opaqueUserId,
      rootDirectory,
      libraryDirectory,
      mediaDirectory: path.join(libraryDirectory, 'media'),
      workflowDatabasePath: path.join(libraryDirectory, 'workflows.db'),
      agentSessionDirectory: path.join(libraryDirectory, 'agent', 'sessions'),
      yjsDatabasePath: path.join(libraryDirectory, 'collab', 'yjs-updates.db'),
      privateDirectory,
      agentSkillDirectory: path.join(privateDirectory, 'agent-skills'),
      executionWorkflowDirectory: path.join(privateDirectory, 'execution-workflows'),
      generationJournalPath: path.join(privateDirectory, 'generation', 'generation-tasks.json'),
      configDirectory: path.join(rootDirectory, 'config'),
      providerEnvironmentPath: path.join(rootDirectory, 'config', 'providers.env'),
      cacheDirectory: path.join(rootDirectory, 'cache'),
      temporaryDirectory,
      publicLibraryUrl: '/library',
    });
  }

  function resolveSharedResource(resourceId) {
    const relativePath = sharedAllowlist[resourceId];
    if (!relativePath) {
      throw new UserScopeError('共享资源不在显式白名单中', 'SHARED_RESOURCE_NOT_ALLOWLISTED');
    }
    return assertContained(globalRoot, path.join(globalRoot, ...relativePath.split('/')));
  }

  function ensureDirectories(authenticationContext) {
    const scope = resolve(authenticationContext);
    const initialized = initializedScopes.get(scope.opaqueUserId);
    if (initialized) return initialized;
    for (const directory of [
      scope.libraryDirectory,
      scope.mediaDirectory,
      scope.privateDirectory,
      scope.configDirectory,
      scope.cacheDirectory,
      scope.temporaryDirectory,
    ]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    initializedScopes.set(scope.opaqueUserId, scope);
    return scope;
  }

  return Object.freeze({ resolve, resolveSharedResource, ensureDirectories });
}
