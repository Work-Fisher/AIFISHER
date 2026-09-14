import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';
import { loadModelNames as loadCatalogModelNames } from '../config/modelCatalog.js';
import {
  createProviderCredentialStore,
  createWindowsDpapiProtector,
  PROVIDER_CREDENTIAL_FILE_NAME,
} from '../../scripts/release/providerCredentialStore.mjs';

const DEFAULT_ENV_PATH = RUNTIME_PATHS.ENV_PATH;
const DEFAULT_MODEL_CONFIG_PATH = path.join(
  RUNTIME_PATHS.APP_DIR,
  'src',
  'config',
  'modelConfig.ts',
);

export const SECRET_MASK = '********';

export const USER_PROVIDER_SECRET_KEYS = Object.freeze([
  'JIMENG_ACCESS_KEY',
  'JIMENG_SECRET_KEY',
  'ARK_API_KEY',
  'KLING_ACCESS_KEY',
  'KLING_SECRET_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'GROK_API_KEY',
  'DEEPSEEK_API_KEY',
  'ZHIPU_API_KEY',
  'MOONSHOT_API_KEY',
  'FAL_API_KEY',
  'ALIYUN_API_KEY',
  'MUREKA_API_KEY',
  'RELAY_API_KEY',
  'RUNNINGHUB_API_KEY',
  'RUNNINGHUB_GLOBAL_API_KEY',
  'RUNNINGHUB_IMAGE_ACCESS_PASSWORD',
  'RUNNINGHUB_VIDEO_ACCESS_PASSWORD',
  'TOS_ACCESS_KEY',
  'TOS_SECRET_KEY',
]);
const SECRET_KEYS = new Set(USER_PROVIDER_SECRET_KEYS);

// 「AIFISHER API」的独立配置。与官方各家、RunningHub 三者互不影响，
// 全 ASCII 键名、按来源前缀命名空间。
const RELAY_KEYS = [
  'RELAY_BASE_URL',
];

const RUNNINGHUB_KEYS = [
  'RUNNINGHUB_BASE_URL',
    // RH AI站（runninghub.ai）是独立账号，地址与密钥都和 CN 站分开。
  'RUNNINGHUB_GLOBAL_BASE_URL',
  'RUNNINGHUB_IMAGE_MODE',
  'RUNNINGHUB_IMAGE_WEBAPP_ID',
  'RUNNINGHUB_IMAGE_WORKFLOW_ID',
  'RUNNINGHUB_IMAGE_PROMPT_NODE_ID',
  'RUNNINGHUB_IMAGE_PROMPT_FIELD',
  'RUNNINGHUB_IMAGE_INPUT_NODE_ID',
  'RUNNINGHUB_IMAGE_INPUT_FIELD',
  'RUNNINGHUB_IMAGE_IMAGE_NODE_ID',
  'RUNNINGHUB_IMAGE_IMAGE_FIELD',
  'RUNNINGHUB_IMAGE_ASPECT_NODE_ID',
  'RUNNINGHUB_IMAGE_ASPECT_FIELD',
  'RUNNINGHUB_IMAGE_MODEL_NODE_ID',
  'RUNNINGHUB_IMAGE_MODEL_FIELD',
  'RUNNINGHUB_IMAGE_MODEL_VALUE',
  'RUNNINGHUB_IMAGE_ACCESS_PASSWORD',
  'RUNNINGHUB_IMAGE_INSTANCE_TYPE',
  'RUNNINGHUB_IMAGE_RETAIN_SECONDS',
  'RUNNINGHUB_IMAGE_NODE_INFO_JSON',
  'RUNNINGHUB_VIDEO_MODE',
  'RUNNINGHUB_VIDEO_WEBAPP_ID',
  'RUNNINGHUB_VIDEO_WORKFLOW_ID',
  'RUNNINGHUB_VIDEO_PROMPT_NODE_ID',
  'RUNNINGHUB_VIDEO_PROMPT_FIELD',
  'RUNNINGHUB_VIDEO_INPUT_NODE_ID',
  'RUNNINGHUB_VIDEO_INPUT_FIELD',
  'RUNNINGHUB_VIDEO_IMAGE_NODE_ID',
  'RUNNINGHUB_VIDEO_IMAGE_FIELD',
  'RUNNINGHUB_VIDEO_VIDEO_NODE_ID',
  'RUNNINGHUB_VIDEO_VIDEO_FIELD',
  'RUNNINGHUB_VIDEO_AUDIO_NODE_ID',
  'RUNNINGHUB_VIDEO_AUDIO_FIELD',
  'RUNNINGHUB_VIDEO_ASPECT_NODE_ID',
  'RUNNINGHUB_VIDEO_ASPECT_FIELD',
  'RUNNINGHUB_VIDEO_DURATION_NODE_ID',
  'RUNNINGHUB_VIDEO_DURATION_FIELD',
  'RUNNINGHUB_VIDEO_MODEL_NODE_ID',
  'RUNNINGHUB_VIDEO_MODEL_FIELD',
  'RUNNINGHUB_VIDEO_MODEL_VALUE',
  'RUNNINGHUB_VIDEO_ACCESS_PASSWORD',
  'RUNNINGHUB_VIDEO_INSTANCE_TYPE',
  'RUNNINGHUB_VIDEO_RETAIN_SECONDS',
  'RUNNINGHUB_VIDEO_NODE_INFO_JSON',
];

