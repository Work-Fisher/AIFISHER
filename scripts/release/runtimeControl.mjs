import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_CONTRACT } from './releaseNaming.mjs';
import {
  createProviderCredentialStore,
  createWindowsDpapiProtector,
  PROVIDER_CREDENTIAL_FILE_NAME,
} from './providerCredentialStore.mjs';

const execFileAsync = promisify(execFile);
export const RUNTIME_CONTROL_PROTOCOL = 'aifisher-runtime-control';
export const RUNTIME_CONTROL_VERSION = 1;
const PROCESS_RECORD_VERSION = 3;
const RUNTIME_COMMANDS = new Set(['start', 'status', 'stop']);
const READY_STATUSES = new Set(['started', 'already-running', 'ready']);
const GRACEFUL_SHUTDOWN_PATH = '/internal/runtime/shutdown';
const GRACEFUL_SHUTDOWN_REQUEST_TIMEOUT_MS = 1_500;
const GRACEFUL_SHUTDOWN_EXIT_TIMEOUT_MS = 6_000;
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

class RuntimeControlError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'RuntimeControlError';
    this.code = code;
  }
}

function assertCanonicalOpaqueUserId(value) {
  if (
    typeof value !== 'string' ||
    value === '00000000-0000-0000-0000-000000000000' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
  ) {
    throw new RuntimeControlError('INVALID_USER_SCOPE', '当前用户标识不是规范 opaque UUID');
  }
  return value;
}

function assertControllerProcessId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RuntimeControlError('INVALID_CONTROLLER_PROCESS', '控制中心进程标识无效');
  }
  return value;
}

function assertExpectedProductVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new RuntimeControlError(
      'LOCAL_PRODUCT_VERSION_INVALID',
      '控制中心提供的 AIFISHER 产品版本无效',
    );
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function parseEnvironment(text) {
  const result = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function portablePaths(installRoot, overrides = {}) {
  const root = path.resolve(installRoot);
  const app = path.join(root, 'app');
  const data = overrides.dataRoot ? path.resolve(overrides.dataRoot) : path.join(root, 'data');
  return {
    root,
    app,
    data,
    library: path.join(data, 'library'),
    logs: path.join(data, 'logs'),
    config: path.join(data, 'config'),
    run: path.join(data, 'run'),
    env: path.join(data, 'config', '.env'),
    record: path.join(data, 'run', 'processes.json'),
    lifecycleLog: path.join(data, 'logs', 'runtime-lifecycle.jsonl'),
    packageManifest: path.join(app, 'package.json'),
    identityRuntimeConfig: path.join(app, 'config', 'identity-runtime.json'),
    providerCredentialHelper: path.join(app, 'tools', 'providerCredentialBridge.ps1'),
    node: overrides.nodeExecutable || path.join(app, 'runtime', 'node', 'node.exe'),
    ffmpeg: overrides.ffmpegExecutable || path.join(app, 'bin', 'ffmpeg.exe'),
    ffprobe: overrides.ffprobeExecutable || path.join(app, 'bin', 'ffprobe.exe'),
    backendEntry: path.join(app, 'server', 'index.js'),
  };
}

function removeProviderSecretsFromEnvironment(text) {
  const secretKeys = new Set(USER_PROVIDER_SECRET_KEYS);
  const lines = String(text || '').split(/\r?\n/u);
  const kept = lines.filter((line) => {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/u.exec(line);
    return !match || !secretKeys.has(match[1]);
  });
  while (kept.length > 0 && kept.at(-1) === '') kept.pop();
  return `${kept.join('\n')}\n`;
}

async function writeTextAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function defaultProviderCredentialStoreFactory({ filePath, helperPath }) {
  return createProviderCredentialStore({
    filePath,
    allowedKeys: USER_PROVIDER_SECRET_KEYS,
    protector: createWindowsDpapiProtector({ helperPath }),
  });
}

function exactObjectKeys(value, expected) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function invalidIdentityRuntimeConfiguration(cause) {
  return new RuntimeControlError(
    'LOCAL_AUTHENTICATION_CONFIG_INVALID',
    '候选包缺少可验证的 AIFISHER Identity 公开配置',
    cause ? { cause } : undefined,
  );
}

export async function loadPackagedIdentityRuntimeConfiguration(paths, { required = false } = {}) {
  let text;
  try {
    text = await readFile(paths.identityRuntimeConfig, 'utf8');
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return {};
    throw invalidIdentityRuntimeConfiguration(error);
  }
  try {
    if (Buffer.byteLength(text, 'utf8') > 8_192) throw new Error('configuration is oversized');
    const document = JSON.parse(text);
    if (
      !exactObjectKeys(document, [
        'schemaVersion',
        'issuer',
        'audience',
        'sessionStatusUrl',
        'publicKey',
      ]) ||
      document.schemaVersion !== 3 ||
      !exactObjectKeys(document.publicKey, ['path', 'spkiSha256']) ||
      typeof document.audience !== 'string' ||
      !/^[A-Za-z0-9._-]{1,64}$/u.test(document.audience) ||
      typeof document.publicKey.path !== 'string' ||
      !/^security\/[A-Za-z0-9][A-Za-z0-9._-]*\.pem$/u.test(document.publicKey.path) ||
      typeof document.publicKey.spkiSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(document.publicKey.spkiSha256)
    ) {
      throw new Error('configuration shape is invalid');
    }

    const issuer = new URL(document.issuer);
    if (
      issuer.protocol !== 'https:' ||
      issuer.username ||
      issuer.password ||
      issuer.pathname !== '/' ||
      issuer.search ||
      issuer.hash ||
      document.issuer !== issuer.origin
    ) {
      throw new Error('issuer is invalid');
    }
    const sessionStatus = new URL(document.sessionStatusUrl);
    if (
      sessionStatus.origin !== issuer.origin ||
      sessionStatus.pathname !== '/v1/session-validations' ||
      sessionStatus.username ||
      sessionStatus.password ||
      sessionStatus.search ||
      sessionStatus.hash ||
      document.sessionStatusUrl !== sessionStatus.href
    ) {
      throw new Error('session-status endpoint is invalid');
    }
    const publicKeyPath = path.resolve(paths.app, ...document.publicKey.path.split('/'));
    const relativePublicKeyPath = path.relative(paths.app, publicKeyPath);
    if (
      !relativePublicKeyPath ||
      relativePublicKeyPath.startsWith('..') ||
      path.isAbsolute(relativePublicKeyPath)
    ) {
      throw new Error('public-key path escapes the application directory');
    }
    const publicKeyText = await readFile(publicKeyPath, 'utf8');
    if (Buffer.byteLength(publicKeyText, 'utf8') > 8_192 || /PRIVATE KEY/u.test(publicKeyText)) {
      throw new Error('public-key file is invalid');
    }
    const publicKey = crypto.createPublicKey(publicKeyText);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('public-key type is invalid');
    }
    const fingerprint = crypto
      .createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    if (fingerprint !== document.publicKey.spkiSha256) {
      throw new Error('public-key fingerprint does not match');
    }

    return {
      AIFISHER_ACCESS_TOKEN_PUBLIC_KEY_PATH: publicKeyPath,
      AIFISHER_ACCESS_TOKEN_ISSUER: document.issuer,
      AIFISHER_ACCESS_TOKEN_AUDIENCE: document.audience,
      AIFISHER_SESSION_STATUS_URL: document.sessionStatusUrl,
    };
  } catch (error) {
    if (error instanceof RuntimeControlError) throw error;
    throw invalidIdentityRuntimeConfiguration(error);
  }
}

export async function loadPackagedProductVersion(paths) {
  try {
    const text = await readFile(paths.packageManifest, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024)
      throw new Error('package metadata is oversized');
    const version = String(JSON.parse(text)?.version || '').trim();
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
      throw new Error('package version is invalid');
    }
    return version;
  } catch (error) {
    throw new RuntimeControlError(
      'LOCAL_PRODUCT_VERSION_INVALID',
      '候选包缺少可验证的 AIFISHER 产品版本',
      { cause: error },
    );
  }
}

