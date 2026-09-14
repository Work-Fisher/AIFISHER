import path from 'node:path';
import { readFile, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCodexProcess, findCodexCommand, openCodexLogin, readCodexVersion } from './codexProcess.js';
import { atomicSetupJson } from './codexSetup.js';

export function supportsCodexSetup(version) {
  const parts = String(version || '').split('.').map(Number);
  return parts.length === 3 && parts.every(Number.isInteger) && (parts[0] > 0 || parts[1] > 153 || (parts[1] === 153 && parts[2] >= 4));
}
export async function runCodexSetup({ requestPath, command, resolveCommand = findCodexCommand, readVersion = readCodexVersion, makeRpc = createCodexProcess, openBrowser = openCodexLogin, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log, maxPolls = 150 }) {
  if (!path.isAbsolute(requestPath || '') || path.basename(requestPath) !== 'request.json' || path.basename(path.dirname(requestPath)) !== 'setup') throw new Error('连接请求路径无效。');
  const root = path.dirname(path.dirname(requestPath));
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  if (!/^[a-f0-9-]{36}$/.test(request.id || '') || !Number.isFinite(request.expiresAt) || request.expiresAt <= Date.now()) throw new Error('连接指令已过期，请回到 AIFISHER 重新复制。');
  const lockPath = path.join(root, 'setup', 'running.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch {
    let stale = false;
    try {
      const previous = JSON.parse(await readFile(lockPath, 'utf8'));
      if (Number.isInteger(previous.pid) && previous.pid > 0) {
        try { process.kill(previous.pid, 0); } catch (error) { stale = error.code === 'ESRCH'; }
      }
    } catch { /* An incomplete lock can belong to a process still starting. */ }
    if (!stale) throw new Error('另一个连接流程仍在进行。请先完成或关闭原进程。');
    await unlink(lockPath);
    lock = await open(lockPath, 'wx', 0o600);
  }
  let rpc;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    const resolved = command ? [command, []] : await resolveCommand();
    if (!path.isAbsolute(resolved[0]) || !/^codex(?:\.exe)?$/i.test(path.basename(resolved[0])) || resolved[1].length) throw new Error('请使用经过验证的原生 codex.exe 路径。');
    const version = await readVersion(...resolved);
    if (!supportsCodexSetup(version)) throw new Error('Codex 工具过旧或不可用，请使用 0.153.4 或更高版本后重试。');
    rpc = makeRpc({ home: path.join(root, 'home'), cwd: path.join(root, 'workspace'), resolveCommand: async () => resolved });
    await rpc.start();
    let { account } = await rpc.request('account/read', { refreshToken: false });
    if (!account) {
      const login = await rpc.request('account/login/start', { type: 'chatgpt' });
      const url = new URL(login.authUrl);
      if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname) || url.username || url.password) throw new Error('官方授权地址无效。');
      await openBrowser(url.href);
      log('已打开官方登录页，请完成账号授权。正在等待连接结果。');
      for (let attempt = 0; attempt < maxPolls && !account; attempt++) {
        await wait(4000);
        ({ account } = await rpc.request('account/read', { refreshToken: false }));
      }
    }
    if (!account) throw new Error('等待授权超时，请重新运行连接指令。');
    const models = await rpc.request('model/list', { limit: 100, includeHidden: false });
    if (!models.data?.length) throw new Error('账号已登录，但尚未读取到模型，请检查账号权限和工具版本。');
    const latest = JSON.parse(await readFile(requestPath, 'utf8'));
    if (latest.id !== request.id || latest.expiresAt <= Date.now()) throw new Error('连接请求已被替换或过期，请使用最新指令。');
    await atomicSetupJson(path.join(root, 'runtime.json'), { command: resolved[0], setupId: request.id, version });
    const result = { connected: true, version, modelCount: models.data.length };
    log(JSON.stringify(result));
    return result;
  } finally {
    rpc?.close();
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  try { await runCodexSetup({ requestPath: option('--request'), command: option('--codex') }); }
  catch (error) { console.error(error.code === 'ENOENT' ? '连接文件或工具不存在，请重新复制指令并检测工具。' : error instanceof SyntaxError ? '连接文件无效，请重新复制指令。' : error.message); process.exitCode = 1; }
}