const NETWORK_KEYS = new Set(['TOS_ENDPOINT', 'HTTPS_PROXY', 'COMFYUI_SERVER_URL']);
const LOCAL_ONLY_DISABLED_KEYS = new Set(['SERVER_IP', 'COLLAB_HOST']);
const KNOWN_KEYS = new Set([
  ...SECRET_KEYS,
  ...RUNNINGHUB_KEYS,
  ...RELAY_KEYS,
  'TOS_BUCKET',
  'TOS_REGION',
  'TOS_ENDPOINT',
  'COMFYUI_SERVER_URL',
  'COMFYUI_AUTO_START',
  'COMFYUI_ROOT',
  'COMFYUI_PYTHON',
  'COMFYUI_EXTRA_ARGS',
  'COMFYUI_START_TIMEOUT_MS',
  'SERVER_PORT',
  'VITE_PORT',
  'HTTPS_PROXY',
]);
const MODEL_KEY_PREFIXES = ['MODEL_ENDPOINT_', 'MODEL_PROXY_', 'MODEL_ID_', 'MODEL_URL_'];

function isAllowedKey(key) {
  return KNOWN_KEYS.has(key) || MODEL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function fixProtocolSlashes(value = '') {
  return String(value || '').trim().replace(/^([a-zA-Z][a-zA-Z\d+.-]*):\/(?!\/)/, '$1://');
}

function parseUrlSafe(value = '') {
  try { return new URL(value); } catch { /* Try the supported shorthand below. */ }
  try { return new URL(`http://${value}`); } catch { /* Both forms are invalid. */ }
  return null;
}

function normalizeNetworkConfigValue(key, value) {
  const trimmed = String(value || '').trim();
  if (!NETWORK_KEYS.has(key) || !trimmed) return trimmed;
  const fixed = fixProtocolSlashes(trimmed).replace(/\s+/g, '');
  const parsed = parseUrlSafe(fixed);
  if (key === 'HTTPS_PROXY') {
    const proxyValue = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(fixed) ? fixed : `http://${fixed}`;
    const proxyUrl = parseUrlSafe(proxyValue);
    return proxyUrl ? `${proxyUrl.protocol}//${proxyUrl.host}` : proxyValue.replace(/\/+$/, '');
  }
  if (!parsed) return fixed.replace(/^(https?|wss?):\/\//i, '').replace(/\/+$/, '');
  if (key === 'TOS_ENDPOINT') return parsed.hostname || parsed.host || fixed;
  if (key === 'COMFYUI_SERVER_URL') return parsed.host || `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  return fixed;
}

function decodeValue(rawValue) {
  const value = String(rawValue || '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try { return JSON.parse(value); } catch { /* Preserve legacy quoted values. */ }
    }
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function parseEnvironment(content) {
  const config = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    if (isAllowedKey(key)) config[key] = decodeValue(match[2]);
  }
  return config;
}

function safeValue(value) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > 100_000 || /[\r\n\0]/.test(normalized)) {
    throw new Error('Configuration value is invalid');
  }
  return normalized;
}

function encodeValue(value) {
  return /[\s#'"\\]/.test(value) ? JSON.stringify(value) : value;
}

function loadModelNames(modelConfigPath) {
  // 与 /api/generate-* 共用同一份目录读取逻辑，避免两处解析器漂移：
  // 一旦口径不一致，就会出现「设置页列得出这个模型、生成时却说不支持」。
  return loadCatalogModelNames({ sourcePath: modelConfigPath });
}

function writePrivateFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(temporaryPath, 0o600); } catch { /* Windows may not support POSIX modes. */ }
    fs.renameSync(temporaryPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function serializeEnvironment(config) {
  const lines = [
    '# ============================================================================',
    '# AIFISHER 画布 配置文件 (.env)',
    '# 此文件由设置中心自动管理。',
    '# ============================================================================',
    '',
  ];
  const keys = Object.keys(config).filter(isAllowedKey).sort();
  for (const key of keys) lines.push(`${key} = ${encodeValue(config[key])}`);
  return `${lines.join('\n')}\n`;
}

function defaultCredentialStore() {
  const helperPath = process.env.FISHERAI_PROVIDER_CREDENTIAL_HELPER
    || (fs.existsSync(path.join(RUNTIME_PATHS.APP_DIR, 'tools', 'providerCredentialBridge.ps1'))
      ? path.join(RUNTIME_PATHS.APP_DIR, 'tools', 'providerCredentialBridge.ps1')
      : path.join(RUNTIME_PATHS.APP_DIR, 'scripts', 'release', 'providerCredentialBridge.ps1'));
  return createProviderCredentialStore({
    filePath: process.env.FISHERAI_PROVIDER_CREDENTIAL_PATH
      || path.join(RUNTIME_PATHS.PRIVATE_DIR, PROVIDER_CREDENTIAL_FILE_NAME),
    allowedKeys: USER_PROVIDER_SECRET_KEYS,
    protector: createWindowsDpapiProtector({ helperPath }),
  });
}

export function createConfigRouter({
  envPath = DEFAULT_ENV_PATH,
  modelConfigPath = DEFAULT_MODEL_CONFIG_PATH,
  modelNames = loadModelNames(modelConfigPath),
  credentialStore = defaultCredentialStore(),
  logger = console,
} = {}) {
  const router = express.Router();
  let migrationPromise = null;

  const readConfig = () => parseEnvironment(
    fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '',
  );

  const ensureSecretsMigrated = () => {
    if (!migrationPromise) {
      migrationPromise = (async () => {
        const current = readConfig();
        const secretPatch = Object.fromEntries(
          [...SECRET_KEYS]
            .filter((key) => current[key])
            .map((key) => [key, current[key]]),
        );
        if (Object.keys(secretPatch).length === 0) return;
        await credentialStore.update(secretPatch);
        const nonSecret = Object.fromEntries(
          Object.entries(current).filter(([key]) => !SECRET_KEYS.has(key)),
        );
        writePrivateFile(envPath, serializeEnvironment(nonSecret));
        Object.assign(process.env, secretPatch);
      })().catch((error) => {
        migrationPromise = null;
        throw error;
      });
    }
    return migrationPromise;
  };

  router.get('/keys', async (_request, response) => {
    try {
      await ensureSecretsMigrated();
      const config = readConfig();
      const credentials = await credentialStore.read();
      for (const name of modelNames) {
        const proxyKey = `MODEL_PROXY_${name.replace(/[\s.-]/g, '_').toUpperCase()}`;
        if (config[proxyKey] === undefined) config[proxyKey] = 'false';
      }
      for (const key of SECRET_KEYS) {
        if (credentials[key] || process.env[key]) config[key] = SECRET_MASK;
      }
      response.json(config);
    } catch {
      response.status(500).json({ error: 'Failed to read config' });
    }
  });

  router.post('/keys', async (request, response) => {
    try {
      await ensureSecretsMigrated();
      const current = readConfig();
      const submitted = request.body && typeof request.body === 'object' ? request.body : {};
      const next = { ...current };
      const secretPatch = {};
      for (const [key, rawValue] of Object.entries(submitted)) {
        if (!isAllowedKey(key) || LOCAL_ONLY_DISABLED_KEYS.has(key)) continue;
        if (SECRET_KEYS.has(key) && rawValue === SECRET_MASK) continue;
        const value = safeValue(rawValue);
        if (key.startsWith('MODEL_ID_') && value && !/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]{0,199}$/.test(value)) {
          return response.status(400).json({ error: '模型 ID 无效，不能包含空格或换行，最多 200 个字符。' });
        }
        if (SECRET_KEYS.has(key)) {
          secretPatch[key] = value;
          continue;
        }
        next[key] = NETWORK_KEYS.has(key) ? normalizeNetworkConfigValue(key, value) : value;
      }
      if (Object.keys(secretPatch).length > 0) await credentialStore.update(secretPatch);
      const nextContent = serializeEnvironment(next);
      const currentContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (currentContent !== nextContent) writePrivateFile(envPath, nextContent);
      for (const [key, value] of Object.entries(next)) process.env[key] = value;
      for (const [key, value] of Object.entries(secretPatch)) {
        if (value) process.env[key] = value;
        else delete process.env[key];
      }
      logger.log(`[Config] Updated keys: ${Object.keys(submitted).filter(isAllowedKey).join(', ')}`);
      response.json({ success: true });
    } catch (error) {
      logger.error('[Config] Update failed:', error?.name || 'Error');
      response.status(500).json({ error: 'Failed to update config' });
    }
  });

  return router;
}

export default createConfigRouter();