async function appendLifecycleEvent(paths, event, details = {}) {
  await mkdir(paths.logs, { recursive: true });
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value),
    ),
  );
  await appendFile(
    paths.lifecycleLog,
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...safeDetails })}\n`,
    'utf8',
  );
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

async function ensureWritable(directory) {
  await mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.write-test-${process.pid}-${crypto.randomUUID()}`);
  await writeFile(probe, 'ok', { flag: 'wx' });
  await rm(probe, { force: true });
}

async function defaultNativeVerifier(paths) {
  await execFileAsync(paths.node, ['--version'], { cwd: paths.app, windowsHide: true });
  await execFileAsync(paths.ffmpeg, ['-version'], { cwd: paths.app, windowsHide: true });
  await execFileAsync(paths.ffprobe, ['-version'], { cwd: paths.app, windowsHide: true });
  const probe =
    "Promise.all([import('sharp'),import('sqlite3')]).then(()=>process.exit(0)).catch(()=>process.exit(1))";
  await execFileAsync(paths.node, ['-e', probe], { cwd: paths.app, windowsHide: true });
  return { node: 'ready', ffmpeg: 'ready', ffprobe: 'ready', sqlite: 'ready', sharp: 'ready' };
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function allocateLoopbackPort(excluded = new Set()) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        const address = server.address();
        const selected = typeof address === 'object' && address ? address.port : 0;
        server.close((error) => (error ? reject(error) : resolve(selected)));
      });
    });
    if (port > 0 && !excluded.has(port) && (await isPortAvailable(port))) return port;
  }
  throw new RuntimeControlError('PORT_UNAVAILABLE', '没有可用的本机回环端口');
}

async function selectRuntimePort(preferredPort, excluded = new Set()) {
  if (!excluded.has(preferredPort) && (await isPortAvailable(preferredPort))) {
    return { port: preferredPort, reassigned: false };
  }
  return { port: await allocateLoopbackPort(excluded), reassigned: true };
}

async function fetchJson(fetchImpl, url, timeoutMs = 1_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitUntilHealthy(fetchImpl, backendPort, expectedProductVersion, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const [backend, collaboration] = await Promise.all([
      fetchJson(fetchImpl, `http://127.0.0.1:${backendPort}/healthz`),
      fetchJson(fetchImpl, `http://127.0.0.1:${backendPort}/readyz`),
    ]);
    if (
      backend?.ok === true &&
      backend.service === 'aifisher-canvas' &&
      backend.version === expectedProductVersion &&
      collaboration?.ok === true &&
      collaboration.ready === true &&
      collaboration.service === 'aifisher-collab' &&
      collaboration.version === expectedProductVersion
    )
      return true;
    await delay(150);
  } while (Date.now() < deadline);
  return false;
}

async function inspectProcessDefault(pid) {
  if (process.platform === 'win32') {
    try {
      const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}';if($p){$p|Select-Object ProcessId,ExecutablePath,CommandLine|ConvertTo-Json -Compress}`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true },
      );
      return stdout.trim() ? JSON.parse(stdout) : null;
    } catch (error) {
      throw new Error(`无法检查 Windows 进程 ${pid}`, { cause: error });
    }
  }
  try {
    const commandLine = (await readFile(`/proc/${Number(pid)}/cmdline`, 'utf8')).replaceAll(
      '\0',
      ' ',
    );
    const executablePath = await fs.promises.readlink(`/proc/${Number(pid)}/exe`);
    return { ProcessId: Number(pid), ExecutablePath: executablePath, CommandLine: commandLine };
  } catch {
    return null;
  }
}

function samePath(left, right) {
  const a = path.resolve(String(left || ''));
  const b = path.resolve(String(right || ''));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isOwnedProcess(details, record, item) {
  const commandLine = String(details?.CommandLine || '');
  return (
    Number(details?.ProcessId) === Number(item.pid) &&
    samePath(details?.ExecutablePath, record.nodeExecutable) &&
    commandLine.includes(record.instanceToken) &&
    commandLine.includes(item.entry)
  );
}

async function waitForProcessExit(pid, inspectProcess, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await inspectProcess(pid))) return true;
    await delay(50);
  }
  return false;
}

