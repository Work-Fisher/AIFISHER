import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readDesktopConnection, configureDesktopConnection } from './canvasDesktopConnection.mjs';
import { canvasControlTool } from '../../../src/shared/canvasControlProtocol.js';

const args = process.argv.slice(2), desktop = args.includes('--desktop');
let port = Number(args[args.indexOf('--port') + 1]);
const code = args[args.indexOf('--pair') + 1];
const grant = args.includes('--grant') ? process.env.AIFISHER_CANVAS_TOKEN : null;
if (!desktop && (!Number.isInteger(port) || port < 1 || port > 65535 || !(grant ? /^[\w-]{43}$/.test(grant) : /^[\w-]{32}$/.test(code || '')))) process.exit(1);
let token = grant;
async function post(path, body) {
  if (desktop) { const connection = await readDesktopConnection(); port = connection.port; token = connection.token; }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', signal: AbortSignal.timeout(125000), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!response.ok) throw Error('连接失效或超出授权。请在画布内重新配对。');
  return response.json();
}
let pairing;
if (!desktop && !token) {
  try { pairing = await post('/pair', { code }); token = pairing.token; } catch { process.stderr.write('画布配对失败，请重新生成配对指令。\n'); process.exit(1); }
}
if (args.includes('--desktop-setup')) {
  try { await configureDesktopConnection({ port, token, expiresAt: pairing.expiresAt }, fileURLToPath(import.meta.url)); process.stdout.write('已配置 Codex 桌面 MCP。请在 Codex 设置的 MCP servers 中重启 aifisher，然后在桌面任务使用画布工具。\n'); process.exit(0); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}
// Windows PowerShell 5.1 strips embedded JSON quotes passed to native commands.
// Pass only an opaque launch descriptor through PowerShell, then construct argv here.
if (args.includes('--codex-launch')) {
  try {
    const { executable, prefix } = JSON.parse(Buffer.from(args[args.indexOf('--codex-launch') + 1], 'base64url').toString());
    if (typeof executable !== 'string' || !Array.isArray(prefix) || !prefix.every(value => typeof value === 'string')) throw Error();
    const child = spawn(executable, [...prefix,
      '-c', `mcp_servers.aifisher.command=${JSON.stringify(process.execPath)}`,
      '-c', `mcp_servers.aifisher.args=${JSON.stringify([fileURLToPath(import.meta.url), '--port', String(port), '--grant'])}`,
      '-c', 'mcp_servers.aifisher.env_vars=["AIFISHER_CANVAS_TOKEN"]',
    ], { stdio: 'inherit', shell: false, env: { ...process.env, AIFISHER_CANVAS_TOKEN: token } });
    child.on('error', () => { process.stderr.write('Codex 启动失败，请检查安装后重新生成配对指令。\n'); process.exit(1); });
    child.on('exit', exitCode => process.exit(exitCode ?? 1));
    await new Promise(() => {});
  } catch { process.stderr.write('Codex 启动参数无效，请重新生成配对指令。\n'); process.exit(1); }
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
for await (const line of lines) {
  let message;
  try {
    message = JSON.parse(line);
    if (message.id === undefined) continue;
    if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'aifisher-canvas', version: '1' } } });
    else if (message.method === 'ping') send({ id: message.id, result: {} });
    else if (message.method === 'tools/list') send({ id: message.id, result: { tools: [{ name: canvasControlTool.name, description: canvasControlTool.description, inputSchema: canvasControlTool.inputSchema }] } });
    else if (message.method === 'tools/call' && message.params?.name === canvasControlTool.name) {
      try {
        const result = await post('/control', { requestId: crypto.randomUUID(), command: message.params.arguments });
        const { images = [], ...summary } = result;
        send({ id: message.id, result: { isError: !result.ok, content: [{ type: 'text', text: JSON.stringify(summary) }, ...images.map(image => { const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(image.dataUrl); return { type: 'image', mimeType: match[1], data: match[2] }; })] } });
      } catch { send({ id: message.id, result: { isError: true, content: [{ type: 'text', text: '操作结果未确认。请先在画布核对，不能自动重提。' }] } }); }
    } else send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
  } catch { send({ id: message?.id ?? null, error: { code: -32700, message: 'Invalid request' } }); }
}
