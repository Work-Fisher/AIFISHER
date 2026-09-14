import { useId, useState } from 'react';
import type { AgentDocument } from './agentDocuments';

export function AgentDocumentCard({ document }: { document: AgentDocument }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="mb-2 overflow-hidden rounded-lg border border-[var(--af-border-control)] bg-[var(--af-input)] text-sm text-[var(--af-text)]">
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}
      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--af-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)] focus-visible:-outline-offset-2">
      <span className="min-w-0"><span className="block break-all font-medium">{document.name}</span>
        <span className="text-xs text-[var(--af-text-secondary)]">文本附件 · {document.text.length.toLocaleString()} 字符</span></span>
      <span className="shrink-0 text-xs">{expanded ? '收起' : '查看全文'}</span>
    </button>
    <div id={id} hidden={!expanded}>{expanded && <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-t border-[var(--af-border-control)] bg-[var(--af-input)] p-3 font-sans text-xs text-[var(--af-text)] leading-relaxed select-text">{document.text}</pre>}</div>
  </div>;
}