async function terminatePid(pid, inspectProcess) {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {
      /* Fall back to the direct Windows process handle below. */
    }
    if (await waitForProcessExit(pid, inspectProcess)) return;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* The process may already have exited. */
    }
    if (await waitForProcessExit(pid, inspectProcess)) return;
    throw new Error(`无法停止 ${RELEASE_CONTRACT.product}进程 ${pid}`);
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  if (await waitForProcessExit(pid, inspectProcess, 20)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* The process may already have exited. */
  }
  if (!(await waitForProcessExit(pid, inspectProcess))) {
    throw new Error(`无法停止 ${RELEASE_CONTRACT.product}进程 ${pid}`);
  }
}

async function waitForProcessExitUntil(pid, inspectProcess, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!(await inspectProcess(pid))) return true;
    await delay(100);
  } while (Date.now() < deadline);
  return false;
}

async function requestGracefulShutdown(fetchImpl, record, item) {
  const backendPort = normalizePort(record?.backendPort, 0);
  const instanceToken = String(record?.instanceToken || '');
  if (
    item?.role !== 'backend' ||
    !backendPort ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(instanceToken)
  )
    return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRACEFUL_SHUTDOWN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${backendPort}${GRACEFUL_SHUTDOWN_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-AIFISHER-Runtime-Instance': instanceToken,
      },
      redirect: 'error',
      signal: controller.signal,
    });
    return response.status === 202;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultOpenBrowser(url) {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
}

