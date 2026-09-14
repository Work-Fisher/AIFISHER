import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const home = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const connectionPath = () => path.join(home(), 'aifisher-connection.dpapi');
function protect(value, decrypt = false) {
  const script = `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: Buffer.from(value).toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 10000,
  }).trim(), 'base64');
}
export async function readDesktopConnection() {
  const value = JSON.parse(protect(await readFile(connectionPath()), true).toString('utf8'));
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[\w-]{43}$/.test(value.token) || value.expiresAt <= Date.now()) throw Error('连接过期');
  return value;
}
export async function configureDesktopConnection(connection, helper) {
  const root = home(), config = path.join(root, 'config.toml');
  await mkdir(root, { recursive: true });
  const previous = await readFile(config, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const start = '# BEGIN AIFISHER DESKTOP MCP', end = '# END AIFISHER DESKTOP MCP';
  const existing = previous.indexOf(start), finish = previous.indexOf(end);
  const clean = existing >= 0 && finish > existing ? previous.slice(0, existing) + previous.slice(finish + end.length) : previous;
  if (/^\s*\[mcp_servers\.aifisher(?:\.|\])/m.test(clean)) throw Error('已有自定义 aifisher MCP 配置，请先在 Codex 设置中移除该项后再连接。');
  const block = `${start}\n[mcp_servers.aifisher]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([helper, '--desktop'])}\nstartup_timeout_sec = 20\ntool_timeout_sec = 130\n${end}\n`;
  if (previous) await copyFile(config, config + '.aifisher-backup');
  await writeFile(connectionPath(), protect(Buffer.from(JSON.stringify(connection))));
  await writeFile(config, clean.trimEnd() + '\n\n' + block, 'utf8');
}
