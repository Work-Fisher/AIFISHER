import { useRef, useState } from 'react';

export function AgentMessageExport({ content, create, disabled }: { content: string; create(text: string): string; disabled?: boolean }) {
  const locked = useRef(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const exportText = async () => {
    if (disabled || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      create(content);
      try { await navigator.clipboard.writeText(content); setStatus('已复制并创建文本节点'); }
      catch { setStatus('已创建文本节点；剪贴板复制失败'); }
    } catch (error) { setStatus(error instanceof Error ? error.message : '创建文本节点失败'); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs text-[var(--af-text-secondary)]">
    {status && <span role="status">{status}</span>}
    <button type="button" disabled={disabled || busy} onClick={() => void exportText()}
      className="rounded-md border border-[var(--af-border-control)] bg-[var(--af-surface)] px-2 py-1 text-[var(--af-text-secondary)] enabled:hover:text-[var(--af-text)] enabled:hover:bg-[var(--af-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)] disabled:opacity-50 disabled:cursor-not-allowed">
      {busy ? '正在创建…' : '复制并新建文本节点'}
    </button>
  </div>;
}