export function createRuntimeController({
  installRoot,
  dataRoot,
  nodeExecutable,
  ffmpegExecutable,
  ffprobeExecutable,
  nativeVerifier = defaultNativeVerifier,
  inspectProcess = inspectProcessDefault,
  openBrowser = defaultOpenBrowser,
  fetchImpl = globalThis.fetch,
  providerCredentialStoreFactory = defaultProviderCredentialStoreFactory,
  backendPort: configuredBackendPort,
  healthTimeoutMs = 30_000,
} = {}) {
  if (!installRoot) throw new Error('installRoot is required');
  const paths = portablePaths(installRoot, {
    dataRoot,
    nodeExecutable,
    ffmpegExecutable,
    ffprobeExecutable,
  });

  async function preflight(requestedOpaqueUserId) {
    for (const requiredPath of [
      paths.app,
      paths.node,
      paths.ffmpeg,
      paths.ffprobe,
      paths.backendEntry,
      path.join(paths.app, 'dist', 'index.html'),
      paths.packageManifest,
      ...(requestedOpaqueUserId ? [paths.providerCredentialHelper] : []),
    ])
      await access(requiredPath, fs.constants.R_OK);
    for (const directory of [paths.logs, paths.config, paths.run]) {
      await ensureWritable(directory);
    }
    try {
      await access(paths.env, fs.constants.F_OK);
    } catch {
      await copyFile(
        path.join(paths.app, 'defaults', '.env.example'),
        paths.env,
        fs.constants.COPYFILE_EXCL,
      );
    }
    const userValues = parseEnvironment(await readFile(paths.env, 'utf8'));
    const identityValues = await loadPackagedIdentityRuntimeConfiguration(paths, {
      required: Boolean(requestedOpaqueUserId || userValues.AIFISHER_ACTIVE_USER_ID),
    });
    const productVersion = await loadPackagedProductVersion(paths);
    const values = {
      ...userValues,
      ...identityValues,
      AIFISHER_PRODUCT_VERSION: productVersion,
    };
    const backendPort = normalizePort(configuredBackendPort ?? values.SERVER_PORT, 3001);
    const native = await nativeVerifier(paths);
    return { paths, values, backendPort, collaborationPort: backendPort, native };
  }

  async function readRecord() {
    try {
      return JSON.parse(await readFile(paths.record, 'utf8'));
    } catch {
      return null;
    }
  }

  async function stopRecord(record) {
    let stopped = 0;
    if (!record || !samePath(record.installRoot, paths.root)) return stopped;
    for (const item of [...(record.processes || [])].reverse()) {
      const details = await inspectProcess(item.pid);
      if (!isOwnedProcess(details, record, item)) continue;
      if (
        (await requestGracefulShutdown(fetchImpl, record, item)) &&
        (await waitForProcessExitUntil(item.pid, inspectProcess, GRACEFUL_SHUTDOWN_EXIT_TIMEOUT_MS))
      ) {
        stopped += 1;
        continue;
      }
      const refreshedDetails = await inspectProcess(item.pid);
      if (!isOwnedProcess(refreshedDetails, record, item)) {
        stopped += 1;
        continue;
      }
      await terminatePid(item.pid, inspectProcess);
      stopped += 1;
    }
    return stopped;
  }

  async function inspectRecord(record, expectedProductVersion) {
    const processes = Array.isArray(record?.processes) ? record.processes : [];
    const roles = new Set(processes.map((item) => item?.role));
    let owned =
      record?.format === 'fisherai-process-record' &&
      record?.version === PROCESS_RECORD_VERSION &&
      samePath(record?.installRoot, paths.root) &&
      record?.productVersion === expectedProductVersion &&
      processes.length === 1 &&
      roles.has('backend');
    if (owned) {
      for (const item of processes) {
        const details = await inspectProcess(item.pid);
        if (!isOwnedProcess(details, record, item)) {
          owned = false;
          break;
        }
      }
    }

    const backendPort = normalizePort(record?.backendPort, 0) || null;
    const collaborationPort = backendPort;
    const healthy =
      owned &&
      backendPort !== null &&
      (await waitUntilHealthy(fetchImpl, backendPort, expectedProductVersion, 1_500));
    return { owned, healthy, backendPort, collaborationPort };
  }

  async function start({
    openBrowser: shouldOpenBrowser = true,
    activeOpaqueUserId,
    controllerProcessId,
    expectedProductVersion,
    requiredBackendPort,
  } = {}) {
    const requestedOpaqueUserId = activeOpaqueUserId
      ? assertCanonicalOpaqueUserId(activeOpaqueUserId)
      : null;
    const requestedControllerProcessId =
      controllerProcessId === undefined || controllerProcessId === null
        ? null
        : assertControllerProcessId(controllerProcessId);
    const requestedProductVersion = expectedProductVersion
      ? assertExpectedProductVersion(expectedProductVersion)
      : null;
    const packagedProductVersion = await loadPackagedProductVersion(paths);
    const recoveryPort =
      requiredBackendPort === undefined ? null : normalizePort(requiredBackendPort, 0);
    if (
      requiredBackendPort !== undefined &&
      (!recoveryPort ||
        !requestedOpaqueUserId ||
        !requestedControllerProcessId ||
        !requestedProductVersion)
    ) {
      throw new RuntimeControlError(
        'INVALID_RECOVERY_OWNER',
        '原位恢复缺少有效的账号、端口或控制中心归属',
      );
    }
    if (requestedProductVersion && requestedProductVersion !== packagedProductVersion) {
      throw new RuntimeControlError(
        'LOCAL_PRODUCT_VERSION_MISMATCH',
        '控制中心与画布运行时版本不一致',
      );
    }
    const existing = await readRecord();
    if (
      recoveryPort &&
      existing &&
      (existing.format !== 'fisherai-process-record' ||
        !samePath(existing.installRoot, paths.root) ||
        existing.productVersion !== requestedProductVersion ||
        existing.activeOpaqueUserId !== requestedOpaqueUserId ||
        existing.controllerProcessId !== requestedControllerProcessId ||
        existing.backendPort !== recoveryPort)
    ) {
      throw new RuntimeControlError(
        'RECOVERY_OWNER_MISMATCH',
        '本机服务归属已变化，无法在当前画布恢复',
      );
    }
    if (existing) {
      const inspected = await inspectRecord(existing, packagedProductVersion);
      if (
        inspected.healthy &&
        (!requestedOpaqueUserId || existing.activeOpaqueUserId === requestedOpaqueUserId) &&
        (!requestedControllerProcessId ||
          existing.controllerProcessId === requestedControllerProcessId)
      ) {
        if (shouldOpenBrowser) await openBrowser(`http://127.0.0.1:${existing.backendPort}/`);
        return { status: 'already-running', ...existing };
      }
      await appendLifecycleEvent(paths, 'stale-runtime-recovery', {
        previousStartedAt: String(existing.startedAt || ''),
        processCount: Array.isArray(existing.processes) ? existing.processes.length : 0,
        ownedProcessPresent: inspected.owned,
        healthy: inspected.healthy,
        inPlace: Boolean(recoveryPort),
      });
      await stopRecord(existing);
      await rm(paths.record, { force: true });
    }

    let ready;
    try {
      const preflightResult = await preflight(requestedOpaqueUserId);
      if (recoveryPort && !(await isPortAvailable(recoveryPort))) {
        throw new RuntimeControlError(
          'RECOVERY_PORT_UNAVAILABLE',
          '画布原端口被占用，请释放端口后重试',
        );
      }
      const backend = recoveryPort
        ? { port: recoveryPort, reassigned: false }
        : await selectRuntimePort(preflightResult.backendPort);
      ready = {
        ...preflightResult,
        backendPort: backend.port,
        collaborationPort: backend.port,
      };
      if (backend.reassigned) {
        await appendLifecycleEvent(paths, 'runtime-port-reassigned', {
          backendReassigned: backend.reassigned,
        });
      }
    } catch (error) {
      try {
        await appendLifecycleEvent(paths, 'runtime-start-failed', {
          errorName: String(error?.name || 'Error'),
          errorCode: String(error?.code || ''),
        });
      } catch {
        /* A non-writable diagnostics directory must not replace the original failure. */
      }
      throw error;
    }

    const instanceToken = crypto.randomUUID();
    const selectedOpaqueUserId =
      requestedOpaqueUserId ||
      (ready.values.AIFISHER_ACTIVE_USER_ID
        ? assertCanonicalOpaqueUserId(ready.values.AIFISHER_ACTIVE_USER_ID)
        : null);
    const userRoot = selectedOpaqueUserId
      ? path.join(paths.data, 'users', selectedOpaqueUserId)
      : null;
    const runtimeLibrary = userRoot ? path.join(userRoot, 'library') : paths.library;
    const runtimeEnvironmentPath = userRoot
      ? path.join(userRoot, 'config', 'providers.env')
      : paths.env;
    const environment = {
      ...process.env,
      ...ready.values,
    };
    delete environment.COLLAB_PORT;
    delete environment.VITE_COLLAB_PORT;
    delete environment.AIFISHER_COLLAB_INTERNAL_SECRET;
    delete environment.AIFISHER_CONTROLLER_PID;
    if (requestedControllerProcessId) {
      environment.AIFISHER_CONTROLLER_PID = String(requestedControllerProcessId);
    }
    if (selectedOpaqueUserId) {
      for (const key of USER_PROVIDER_SECRET_KEYS) delete environment[key];
      await mkdir(path.dirname(runtimeEnvironmentPath), { recursive: true });
      const credentialPath = path.join(userRoot, 'private', PROVIDER_CREDENTIAL_FILE_NAME);
      await mkdir(path.dirname(credentialPath), { recursive: true });
      const credentialStore = providerCredentialStoreFactory({
        filePath: credentialPath,
        helperPath: paths.providerCredentialHelper,
      });
      let activeProviderText = '';
      try {
        activeProviderText = await readFile(runtimeEnvironmentPath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const activeProviderValues = parseEnvironment(activeProviderText);
      const legacySecrets = Object.fromEntries(
        USER_PROVIDER_SECRET_KEYS.filter((key) => activeProviderValues[key]).map((key) => [
          key,
          activeProviderValues[key],
        ]),
      );
      if (Object.keys(legacySecrets).length > 0) {
        await credentialStore.update(legacySecrets);
        await writeTextAtomic(
          runtimeEnvironmentPath,
          removeProviderSecretsFromEnvironment(activeProviderText),
        );
      }
      for (const key of USER_PROVIDER_SECRET_KEYS) delete activeProviderValues[key];
      Object.assign(environment, activeProviderValues, await credentialStore.read());
      environment.FISHERAI_PROVIDER_CREDENTIAL_PATH = credentialPath;
      environment.FISHERAI_PROVIDER_CREDENTIAL_HELPER = paths.providerCredentialHelper;
    }
    Object.assign(environment, {
      NODE_ENV: 'production',
      SERVER_PORT: String(ready.backendPort),
      FISHERAI_APP_DIR: paths.app,
      FISHERAI_DATA_DIR: paths.data,
      FISHERAI_LIBRARY_DIR: runtimeLibrary,
      FISHERAI_LOGS_DIR: paths.logs,
      FISHERAI_ENV_PATH: runtimeEnvironmentPath,
    });
    if (selectedOpaqueUserId) {
      environment.AIFISHER_ACTIVE_USER_ID = selectedOpaqueUserId;
    }
    const processes = [];
    const entries = [['backend', paths.backendEntry, 'backend.stdout.log', 'backend.stderr.log']];
    try {
      for (const [role, entry, stdoutName, stderrName] of entries) {
        const stdout = fs.openSync(path.join(paths.logs, stdoutName), 'a');
        const stderr = fs.openSync(path.join(paths.logs, stderrName), 'a');
        let child;
        try {
          child = spawn(paths.node, [entry, `--fisherai-instance=${instanceToken}`], {
            cwd: paths.app,
            env: environment,
            detached: true,
            windowsHide: true,
            stdio: ['ignore', stdout, stderr],
          });
        } finally {
          fs.closeSync(stdout);
          fs.closeSync(stderr);
        }
        child.unref();
        processes.push({ role, pid: child.pid, entry });
      }
      const record = {
        format: 'fisherai-process-record',
        version: PROCESS_RECORD_VERSION,
        installRoot: paths.root,
        nodeExecutable: paths.node,
        instanceToken,
        controllerProcessId: requestedControllerProcessId,
        activeOpaqueUserId: selectedOpaqueUserId,
        productVersion: ready.values.AIFISHER_PRODUCT_VERSION,
        backendPort: ready.backendPort,
        collaborationPort: ready.collaborationPort,
        startedAt: new Date().toISOString(),
        processes,
      };
      await writeJsonAtomic(paths.record, record);
      if (
        !(await waitUntilHealthy(
          fetchImpl,
          ready.backendPort,
          ready.values.AIFISHER_PRODUCT_VERSION,
          healthTimeoutMs,
        ))
      )
        throw new Error(`${RELEASE_CONTRACT.product}未能在规定时间内通过健康检查`);
      if (shouldOpenBrowser) await openBrowser(`http://127.0.0.1:${ready.backendPort}/`);
      await appendLifecycleEvent(paths, 'runtime-started', { processCount: processes.length });
      return { status: 'started', ...record };
    } catch (error) {
      const rollback = {
        installRoot: paths.root,
        nodeExecutable: paths.node,
        instanceToken,
        backendPort: ready.backendPort,
        processes,
      };
      await stopRecord(rollback);
      await rm(paths.record, { force: true });
      try {
        await appendLifecycleEvent(paths, 'runtime-start-failed', {
          errorName: String(error?.name || 'Error'),
          errorCode: String(error?.code || ''),
        });
      } catch {
        /* Preserve the startup failure if diagnostics cannot be written. */
      }
      throw error;
    }
  }

  async function stop() {
    const record = await readRecord();
    if (!record) return { status: 'not-running', stopped: 0 };
    const stopped = await stopRecord(record);
    await rm(paths.record, { force: true });
    await appendLifecycleEvent(paths, 'runtime-stopped', { stopped });
    return { status: 'stopped', stopped };
  }

  async function status({ expectedProductVersion } = {}) {
    const requestedProductVersion = expectedProductVersion
      ? assertExpectedProductVersion(expectedProductVersion)
      : null;
    const packagedProductVersion = await loadPackagedProductVersion(paths);
    if (requestedProductVersion && requestedProductVersion !== packagedProductVersion) {
      throw new RuntimeControlError(
        'LOCAL_PRODUCT_VERSION_MISMATCH',
        '控制中心与画布运行时版本不一致',
      );
    }
    const record = await readRecord();
    if (!record) {
      return { status: 'not-running', backendPort: null, collaborationPort: null };
    }
    const { healthy, backendPort, collaborationPort } = await inspectRecord(
      record,
      packagedProductVersion,
    );
    return {
      status: healthy ? 'ready' : 'unhealthy',
      backendPort,
      collaborationPort,
    };
  }

  return { preflight, start, status, stop, paths };
}

function publicRuntimeResult(result) {
  return {
    status: String(result?.status || ''),
    backendPort: normalizePort(result?.backendPort, 0) || null,
    collaborationPort: normalizePort(result?.collaborationPort, 0) || null,
    stopped: Number.isInteger(result?.stopped) && result.stopped >= 0 ? result.stopped : 0,
  };
}

export async function executeRuntimeCommand(
  controller,
  command,
  {
    openBrowser = false,
    activeOpaqueUserId,
    controllerProcessId,
    expectedProductVersion,
    requiredBackendPort,
  } = {},
) {
  if (!RUNTIME_COMMANDS.has(command)) {
    throw new RuntimeControlError('INVALID_COMMAND', '不支持的本机运行时命令');
  }
  const result =
    command === 'start'
      ? await controller.start({
          openBrowser,
          ...(activeOpaqueUserId ? { activeOpaqueUserId } : {}),
          ...(controllerProcessId === undefined || controllerProcessId === null
            ? {}
            : { controllerProcessId }),
          ...(expectedProductVersion ? { expectedProductVersion } : {}),
          ...(requiredBackendPort === undefined ? {} : { requiredBackendPort }),
        })
      : command === 'status'
        ? await controller.status(expectedProductVersion ? { expectedProductVersion } : undefined)
        : await controller.stop();
  return publicRuntimeResult(result);
}

export function createRuntimeControlEnvelope(command, result) {
  const normalized = publicRuntimeResult(result);
  const ready = READY_STATUSES.has(normalized.status);
  return {
    protocol: RUNTIME_CONTROL_PROTOCOL,
    version: RUNTIME_CONTROL_VERSION,
    ok: true,
    command,
    status: normalized.status,
    backend: { ready },
    collaboration: { ready },
    canvasUrl:
      ready && normalized.backendPort ? `http://127.0.0.1:${normalized.backendPort}/` : null,
    stopped: normalized.stopped,
  };
}

export function createRuntimeControlErrorEnvelope(command, error) {
  const knownCode =
    typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
      ? error.code
      : 'RUNTIME_CONTROL_FAILED';
  return {
    protocol: RUNTIME_CONTROL_PROTOCOL,
    version: RUNTIME_CONTROL_VERSION,
    ok: false,
    command: RUNTIME_COMMANDS.has(command) ? command : 'invalid',
    code: knownCode,
    message:
      knownCode === 'INVALID_COMMAND'
        ? '不支持的本机运行时命令。'
        : `${RELEASE_CONTRACT.product}本机服务操作失败，请查看 data/logs。`,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';
  const rootArgument = args.find((argument) => argument.startsWith('--root='));
  const dataRootArgument = args.find((argument) => argument.startsWith('--data-root='));
  const activeUserArgument = args.find((argument) => argument.startsWith('--active-user-id='));
  const controllerPidArgument = args.find((argument) => argument.startsWith('--controller-pid='));
  const requiredPortArgument = args.find((argument) =>
    argument.startsWith('--required-backend-port='),
  );
  const expectedVersionArgument = args.find((argument) =>
    argument.startsWith('--expected-version='),
  );
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const installRoot = rootArgument
    ? rootArgument.slice('--root='.length)
    : path.resolve(scriptDirectory, '..', '..');
  try {
    const controller = createRuntimeController({
      installRoot,
      dataRoot: dataRootArgument?.slice('--data-root='.length),
    });
    const result = await executeRuntimeCommand(controller, command, {
      requiredBackendPort: requiredPortArgument
        ? Number(requiredPortArgument.slice('--required-backend-port='.length))
        : undefined,
      openBrowser: command === 'start' && !args.includes('--no-browser'),
      activeOpaqueUserId: activeUserArgument
        ? activeUserArgument.slice('--active-user-id='.length)
        : undefined,
      controllerProcessId: controllerPidArgument
        ? Number(controllerPidArgument.slice('--controller-pid='.length))
        : undefined,
      expectedProductVersion: expectedVersionArgument
        ? expectedVersionArgument.slice('--expected-version='.length)
        : undefined,
    });
    process.stdout.write(`${JSON.stringify(createRuntimeControlEnvelope(command, result))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(createRuntimeControlErrorEnvelope(command, error))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch(() => {
    process.stderr.write(`[${RELEASE_CONTRACT.product}] 本机运行时控制器发生未处理错误\n`);
    process.exitCode = 1;
  });
}
