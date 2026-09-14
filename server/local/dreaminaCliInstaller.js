import crypto from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const INSTALLER_URL = 'https://jimeng.jianying.com/cli';
const CDN_HOST = 'lf3-static.bytednsdoc.com';
const CDN_ROOT = '/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/';
const EXPECTED_DOWNLOAD_BASE = `https://${CDN_HOST}${CDN_ROOT}dreamina_cli_beta`;
const WINDOWS_BINARY_NAME = 'dreamina_cli_windows_amd64.exe';
const MAX_INSTALLER_BYTES = 256 * 1024;
const MAX_VERSION_BYTES = 64 * 1024;
const MAX_SKILL_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 200 * 1024 * 1024;
const MIN_BINARY_BYTES = 64 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const LOGIN_CODE_PATTERN = /^[A-Za-z0-9_-]{4,256}$/u;
const LOGIN_OUTPUT_LIMIT = 32 * 1024;
const LOGIN_COMMAND_TIMEOUT_MS = 20_000;
const RUNTIME_OUTPUT_LIMIT = 64 * 1024;
const AUTH_PROBE_CACHE_MS = 30_000;
const RUNTIME_COMMANDS = new Set([
  'user_credit',
  'text2image',
  'image2image',
  'text2video',
  'image2video',
  'frames2video',
  'multimodal2video',
  'query_result',
]);
const DREAMINA_LOGIN_URL = 'https://jimeng.jianying.com/ai-tool/cli-auth';
const DREAMINA_DEVICE_CONFIRM_PATH = '/passport/open/scan_user_code/';

export class DreaminaCliInstallError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'DreaminaCliInstallError';
    this.code = code;
    this.status = status;
  }
}

function contained(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DreaminaCliInstallError(
      'DREAMINA_INSTALL_PATH_UNSAFE',
      '即梦 CLI 安装目录无效，请重启 AIFISHER 后重试。',
      500,
    );
  }
  return resolvedCandidate;
}

function assignment(script, name) {
  const match = script.match(new RegExp(`^${name}="([^"]+)"\\r?$`, 'm'));
  return match?.[1] || null;
}

function assertOfficialUrl(value, { exactPath = null, pathPrefix = CDN_ROOT } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new DreaminaCliInstallError(
      'DREAMINA_INSTALLER_CONTRACT_CHANGED',
      '即梦官方安装地址已变化，请更新 AIFISHER 后重试。',
      502,
    );
  }
  const expectedHost = exactPath === '/cli' ? 'jimeng.jianying.com' : CDN_HOST;
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== expectedHost
    || (exactPath ? parsed.pathname !== exactPath : !parsed.pathname.startsWith(pathPrefix))
    || parsed.username
    || parsed.password
  ) {
    throw new DreaminaCliInstallError(
      'DREAMINA_INSTALLER_CONTRACT_CHANGED',
      '即梦官方安装地址已变化，请更新 AIFISHER 后重试。',
      502,
    );
  }
  return parsed;
}

async function fetchBuffer(fetcher, url, maximumBytes, urlRules) {
  assertOfficialUrl(url, urlRules);
  let response;
  try {
    response = await fetcher(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DreaminaCliInstallError(
      'DREAMINA_DOWNLOAD_UNAVAILABLE',
      '暂时无法连接即梦官方下载服务，请检查网络后重试。',
      502,
    );
  }
  if (!response?.ok) {
    throw new DreaminaCliInstallError(
      'DREAMINA_DOWNLOAD_UNAVAILABLE',
      `即梦官方下载失败（HTTP ${response?.status || 0}），请稍后重试。`,
      502,
    );
  }
  assertOfficialUrl(response.url || url, urlRules);
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new DreaminaCliInstallError(
      'DREAMINA_DOWNLOAD_TOO_LARGE',
      '即梦官方下载文件大小异常，安装已停止。',
      502,
    );
  }
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new DreaminaCliInstallError(
      'DREAMINA_DOWNLOAD_UNAVAILABLE',
      '即梦官方下载中断，请检查网络后重试。',
      502,
    );
  }
  if (buffer.length > maximumBytes) {
    throw new DreaminaCliInstallError(
      'DREAMINA_DOWNLOAD_TOO_LARGE',
      '即梦官方下载文件大小异常，安装已停止。',
      502,
    );
  }
  return buffer;
}

