import { useState, useSyncExternalStore } from 'react';
import type { CanvasExternalClient } from './canvasExternalClient';

function desktopInstructions(command: string) {
  return `请将当前 AIFISHER 画布接入这个 Codex 桌面任务。请在本机 PowerShell 执行以下配对指令（两分钟内有效，仅限本机使用）：\n\n${command}\n\n配置成功后，告诉我到 Codex「设置 → 插件 → MCP」，找到 aifisher 并启用；如果已启用但工具未加载，关闭再开启其开关。返回此任务后，请用 aifisher 的 canvas_control 读取画布验证连接。若本任务仍未加载工具，请明确告知我新建任务再验证。只读取验证，不创建节点或调用付费生成。`;
}

export function AgentExternalConnection({ controller }: { controller: CanvasExternalClient }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [manageProjects, setManageProjects] = useState(false), [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(''), [copyError, setCopyError] = useState('');
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setCopyError(''); }
    catch { setCopyError('未能写入剪贴板，请展开下方指引并手动复制。'); }
  }
  async function pairDesktop() {
    setBusy(true); setCopied(''); setCopyError('');
    try {
      await controller.pair(manageProjects);
      const command = controller.getSnapshot().desktopCommand;
      if (command) await copy(desktopInstructions(command), 'desktop');
    } finally { setBusy(false); }
  }
  return <details className="shrink-0 text-xs text-[var(--af-text-secondary)]" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
      event.stopPropagation();
    }
  }}>
    <summary aria-label="外部 Codex 连接" className="cursor-pointer list-none rounded-lg px-3 py-2 hover:bg-[var(--af-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)]">让外部 Codex 操作画布{state.grants.some(grant => !grant.revoked) ? ' · 已配对' : ''}</summary>
    <div className="max-h-[65vh] overflow-y-auto px-3 pb-3 leading-relaxed">
      <p className="my-2">连接同一电脑上的 Codex 桌面对话，直接读取和编辑当前画布。请先安装并登录 Codex 桌面版，保持此项目打开。</p>
      <label className="flex gap-2"><input type="checkbox" checked={manageProjects} disabled={busy} onChange={event => setManageProjects(event.target.checked)} />另允许管理本人其他项目</label>
      <button type="button" disabled={busy} className="my-3 rounded bg-[var(--af-primary)] px-3 py-2 text-[var(--af-on-primary)] disabled:opacity-50" onClick={() => void pairDesktop()}>{busy ? '正在配对…' : '一键配对并复制连接指引'}</button>
      <ol className="list-decimal space-y-2 pl-5">
        <li>点击上方按钮，在两分钟内把指引粘贴到 Codex 桌面对话并发送，由 Codex 完成本机配置。</li>
        <li>配置完成后，打开 Codex 的<strong>设置 → 插件 → MCP</strong>，找到 <strong>aifisher</strong>，打开右侧开关。已经打开但未加载时，关闭再开启。</li>
        <li>回到 Codex 对话，发送“读取当前 AIFISHER 画布”。能返回当前节点，才表示连接成功。</li>
      </ol>
      <p role="status" className="my-2">{copied === 'desktop' ? '已复制连接指引，请粘贴到 Codex 桌面对话发送。' : ''}</p>
      {state.desktopCommand && <details className="my-2"><summary className="cursor-pointer">查看指引 / 手动复制</summary>
        <textarea readOnly value={desktopInstructions(state.desktopCommand)} aria-label="Codex 桌面连接指引" className="my-2 h-36 w-full rounded bg-[var(--af-input)] p-2" />
        <button type="button" className="underline" onClick={() => void copy(desktopInstructions(state.desktopCommand), 'desktop')}>重新复制连接指引</button>
        <p className="mt-2">也可自行在 PowerShell 执行下面的配置指令，然后按第 2、3 步启用和验证。</p>
        <textarea readOnly value={state.desktopCommand} aria-label="Codex 桌面配对指令" className="my-2 w-full rounded bg-[var(--af-input)] p-2" />
      </details>}
      <details className="my-3"><summary className="cursor-pointer">找不到 MCP 或连接失败？</summary>
        <p className="my-2">插件页面顶部要点击“MCP”标签，不是“插件”列表。没有 aifisher：先确认 Codex 已成功执行配置指令，再重新打开设置页面。</p>
        <p className="my-2">启用后当前对话仍提示没有工具：新建一个 Codex 任务，再发送“读取当前 AIFISHER 画布”。开关开启只代表启用，实际读取成功才算接通。</p>
        <p className="my-2">配对码过期或已使用：重新点击上方按钮并发送新指引。连接最长一小时；授权过期、关闭项目或退出登录后，请在目标画布重新配对。</p>
      </details>
      <details className="my-3"><summary className="cursor-pointer">备用：连接 Codex CLI（终端）</summary>
        <p className="my-2">仅在使用终端版 Codex 时选择。桌面与 CLI 指令共用一次性配对码，不能执行两次；切换方式请重新配对。</p>
        <button type="button" disabled={busy} className="underline" onClick={() => { setCopied(''); void controller.pair(manageProjects); }}>配对此窗口</button>
        {state.command && <div><p className="my-2">{state.codexCommand ? '两分钟内在 PowerShell 执行，打开连接此画布的 Codex CLI；配置仅对该次运行有效。' : '本机未找到 Codex CLI，可将下面命令用于客户端的临时 MCP 配置。'}</p>
          <textarea readOnly value={state.codexCommand || state.command} aria-label="外部 Codex 配对指令" className="my-2 w-full rounded bg-[var(--af-input)] p-2" />
          <button type="button" onClick={() => void copy(state.codexCommand || state.command, 'cli')}>{copied === 'cli' ? '已复制' : '复制 CLI 指令'}</button>
        </div>}
      </details>
      <details className="my-3"><summary className="cursor-pointer">连接权限与窗口管理</summary>
        <p className="my-2">允许读取和编辑此项目、读取素材、处理媒体及准备生成。实际生成仍须在画布确认，或使用已批准的连续生成授权。</p>
        <p className="my-2">同一项目由一个窗口执行助手操作；需要换窗口时，在操作结束后接管。画布内直接对话请从模型菜单连接 Codex。</p>
        <button type="button" className="underline" onClick={() => void controller.activate()}>由此窗口控制助手操作</button>
      </details>
      {state.command && <button type="button" className="my-2 underline" onClick={() => void controller.revoke('')}>取消未使用的配对</button>}
      {state.grants.filter(grant => !grant.revoked).map(grant => <div key={grant.id} className="my-2 border-t border-[var(--af-border-control)] pt-2"><p>{grant.thisWindow ? '此窗口' : '其他窗口'} · {grant.manageProjects ? '当前画布与本人项目管理' : '仅当前画布'} · 至 {new Date(grant.expiresAt).toLocaleTimeString()}</p><button type="button" onClick={() => void controller.revoke(grant.id)}>撤销连接</button></div>)}
      {(copyError || state.error) && <p role="alert" className="my-2 text-[var(--af-warning)]">{copyError || state.error}</p>}
    </div>
  </details>;
}
