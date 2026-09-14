import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCanonicalOpaqueUserId } from './userScopeResolver.js';

function configuredPath(value) {
  const normalized = String(value || '').trim();
  return normalized ? path.resolve(normalized) : null;
}

function resolveDefaultAppDirectory() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
}

export function resolveRuntimePaths({
  appRoot = process.env.FISHERAI_APP_DIR,
  dataDirectory = process.env.FISHERAI_DATA_DIR,
  libraryDirectory = process.env.FISHERAI_LIBRARY_DIR,
  logsDirectory = process.env.FISHERAI_LOGS_DIR,
  envPath = process.env.FISHERAI_ENV_PATH,
  activeOpaqueUserId = process.env.AIFISHER_ACTIVE_USER_ID,
} = {}) {
  const APP_DIR = configuredPath(appRoot) || resolveDefaultAppDirectory();
  const configuredDataDirectory = configuredPath(dataDirectory);
  const DATA_DIR = configuredDataDirectory || APP_DIR;
  const portableLayout = Boolean(configuredDataDirectory);
  const CONFIG_DIR = portableLayout ? path.join(DATA_DIR, 'config') : APP_DIR;
  // The legacy single-user layout remains readable until an explicitly reviewed
  // migration is applied. All new multi-user state has one stable root in both
  // development and portable packages.
  const USER_SCOPE_DATA_DIR = portableLayout ? DATA_DIR : path.join(APP_DIR, 'data');
  const USERS_DATA_DIR = path.join(USER_SCOPE_DATA_DIR, 'users');
  const configuredActiveUserId = String(activeOpaqueUserId || '').trim();
  const ACTIVE_OPAQUE_USER_ID = configuredActiveUserId
    ? assertCanonicalOpaqueUserId(configuredActiveUserId)
    : null;
  const ACTIVE_USER_ROOT_DIR = ACTIVE_OPAQUE_USER_ID
    ? path.join(USERS_DATA_DIR, ACTIVE_OPAQUE_USER_ID)
    : null;
  const activeLibraryDirectory = ACTIVE_USER_ROOT_DIR
    ? path.join(ACTIVE_USER_ROOT_DIR, 'library')
    : null;
  const activeConfigDirectory = ACTIVE_USER_ROOT_DIR
    ? path.join(ACTIVE_USER_ROOT_DIR, 'config')
    : null;
  const activePrivateDirectory = ACTIVE_USER_ROOT_DIR
    ? path.join(ACTIVE_USER_ROOT_DIR, 'private')
    : null;
  return {
    APP_DIR,
    SERVER_DIR: path.join(APP_DIR, 'server'),
    DIST_DIR: path.join(APP_DIR, 'dist'),
    BIN_DIR: path.join(APP_DIR, 'bin'),
    INTEGRATIONS_DIR: path.join(APP_DIR, 'integrations'),
    PUBLIC_DIR: path.join(APP_DIR, 'public'),
    MODELS_DIR: path.join(APP_DIR, 'models'),
    DATA_DIR,
    USER_SCOPE_DATA_DIR,
    USERS_DATA_DIR,
    GLOBAL_DATA_DIR: path.join(USER_SCOPE_DATA_DIR, 'global'),
    MIGRATIONS_DIR: path.join(USER_SCOPE_DATA_DIR, 'migrations'),
    ACTIVE_OPAQUE_USER_ID,
    ACTIVE_USER_ROOT_DIR,
    LIBRARY_DIR: activeLibraryDirectory
      || configuredPath(libraryDirectory)
      || path.join(DATA_DIR, 'library'),
    PRIVATE_DIR: activePrivateDirectory || path.join(DATA_DIR, 'private'),
    LOGS_DIR: configuredPath(logsDirectory) || path.join(DATA_DIR, 'logs'),
    CONFIG_DIR: activeConfigDirectory || CONFIG_DIR,
    ENV_PATH: activeConfigDirectory
      ? path.join(activeConfigDirectory, 'providers.env')
      : (configuredPath(envPath) || path.join(CONFIG_DIR, '.env')),
    RUN_DIR: path.join(DATA_DIR, 'run'),
  };
}

export const RUNTIME_PATHS = resolveRuntimePaths();