function parseInstaller(scriptBuffer) {
  const script = scriptBuffer.toString('utf8');
  const downloadBase = assignment(script, 'DOWNLOAD_BASE');
  const versionUrl = assignment(script, 'VERSION_URL');
  const skillMd5 = assignment(script, 'SKILL_MD5')?.toLowerCase();
  if (
    downloadBase !== EXPECTED_DOWNLOAD_BASE
    || !versionUrl
    || !/^[a-f0-9]{32}$/.test(skillMd5 || '')
    || !script.includes(`DOWNLOAD_FILE="${WINDOWS_BINARY_NAME}"`)
  ) {
    throw new DreaminaCliInstallError(
      'DREAMINA_INSTALLER_CONTRACT_CHANGED',
      '即梦官方安装方式已变化，请更新 AIFISHER 后重试。',
      502,
    );
  }
  assertOfficialUrl(downloadBase);
  assertOfficialUrl(versionUrl);
  return {
    binaryUrl: `${downloadBase}/${WINDOWS_BINARY_NAME}`,
    skillUrl: `${downloadBase}/SKILL.md`,
    versionUrl,
    skillMd5,
  };
}

function parseVersion(buffer) {
  let value;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch {
    value = null;
  }
  const version = String(value?.version || '').trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new DreaminaCliInstallError(
      'DREAMINA_VERSION_INVALID',
      '即梦官方版本信息无效，安装已停止。',
      502,
    );
  }
  return version;
}

function validateArtifacts({ binary, skill, expectedSkillMd5 }) {
  if (
    binary.length < MIN_BINARY_BYTES
    || binary[0] !== 0x4d
    || binary[1] !== 0x5a
  ) {
    throw new DreaminaCliInstallError(
      'DREAMINA_BINARY_INVALID',
      '即梦官方下载文件不是有效的 Windows 程序，安装已停止。',
      502,
    );
  }
  const actualSkillMd5 = crypto.createHash('md5').update(skill).digest('hex');
  if (actualSkillMd5 !== expectedSkillMd5) {
    throw new DreaminaCliInstallError(
      'DREAMINA_SKILL_INTEGRITY_FAILED',
      '即梦官方 SKILL 校验失败，安装已停止。',
      502,
    );
  }
  return {
    binarySha256: crypto.createHash('sha256').update(binary).digest('hex'),
    skillMd5: actualSkillMd5,
  };
}

