import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import express from 'express';

export const libTvError = (message, code = 'LIBTV_CLI_FAILED', status = 502) =>
  Object.assign(new Error(message), { code, status, expose: true, retryable: false });

// Only the backend selects the executable, config home and command arguments.
// Never inherit a shared CLI login or a caller-supplied credential environment.
export function createLibTvCliRuntime({ privateDirectory, executable = path.join(homedir(), '.libtv', process.platform === 'win32' ? 'libtv.exe' : 'libtv'), spawnChild = spawn } = {}) {
  if (!privateDirectory) throw new Error('privateDirectory is required');
  const root = path.resolve(privateDirectory);
  const configDirectory = path.join(root, 'auth');
  let cached = null, probedAt = 0, probe = null, login = null, loginError = '', uses = 0;
  const projects = new Map();

  async function execute(args, { signal, onProgress, timeoutMs = 60_000 } = {}) {
    if (!['account', 'project', 'node', 'upload', 'login', 'model'].includes(args[0])
      || args.some(value => typeof value !== 'string' || value.includes('\0'))) throw libTvError('LibTV 命令参数无效。');
    await mkdir(configDirectory, { recursive: true });
    const env = { ...process.env, LIBTV_CONFIG_DIR: configDirectory };
    for (const key of Object.keys(env)) if (key.startsWith('LIBTV_') && key !== 'LIBTV_CONFIG_DIR') delete env[key];
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '', progress = '', timer, stopped = false;
      const child = spawnChild(executable, args, { cwd: root, env, windowsHide: true, shell: false, signal });
      const fail = () => reject(libTvError('LibTV 命令未完成，请检查安装、登录和网络。'));
      const report = line => {
        try { onProgress?.(line); }
        catch (error) { reject(error); if (!stopped) { stopped = true; child.kill(); } }
      };
      if (timeoutMs > 0) timer = setTimeout(() => { child.kill(); fail(); }, timeoutMs);
      child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-8 * 1024 * 1024); });
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-8192);
        progress += chunk.toString();
        const lines = progress.split(/\r?\n/); progress = lines.pop().slice(-8192);
        for (const line of lines) report(line);
      });
      child.once('error', () => { clearTimeout(timer); fail(); });
      child.once('close', code => {
        clearTimeout(timer);
        if (progress) report(progress);
        if (signal?.aborted) return reject(Object.assign(libTvError('已停止等待 LibTV；已提交的任务请核对原记录。'), { name: 'AbortError' }));
        if (code !== 0) return fail();
        // Login is the only supported command without a JSON response.
        if (args[0] === 'login') return resolve({});
        try { resolve(JSON.parse(stdout)); } catch { reject(libTvError('LibTV 回执格式无法识别，请核对原任务。')); }
      });
    });
  }
  async function getAccount({ fresh = false } = {}) {
    if (!fresh && Date.now() - probedAt < 30_000) return cached;
    probe ??= execute(['account', 'info'], { timeoutMs: 15_000 }).then(result => {
      const userId = result.user?.uuid || result.user?.id;
      const accountId = result.activeAccount?.accountId;
      cached = userId && accountId != null ? {
        identity: `${userId}:${accountId}:${result.teamId ?? 0}`,
        name: String(result.activeAccount?.accountName || result.user?.nickname || 'LibTV 账号'),
        teamId: String(result.teamId ?? 0),
      } : null;
      return cached;
    }).catch(() => { cached = null; return null; }).finally(() => { probedAt = Date.now(); probe = null; });
    return probe;
  }
  async function inspect() {
    const installed = await stat(executable).then(s => s.isFile()).catch(() => false);
    const account = installed && !login ? await getAccount() : cached;
    return { installed, authenticated: Boolean(account), accountName: account?.name || '', loginRunning: Boolean(login), message: loginError };
  }
  async function startLogin() {
    if (uses) throw libTvError('LibTV 正在生成，请任务结束后再切换账号。', 'LIBTV_ACCOUNT_BUSY', 409);
    if (!login) {
      cached = null; probedAt = 0; loginError = '';
      login = execute(['login', 'web', '--open'], { timeoutMs: 300_000 })
        .then(() => getAccount({ fresh: true }))
        .catch(() => { loginError = 'LibTV 登录未完成，请重新登录。'; })
        .finally(() => { login = null; });
    }
    return { installed: true, authenticated: false, loginRunning: true, accountName: '' };
  }
  async function acquireAccount() {
    if (login) throw libTvError('请先完成 LibTV 登录。', 'LIBTV_LOGIN_PENDING', 409);
    uses += 1;
    const account = await getAccount({ fresh: true });
    if (!account) { uses -= 1; throw libTvError('请先到设置中登录 LibTV CLI。', 'LIBTV_LOGIN_REQUIRED', 401); }
    let released = false;
    return { account, release() { if (!released) { uses -= 1; released = true; } } };
  }
  async function createTaskDirectory() {
    const tasks = path.join(root, 'tasks'); await mkdir(tasks, { recursive: true });
    return mkdtemp(path.join(tasks, 'task-'));
  }
  function getProject(account, localProjectId) {
    const key = createHash('sha256').update(`${account.identity}:${localProjectId || 'canvas'}`).digest('hex');
    if (!projects.has(key)) projects.set(key, (async () => {
      const directory = path.join(root, 'projects'); await mkdir(directory, { recursive: true });
      const file = path.join(directory, `${key}.json`);
      const saved = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (/^[a-zA-Z0-9-]{16,64}$/.test(saved?.uuid || '')) return saved.uuid;
      const result = await execute(['project', 'create', 'AIFISHER 画布', '--workspace', '0', '--team-id', account.teamId]);
      const uuid = result.projectMeta?.uuid;
      if (!/^[a-zA-Z0-9-]{16,64}$/.test(uuid || '')) throw libTvError('LibTV 未返回云画布编号，未提交生成。');
      await writeFile(`${file}.tmp`, JSON.stringify({ uuid }), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      return uuid;
    })().catch(error => { projects.delete(key); throw error; }));
    return projects.get(key);
  }
  async function cleanupTaskDirectory(directory) {
    const relative = path.relative(path.join(root, 'tasks'), path.resolve(directory));
    if (!/^task-[A-Za-z0-9]+$/.test(relative)) throw libTvError('LibTV 临时目录无效。');
    await rm(directory, { recursive: true, force: true });
  }
  return { execute, getAccount, inspect, startLogin, acquireAccount, getProject, createTaskDirectory, cleanupTaskDirectory,
    isAuthenticated: async () => Boolean(await getAccount()), getCachedAuthentication: () => Boolean(cached) };
}

export function createLibTvCliRouter(runtime) {
  const router = express.Router();
  for (const [method, route, action] of [['get', '/', () => runtime.inspect()], ['post', '/login', () => runtime.startLogin()]]) {
    router[method](route, async (_request, response) => {
      try { response.json(await action()); }
      catch (error) { response.status(error.status || 500).json({ error: error.expose ? error.message : 'LibTV 操作失败。', code: error.code || 'LIBTV_CLI_FAILED' }); }
    });
  }
  return router;
}
