import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { releasePaths } from './installation.mjs';

const OPAQUE_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// Values meant for other launchers or for a pending update handover, never for the backend.
const FOREIGN_VARIABLES = [
  'COLLAB_PORT',
  'VITE_COLLAB_PORT',
  'AIFISHER_COLLAB_INTERNAL_SECRET',
  'AIFISHER_CONTROLLER_PID',
  'SERVER_PORT',
  'ELECTRON_RUN_AS_NODE',
  'AIFISHER_UPDATE_STARTUP_TRANSACTION',
  'AIFISHER_UPDATE_STARTUP_TOKEN',
  'AIFISHER_UPDATE_STARTUP_VERSION',
  'AIFISHER_UPDATE_GUARD_CODE',
  'AIFISHER_UPDATE_GUARD_OWNER_PID',
];

// runtimeControl.mjs and providerCredentialStore.mjs ship in app/tools; reuse them as-is.
export async function loadReleaseHelpers(toolsDirectory) {
  const load = (name) => import(pathToFileURL(path.join(toolsDirectory, name)).href);
  const [runtime, credentials] = await Promise.all([
    load('runtimeControl.mjs'),
    load('providerCredentialStore.mjs'),
  ]);
  return {
    providerSecretKeys: runtime.USER_PROVIDER_SECRET_KEYS,
    loadIdentityConfiguration: runtime.loadPackagedIdentityRuntimeConfiguration,
    loadProductVersion: runtime.loadPackagedProductVersion,
    credentialFileName: credentials.PROVIDER_CREDENTIAL_FILE_NAME,
    createCredentialStore: ({ filePath, helperPath }) =>
      credentials.createProviderCredentialStore({
        filePath,
        allowedKeys: runtime.USER_PROVIDER_SECRET_KEYS,
        protector: credentials.createWindowsDpapiProtector({ helperPath }),
      }),
  };
}

export function parseEnvironment(text) {
  const result = {};
  for (const line of String(text || '').split(/\r?\n/u)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function withoutKeys(text, keys) {
  const kept = String(text || '')
    .split(/\r?\n/u)
    .filter((line) => !keys.has(/^\s*([A-Z][A-Z0-9_]*)\s*=/u.exec(line)?.[1]));
  while (kept.length > 0 && kept.at(-1) === '') kept.pop();
  return `${kept.join('\n')}\n`;
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function writeTextAtomic(file, contents) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readIdentityIssuer({ installation, helpers }) {
  const values = await helpers.loadIdentityConfiguration(releasePaths(installation), {
    required: installation.packaged,
  });
  return values.AIFISHER_ACCESS_TOKEN_ISSUER ?? null;
}

// Mirrors runtimeControl's start environment, plus the pipe and the Identity origin.
export async function createBackendEnvironment({
  installation,
  userId,
  pipe,
  helpers,
  baseEnvironment = process.env,
}) {
  if (!OPAQUE_USER_ID.test(String(userId)) || userId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('INVALID_USER_SCOPE');
  }
  await mkdir(installation.logs, { recursive: true });
  await mkdir(installation.config, { recursive: true });
  try {
    await copyFile(installation.envTemplate, installation.envFile, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!['EEXIST', 'ENOENT'].includes(error?.code)) throw error;
  }
  const paths = releasePaths(installation);
  const environment = {
    ...baseEnvironment,
    ...parseEnvironment(await readText(installation.envFile)),
    ...(await helpers.loadIdentityConfiguration(paths, { required: installation.packaged })),
    AIFISHER_PRODUCT_VERSION: await helpers.loadProductVersion(paths),
  };
  for (const key of FOREIGN_VARIABLES) delete environment[key];

  const userRoot = path.join(installation.data, 'users', userId);
  const providerEnvironmentPath = path.join(userRoot, 'config', 'providers.env');
  const credentialPath = path.join(userRoot, 'private', helpers.credentialFileName);
  await mkdir(path.dirname(providerEnvironmentPath), { recursive: true });
  await mkdir(path.dirname(credentialPath), { recursive: true });
  const store = helpers.createCredentialStore({
    filePath: credentialPath,
    helperPath: installation.providerCredentialHelper,
  });
  const secretKeys = new Set(helpers.providerSecretKeys);
  const providerText = await readText(providerEnvironmentPath);
  const providerValues = parseEnvironment(providerText);
  const legacySecrets = Object.fromEntries(
    Object.entries(providerValues).filter(([key, value]) => secretKeys.has(key) && value),
  );
  if (Object.keys(legacySecrets).length > 0) {
    // Plaintext keys left by old versions move into the DPAPI store before the backend starts.
    await store.update(legacySecrets);
    await writeTextAtomic(providerEnvironmentPath, withoutKeys(providerText, secretKeys));
  }
  for (const key of secretKeys) {
    delete environment[key];
    delete providerValues[key];
  }
  Object.assign(environment, providerValues, await store.read(), {
    NODE_ENV: 'production',
    FISHERAI_APP_DIR: installation.code,
    FISHERAI_DATA_DIR: installation.data,
    FISHERAI_LIBRARY_DIR: path.join(userRoot, 'library'),
    FISHERAI_LOGS_DIR: installation.logs,
    FISHERAI_ENV_PATH: providerEnvironmentPath,
    FISHERAI_PROVIDER_CREDENTIAL_PATH: credentialPath,
    FISHERAI_PROVIDER_CREDENTIAL_HELPER: installation.providerCredentialHelper,
    AIFISHER_ACTIVE_USER_ID: userId,
    AIFISHER_BACKEND_PIPE: pipe,
  });
  if (environment.AIFISHER_ACCESS_TOKEN_ISSUER) {
    environment.AIFISHER_IDENTITY_ORIGIN = environment.AIFISHER_ACCESS_TOKEN_ISSUER;
  }
  return environment;
}