async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function optionalLstat(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function outputField(text, name) {
  const match = String(text || '').match(new RegExp(`^${name}:\\s*(\\S+)\\s*$`, 'imu'));
  return match?.[1] || '';
}

function loginOutputIsAuthenticated(text) {
  return /(?:登录成功|已登录|登录状态有效|已复用当前本地\s+OAuth\s+登录态|login successful|already logged in)/iu.test(String(text || ''));
}

function verifiedLoginUrl(value, userCode) {
  let outer;
  try {
    outer = new URL(value);
  } catch {
    return null;
  }
  if (
    outer.protocol !== 'https:'
    || outer.hostname !== 'jimeng.jianying.com'
    || outer.port
    || `${outer.origin}${outer.pathname}` !== DREAMINA_LOGIN_URL
    || outer.username
    || outer.password
    || outer.hash
  ) return null;
  if (!outer.search) return outer.href;

  const outerKeys = [...outer.searchParams.keys()];
  const nestedValues = outer.searchParams.getAll('verification_uri');
  if (
    outerKeys.length !== 1
    || outerKeys[0] !== 'verification_uri'
    || nestedValues.length !== 1
  ) return null;
  let nested;
  try {
    nested = new URL(nestedValues[0]);
  } catch {
    return null;
  }
  const nestedKeys = [...nested.searchParams.keys()];
  const nestedCodes = nested.searchParams.getAll('user_code');
  if (
    nested.protocol !== 'https:'
    || nested.hostname !== 'jimeng.jianying.com'
    || nested.port
    || nested.pathname !== DREAMINA_DEVICE_CONFIRM_PATH
    || nested.username
    || nested.password
    || nested.hash
    || nestedKeys.length !== 1
    || nestedKeys[0] !== 'user_code'
    || nestedCodes.length !== 1
    || nestedCodes[0] !== userCode
  ) return null;
  return outer.href;
}

function parseDeviceFlow(text, now) {
  const verificationUri = outputField(text, 'verification_uri');
  const userCode = outputField(text, 'user_code');
  const deviceCode = outputField(text, 'device_code');
  const expiresAtText = outputField(text, 'expires_at');
  const pollIntervalText = outputField(text, 'poll_interval');
  const verifiedUri = verifiedLoginUrl(verificationUri, userCode);
  const expiresAt = new Date(expiresAtText);
  const nowMs = now().getTime();
  const pollMatch = pollIntervalText.match(/^(\d{1,2})s$/u);
  const pollSeconds = Number(pollMatch?.[1]);
  if (
    !verifiedUri
    || !LOGIN_CODE_PATTERN.test(userCode)
    || !LOGIN_CODE_PATTERN.test(deviceCode)
    || !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() <= nowMs
    || expiresAt.getTime() > nowMs + 60 * 60 * 1_000
    || !Number.isInteger(pollSeconds)
    || pollSeconds < 1
    || pollSeconds > 30
  ) {
    throw new DreaminaCliInstallError(
      'DREAMINA_LOGIN_CONTRACT_CHANGED',
      '即梦登录流程已变化，请更新 AIFISHER 后重试。',
      502,
    );
  }
  return {
    verificationUri: verifiedUri,
    userCode,
    deviceCode,
    expiresAt: expiresAt.toISOString(),
    pollAfterMs: pollSeconds * 1_000,
  };
}

function defaultOpenBrowser(url, browser = 'default') {
  if (browser !== 'default') {
    const suffix = browser === 'edge' ? 'Microsoft/Edge/Application/msedge.exe' : 'Google/Chrome/Application/chrome.exe';
    const executable = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map((root) => path.join(root, suffix)).find(existsSync);
    if (!executable) throw new DreaminaCliInstallError('DREAMINA_BROWSER_MISSING', '未找到所选浏览器，请复制授权链接到该浏览器打开。', 400);
    return new Promise((resolve, reject) => {
      const child = nodeSpawn(executable, [url], { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('spawn', () => { child.unref(); resolve(); });
      child.once('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    const child = nodeSpawn('explorer.exe', [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

export function createDreaminaCliInstaller({
  installRoot,
  fetcher = globalThis.fetch,
  spawnChild = nodeSpawn,
  openBrowser = defaultOpenBrowser,
  platform = process.platform,
  architecture = process.arch,
  now = () => new Date(),
  loginCommandTimeoutMs = LOGIN_COMMAND_TIMEOUT_MS,
} = {}) {
  if (
    !installRoot
    || typeof fetcher !== 'function'
    || typeof spawnChild !== 'function'
    || typeof openBrowser !== 'function'
  ) {
    throw new Error('installRoot, fetcher, spawnChild, and openBrowser are required');
  }
  const root = path.resolve(installRoot);
  if (
    !Number.isInteger(loginCommandTimeoutMs)
    || loginCommandTimeoutMs < 100
    || loginCommandTimeoutMs > 60_000
  ) throw new Error('Dreamina login command timeout is invalid');
  const activeManifestPath = path.join(root, 'active.json');
  let pendingInstall = null;
  let loginAttempt = null;
  let pendingLoginStart = null;
  let pendingLoginCheck = null;
  let pendingAuthProbe = null;
  let authProbe = null;
  let authEpoch = 0;
  let activeAccountUses = 0;

  const supported = platform === 'win32' && architecture === 'x64';

  function expireLoginAttempt() {
    if (
      loginAttempt?.status === 'awaiting-authorization'
      && new Date(loginAttempt.expiresAt).getTime() <= now().getTime()
    ) {
      loginAttempt = {
        status: 'expired',
        loginRunning: false,
        retryable: true,
        message: '即梦登录已超时，请重新发起登录。',
      };
    }
  }

  function publicLoginAttempt() {
    expireLoginAttempt();
    if (!loginAttempt) return null;
    const {
      status,
      loginRunning,
      retryable,
      message,
      verificationUri,
      userCode,
      expiresAt,
      pollAfterMs,
      browserOpened,
    } = loginAttempt;
    return Object.freeze({
      status,
      loginRunning,
      retryable,
      message,
      ...(verificationUri ? { verificationUri } : {}),
      ...(userCode ? { userCode } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(pollAfterMs ? { pollAfterMs } : {}),
      ...(typeof browserOpened === 'boolean' ? { browserOpened } : {}),
    });
  }

  function runCli(executablePath, args, authHome, {
    timeoutMs = loginCommandTimeoutMs,
    outputLimit = LOGIN_OUTPUT_LIMIT,
    startCode = 'DREAMINA_LOGIN_START_FAILED',
    startMessage = '无法启动即梦登录，请重新安装后重试。',
    outputCode = 'DREAMINA_LOGIN_OUTPUT_INVALID',
    outputMessage = '即梦登录返回内容异常，请更新 AIFISHER 后重试。',
    timeoutCode = 'DREAMINA_LOGIN_COMMAND_TIMEOUT',
    timeoutMessage = '即梦登录响应超时，请检查网络后重试。',
    signal = null,
  } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnChild(executablePath, args, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            HOME: authHome,
            USERPROFILE: authHome,
          },
        });
      } catch {
        reject(Object.assign(new DreaminaCliInstallError(
          startCode,
          startMessage,
          500,
        ), { submissionNotStarted: true }));
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeout = null;
      let abort = () => {};
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', abort);
        if (error) reject(error);
        else resolve(result);
      };
      const append = (current, chunk) => {
        const next = current + Buffer.from(chunk).toString('utf8');
        if (Buffer.byteLength(next, 'utf8') > outputLimit) {
          child.kill?.();
          finish(new DreaminaCliInstallError(
            outputCode,
            outputMessage,
            502,
          ));
        }
        return next;
      };
      child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
      child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
      child.once('error', () => finish(Object.assign(new DreaminaCliInstallError(
        startCode,
        startMessage,
        500,
      ), { submissionNotStarted: !child.pid })));
      child.once('exit', (code, signal) => finish(null, {
        code: Number.isInteger(code) ? code : -1,
        signal: signal || null,
        stdout,
        stderr,
      }));
      timeout = setTimeout(() => {
        child.kill?.();
        finish(new DreaminaCliInstallError(
          timeoutCode,
          timeoutMessage,
          504,
        ));
      }, timeoutMs);
      abort = () => {
        child.kill?.();
        finish(Object.assign(new Error('Generation cancelled'), { name: 'AbortError' }));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener?.('abort', abort, { once: true });
    });
  }

  async function inspectPrivate() {
    if (!supported) {
      return {
        public: {
          status: 'unsupported',
          installable: false,
          loginRunning: false,
          message: '即梦 CLI 当前只支持 64 位 Windows。',
        },
      };
    }
    let manifest;
    try {
      manifest = JSON.parse(await readFile(activeManifestPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { public: { status: 'missing', installable: true, loginRunning: false } };
      }
      return {
        public: {
          status: 'invalid',
          installable: true,
          loginRunning: false,
          message: '本机即梦 CLI 安装记录损坏，可以重新安装修复。',
        },
      };
    }
    if (
      manifest?.schemaVersion !== 1
      || !VERSION_PATTERN.test(String(manifest.version || ''))
      || !HASH_PATTERN.test(String(manifest.binarySha256 || ''))
      || typeof manifest.executable !== 'string'
    ) {
      return {
        public: {
          status: 'invalid',
          installable: true,
          loginRunning: false,
          message: '本机即梦 CLI 安装记录无效，可以重新安装修复。',
        },
      };
    }
    let executablePath;
    try {
      executablePath = contained(root, path.join(root, manifest.executable));
      const [rootStats, executableStats] = await Promise.all([
        optionalLstat(root),
        optionalLstat(executablePath),
      ]);
      if (
        !rootStats?.isDirectory()
        || rootStats.isSymbolicLink()
        || !executableStats?.isFile()
        || executableStats.isSymbolicLink()
        || (await fileSha256(executablePath)) !== manifest.binarySha256
      ) {
        throw new Error('invalid installation');
      }
    } catch {
      return {
        public: {
          status: 'invalid',
          installable: true,
          loginRunning: false,
          message: '本机即梦 CLI 文件不完整，可以重新安装修复。',
        },
      };
    }
    const login = publicLoginAttempt();
    return {
      executablePath,
      public: {
        status: 'installed',
        installable: true,
        loginRunning: Boolean(login?.loginRunning),
        version: manifest.version,
        installedAt: manifest.installedAt,
        ...(login ? { login } : {}),
      },
    };
  }

  async function inspect({ refreshAuthentication = false } = {}) {
    const status = (await inspectPrivate()).public;
    if (!refreshAuthentication || status.status !== 'installed') return status;
    const account = await getAccount({ fresh: true });
    const pending = publicLoginAttempt();
    return { ...status, account, login: pending?.status === 'awaiting-authorization' ? pending : {
      status: account ? 'authenticated' : 'idle', loginRunning: false, retryable: !account,
      message: account ? '即梦已登录，可以在 AIFISHER 中使用。' : '请登录即梦；已有授权暂不可用时，可重试检测。',
    } };
  }

  async function installOnce() {
    if (!supported) {
      throw new DreaminaCliInstallError(
        'DREAMINA_PLATFORM_UNSUPPORTED',
        '即梦 CLI 当前只支持 64 位 Windows。',
      );
    }
    const installer = await fetchBuffer(
      fetcher,
      INSTALLER_URL,
      MAX_INSTALLER_BYTES,
      { exactPath: '/cli' },
    );
    const contract = parseInstaller(installer);
    const versionBuffer = await fetchBuffer(fetcher, contract.versionUrl, MAX_VERSION_BYTES);
    const version = parseVersion(versionBuffer);
    const previous = await inspect();
    if (previous.status === 'installed' && previous.version === version) {
      return { ...previous, changed: false };
    }
    const [binary, skill] = await Promise.all([
      fetchBuffer(fetcher, contract.binaryUrl, MAX_BINARY_BYTES),
      fetchBuffer(fetcher, contract.skillUrl, MAX_SKILL_BYTES),
    ]);
    const integrity = validateArtifacts({
      binary,
      skill,
      expectedSkillMd5: contract.skillMd5,
    });

    await mkdir(root, { recursive: true });
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new DreaminaCliInstallError(
        'DREAMINA_INSTALL_PATH_UNSAFE',
        '即梦 CLI 安装目录不安全，安装已停止。',
        500,
      );
    }
    const versionsRoot = contained(root, path.join(root, 'versions'));
    await mkdir(versionsRoot, { recursive: true });
    const versionDirectoryName = `${version}-${integrity.binarySha256.slice(0, 12)}`;
    const versionDirectory = contained(root, path.join(versionsRoot, versionDirectoryName));
    const staging = await mkdtemp(path.join(root, '.install-'));
    try {
      await Promise.all([
        writeFile(path.join(staging, 'dreamina.exe'), binary, { flag: 'wx', mode: 0o700 }),
        writeFile(path.join(staging, 'SKILL.md'), skill, { flag: 'wx', mode: 0o600 }),
        writeFile(path.join(staging, 'version.json'), versionBuffer, { flag: 'wx', mode: 0o600 }),
      ]);
      const existing = await optionalLstat(versionDirectory);
      if (!existing) {
        await rename(staging, versionDirectory);
      } else {
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          throw new DreaminaCliInstallError(
            'DREAMINA_INSTALL_PATH_UNSAFE',
            '即梦 CLI 版本目录不安全，安装已停止。',
            500,
          );
        }
        const existingExecutable = path.join(versionDirectory, 'dreamina.exe');
        if ((await fileSha256(existingExecutable)) !== integrity.binarySha256) {
          throw new DreaminaCliInstallError(
            'DREAMINA_INSTALL_CONFLICT',
            '本机存在冲突的即梦 CLI 文件，安装已停止。',
            409,
          );
        }
      }

      const manifest = {
        schemaVersion: 1,
        source: 'official-dreamina-cli',
        version,
        executable: `versions/${versionDirectoryName}/dreamina.exe`,
        binarySha256: integrity.binarySha256,
        skillMd5: integrity.skillMd5,
        installedAt: now().toISOString(),
      };
      const temporaryManifest = `${activeManifestPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temporaryManifest, activeManifestPath);
      } finally {
        await rm(temporaryManifest, { force: true }).catch(() => {});
      }
      return { ...(await inspect()), changed: true };
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function install() {
    if (!pendingInstall) {
      pendingInstall = installOnce().finally(() => { pendingInstall = null; });
    }
    return pendingInstall;
  }

  async function openLoginPage(browser) {
    let browserOpened = true;
    try {
      if (browser === 'default') await openBrowser(loginAttempt.verificationUri);
      else await openBrowser(loginAttempt.verificationUri, browser);
    } catch {
      browserOpened = false;
    }
    loginAttempt.browserOpened = browserOpened;
    loginAttempt.message = browserOpened
      ? '已打开即梦官方授权页，请核对用户码并完成登录。'
      : '未能打开所选浏览器，请复制授权链接到该浏览器打开。';
    return publicLoginAttempt();
  }

  async function startLoginOnce({ force = false, browser = 'default' } = {}) {
    if (typeof force !== 'boolean' || !['default', 'edge', 'chrome'].includes(browser)) {
      throw new DreaminaCliInstallError('DREAMINA_LOGIN_ARGUMENT_INVALID', '请选择有效的登录浏览器。', 400);
    }
    if (activeAccountUses) throw new DreaminaCliInstallError('DREAMINA_ACCOUNT_BUSY', '即梦任务正在提交或查询，请等待完成后切换账号。', 409);
    if (pendingLoginCheck) await pendingLoginCheck;

    const installed = await inspectPrivate();
    if (installed.public.status !== 'installed' || !installed.executablePath) {
      throw new DreaminaCliInstallError(
        'DREAMINA_CLI_NOT_INSTALLED',
        '请先安装即梦 CLI。',
      );
    }
    const current = publicLoginAttempt();
    if (!force && current?.status === 'awaiting-authorization') return openLoginPage(browser);
    authEpoch += 1;
    authProbe = null;
    if (force) loginAttempt = null;
    const authHome = contained(root, path.join(root, 'auth-home'));
    await mkdir(authHome, { recursive: true });
    const result = await runCli(installed.executablePath, [force ? 'relogin' : 'login', '--headless'], authHome);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code === 0 && loginOutputIsAuthenticated(output)) {
      loginAttempt = {
        status: 'authenticated',
        loginRunning: false,
        retryable: false,
        message: '即梦已登录，可以在 AIFISHER 中使用。',
      };
      return publicLoginAttempt();
    }
    if (result.code !== 0) {
      throw new DreaminaCliInstallError(
        'DREAMINA_LOGIN_START_FAILED',
        '即梦未能发起登录，请检查网络后重试。',
        502,
      );
    }
    const deviceFlow = parseDeviceFlow(output, now);
    loginAttempt = {
      ...deviceFlow,
      status: 'awaiting-authorization',
      loginRunning: true,
      retryable: true,
    };
    return openLoginPage(browser);
  }

  function startLogin(options) {
    pendingLoginStart ??= startLoginOnce(options).finally(() => { pendingLoginStart = null; });
    return pendingLoginStart;
  }

  async function checkLoginOnce() {
    if (pendingLoginStart) await pendingLoginStart;
    const current = publicLoginAttempt();
    if (!current) {
      return Object.freeze({
        status: 'idle',
        loginRunning: false,
        retryable: true,
        message: '请先发起即梦登录。',
      });
    }
    if (current.status !== 'awaiting-authorization') return current;
    const deviceCode = loginAttempt.deviceCode;
    const installed = await inspectPrivate();
    if (!deviceCode || !installed.executablePath) return publicLoginAttempt();
    const authHome = contained(root, path.join(root, 'auth-home'));
    const result = await runCli(
      installed.executablePath,
      ['login', 'checklogin', `--device_code=${deviceCode}`, '--poll=0'],
      authHome,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code === 0) {
      authEpoch += 1; authProbe = null;
      loginAttempt = {
        status: 'authenticated',
        loginRunning: false,
        retryable: false,
        message: '即梦登录成功，现在可以在 AIFISHER 中使用。',
      };
      return publicLoginAttempt();
    }
    if (/(?:登录尚未完成|authorization[_ ]pending|increase\s+--poll)/iu.test(output)) {
      loginAttempt = { ...loginAttempt, status: 'awaiting-authorization' };
      return publicLoginAttempt();
    }
    if (/(?:过期|已失效|expired|invalid device)/iu.test(output)) {
      loginAttempt = {
        status: 'expired',
        loginRunning: false,
        retryable: true,
        message: '即梦登录已过期，请重新发起登录。',
      };
      return publicLoginAttempt();
    }
    loginAttempt = {
      status: 'failed',
      loginRunning: false,
      retryable: true,
      message: '未能确认即梦登录状态，请检查网络后重试。',
    };
    return publicLoginAttempt();
  }

  function checkLogin() {
    pendingLoginCheck ??= checkLoginOnce().finally(() => { pendingLoginCheck = null; });
    return pendingLoginCheck;
  }

  async function execute(args, { timeoutMs = 30_000, signal = null } = {}) {
    if (
      !Array.isArray(args)
      || !RUNTIME_COMMANDS.has(args[0])
      || args.length > 128
      || args.some((argument) => typeof argument !== 'string' || Buffer.byteLength(argument, 'utf8') > 16 * 1024)
      || !Number.isInteger(timeoutMs)
      || timeoutMs < 100
      || timeoutMs > 60 * 60 * 1000
    ) {
      throw new DreaminaCliInstallError(
        'DREAMINA_RUNTIME_ARGUMENT_INVALID',
        '即梦 CLI 调用参数无效，任务已停止。',
        400,
      );
    }
    const installed = await inspectPrivate();
    if (installed.public.status !== 'installed' || !installed.executablePath) {
      throw new DreaminaCliInstallError(
        'DREAMINA_CLI_NOT_INSTALLED',
        '请先安装即梦 CLI。',
      );
    }
    const authHome = contained(root, path.join(root, 'auth-home'));
    await mkdir(authHome, { recursive: true });
    return runCli(installed.executablePath, args, authHome, {
      timeoutMs,
      outputLimit: RUNTIME_OUTPUT_LIMIT,
      startCode: 'DREAMINA_RUNTIME_START_FAILED',
      startMessage: '无法启动即梦 CLI，请重新安装后重试。',
      outputCode: 'DREAMINA_RUNTIME_OUTPUT_INVALID',
      outputMessage: '即梦 CLI 返回内容过大或异常，任务已停止。',
      timeoutCode: 'DREAMINA_RUNTIME_COMMAND_TIMEOUT',
      timeoutMessage: '即梦 CLI 命令响应超时，请检查网络后重试。',
      signal,
    });
  }

  async function getAccount({ fresh = false } = {}) {
    const checkedAt = now().getTime();
    if (!fresh && authProbe && checkedAt - authProbe.checkedAt < AUTH_PROBE_CACHE_MS) return authProbe.account;
    if (pendingAuthProbe) return pendingAuthProbe;
    const epoch = authEpoch;
    pendingAuthProbe = (async () => {
      let account = null;
      try {
        const result = await execute(['user_credit'], { timeoutMs: 15_000 });
        const value = result.code === 0 ? JSON.parse(result.stdout) : null;
        const uid = typeof value?.user_id === 'number' && Number.isSafeInteger(value.user_id)
          ? String(value.user_id) : typeof value?.user_id === 'string' ? value.user_id : '';
        if (/^[0-9]{1,32}$/.test(uid)) account = {
          uid, nickname: typeof value.user_name === 'string' ? [...value.user_name].filter((character) => character.codePointAt(0) >= 32).join('').slice(0, 100) : '',
        };
      } catch { /* Authentication errors never disclose CLI output or credentials. */ }
      if (epoch !== authEpoch) return null;
      authProbe = { checkedAt: now().getTime(), account };
      return account;
    })().finally(() => { pendingAuthProbe = null; });
    return pendingAuthProbe;
  }

  async function isAuthenticated() { return Boolean(await getAccount()); }

  function getCachedAuthentication() {
    // Fast model discovery uses the last confirmed state while refreshing it.
    // Generation always acquires a fresh account lease before submission.
    return Boolean(authProbe?.account);
  }

  async function acquireAccount() {
    if (pendingLoginStart || publicLoginAttempt()?.status === 'awaiting-authorization') {
      throw new DreaminaCliInstallError('DREAMINA_LOGIN_PENDING', '请先完成即梦账号授权。', 409);
    }
    activeAccountUses += 1;
    let released = false;
    const release = () => { if (!released) { released = true; activeAccountUses -= 1; } };
    try {
      const account = await getAccount({ fresh: true });
      if (!account) throw new DreaminaCliInstallError('DREAMINA_CLI_NOT_AUTHENTICATED', '即梦登录暂不可用，请检查网络或重新授权。', 401);
      return { account, release };
    } catch (error) { release(); throw error; }
  }

  async function createTaskDirectory() {
    const installed = await inspectPrivate();
    if (installed.public.status !== 'installed') {
      throw new DreaminaCliInstallError('DREAMINA_CLI_NOT_INSTALLED', '请先安装即梦 CLI。');
    }
    const tasksRoot = contained(root, path.join(root, 'tasks'));
    await mkdir(tasksRoot, { recursive: true });
    const stats = await lstat(tasksRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new DreaminaCliInstallError(
        'DREAMINA_TASK_PATH_UNSAFE',
        '即梦 CLI 临时任务目录不安全，任务已停止。',
        500,
      );
    }
    return mkdtemp(path.join(tasksRoot, '.task-'));
  }

  async function cleanupTaskDirectory(directory) {
    const tasksRoot = contained(root, path.join(root, 'tasks'));
    const candidate = contained(tasksRoot, directory);
    const relative = path.relative(tasksRoot, candidate);
    if (relative.includes(path.sep) || !path.basename(candidate).startsWith('.task-')) {
      throw new DreaminaCliInstallError(
        'DREAMINA_TASK_PATH_UNSAFE',
        '即梦 CLI 临时任务目录不安全，未执行清理。',
        500,
      );
    }
    const stats = await lstat(candidate).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!stats) return;
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new DreaminaCliInstallError(
        'DREAMINA_TASK_PATH_UNSAFE',
        '即梦 CLI 临时任务目录不安全，未执行清理。',
        500,
      );
    }
    await rm(candidate, { recursive: true, force: true });
  }

  return {
    inspect,
    install,
    startLogin,
    checkLogin,
    execute,
    isAuthenticated,
    getAccount,
    acquireAccount,
    getCachedAuthentication,
    createTaskDirectory,
    cleanupTaskDirectory,
  };
}

export const DREAMINA_CLI_OFFICIAL_INSTALL_COMMAND =
  'curl -fsSL https://jimeng.jianying.com/cli | bash';
