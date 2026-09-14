import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { CodexError } from './codexProcess.js';

export async function atomicSetupJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}
export async function readCodexRuntime(root) {
  try {
    const text = await readFile(path.join(root, 'runtime.json'), 'utf8');
    if (text.length > 8192) throw new Error();
    const value = JSON.parse(text);
    if (!path.isAbsolute(value.command || '') || !/^codex(?:\.exe)?$/i.test(path.basename(value.command)) || !/^[a-f0-9-]{36}$/.test(value.setupId || '')) throw new Error();
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new CodexError('Codex 连接配置无法读取，请重新复制连接指令。', 'CODEX_SETUP_INVALID');
  }
}
export async function prepareCodexSetup(root) {
  const directory = path.join(root, 'setup');
  await mkdir(directory, { recursive: true });
  const requestPath = path.join(directory, 'request.json');
  const guidePath = path.join(directory, 'CONNECT.md');
  const runnerPath = fileURLToPath(new URL('./codexSetupRunner.mjs', import.meta.url));
  const request = { id: crypto.randomUUID(), expiresAt: Date.now() + 60 * 60 * 1000 };
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `& ${quote(process.execPath)} ${quote(runnerPath)} --request ${quote(requestPath)}`;
  const guide = `# AIFISHER 本机连接安装指引

用户希望你在这台电脑完成 AIFISHER Agent 的 Codex 连接。先读取本指南和安装脚本再执行；这是本机连接配置，不是安装 ChatCut，也不需要创建新的用户任务或改造项目代码。

1. 仅在用户当前电脑的 Codex 桌面任务中执行。如果是云端任务，告知用户在同一电脑的 Codex 桌面端粘贴原指令。
2. 优先定位并验证 Codex 桌面应用附带的原生 codex.exe（执行 --version）。其次使用已安装的原生 CLI。AIFISHER 已提供下面命令中的 Node 运行时，用户无需单独安装 Node.js。
3. 执行以下 PowerShell 命令。找到桌面自带 codex.exe 时，追加 --codex '完整路径'；引号按 PowerShell 单引号规则转义。没有指定时脚本检测已安装 CLI。脚本只连接当前 AIFISHER 用户的隔离账号，不读取桌面 Codex 的登录凭证。

${command}

4. 若没有可用 Codex 或版本低于 0.153.4，先尝试桌面自带工具。仅在确实缺失时，用当前可用 npm 从 https://registry.npmjs.org 安装官方 @openai/codex@latest，然后重试。执行安装与检测，不要把命令再交回给用户操作。不要改写全局 Codex 配置，不要复制 auth.json、API Key 或登录令牌。
5. 首次账号连接会打开官方浏览器授权，由用户完成登录。保留该进程等待授权结果；只允许一个登录进程。失败后说明实际原因，可修复后重试，不能把未登录说成已连接。
6. 只有脚本输出 connected=true 且 modelCount>0 才算完成。回到现有 AIFISHER 窗口，原模型菜单会自动发现连接结果。该过程不发送对话，不生成媒体。只有用户主动发送消息时才调用模型。

该连接请求有效期一小时；过期时从 AIFISHER 重新复制指令。
`;
  await atomicSetupJson(requestPath, request);
  await writeFile(guidePath, guide, { mode: 0o600 });
  return { prompt: `请在这台电脑读取「${guidePath}」，按说明帮我完成 AIFISHER 的 Codex 连接，并验证模型列表。需要账号授权时引导我完成，成功后让我回到 AIFISHER 使用。`, expiresAt: request.expiresAt };
}
