/** @jsxRuntime classic */
/** @jsx React.createElement */
import type * as ReactTypes from 'react';
import { AgentMarkdown } from './AgentMarkdown';
import { AgentMessageExport } from './AgentMessageExport';
import { splitAgentDocumentMessage } from './agentDocuments';
import { AgentDocumentCard } from './AgentDocumentCard';
type Runtime = Pick<typeof ReactTypes, 'createElement'>;
interface MessageProps {
  role: string;
  content: string;
  media?: Array<{ type: string; url?: string }>;
  timestamp?: Date;
  stopped?: boolean;
  onLocateNode?(id: string): void;
  onCreateTextNode?(text: string): string;
  actionsDisabled?: boolean;
}
export function CanvasAgentMessage(
  React: Runtime,
  { role, content = '', media, timestamp, stopped, onLocateNode, onCreateTextNode, actionsDisabled }: MessageProps,
) {
  const user = role === 'user';
  const display = user ? splitAgentDocumentMessage(content) : { prompt: content, documents: [] };
  const text = display.prompt.replace(/\[IMAGE \d+ ATTACHED\]/g, '').trim();
  const pattern = /\[([^\]]+)\]\(locate:\/\/([^)]+)\)/g,
    parts: ReactTypes.ReactNode[] = [];
  let offset = 0,
    match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > offset) parts.push(text.slice(offset, match.index));
    const id = match[2];
    parts.push(
      <button
        type="button"
        key={match.index}
        onClick={() => onLocateNode?.(id)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-[var(--af-info-bg)] text-[var(--af-info)] rounded hover:underline cursor-pointer transition-colors border border-[var(--af-info)]"
      >
        <span className="font-medium">{match[1]}</span>
      </button>,
    );
    offset = pattern.lastIndex;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[85%] min-w-0 rounded-lg px-4 py-3 ${user ? 'bg-[var(--af-info-bg)] text-[var(--af-info)] rounded-br-md' : 'bg-[var(--af-surface-raised)] text-[var(--af-text)] rounded-bl-md'}`}
      >
        {!!media?.length && (
          <div className={`mb-2 ${media.length > 1 ? 'grid grid-cols-2 gap-2' : ''}`}>
            {media.map((item, index) => (
              <div key={index} className="relative">
                {!item.url ? (
                  <span className="text-xs opacity-70">
                    {item.type === 'image' ? '图片附件' : '附件'}
                  </span>
                ) : item.type === 'image' ? (
                  <img
                    src={item.url}
                    alt={`附件 ${index + 1}`}
                    className="w-full max-h-32 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : item.type === 'audio' ? (
                  <audio src={item.url} controls preload="metadata" className="max-w-full" />
                ) : (
                  <video
                    src={item.url}
                    className="w-full max-h-32 rounded-lg object-cover"
                    controls
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {display.documents.map(document => <AgentDocumentCard key={document.id} document={document} />)}
        <div className="text-sm leading-relaxed select-text cursor-text whitespace-pre-wrap break-words">
          {user ? parts : <AgentMarkdown content={text} onLocateNode={onLocateNode} />}
        </div>
        {stopped && (
          <div className="text-xs text-[var(--af-text-muted)] mt-2">已停止回答 · 此段未完成</div>
        )}
        {timestamp && Number.isFinite(timestamp.getTime()) && (
          <div
            className={`text-[10px] mt-1 ${user ? 'text-[var(--af-info)]' : 'text-[var(--af-text-muted)]'}`}
          >
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {!user && content.trim() && onCreateTextNode && <AgentMessageExport content={content} create={onCreateTextNode} disabled={actionsDisabled} />}
      </div>
    </div>
  );
}
export function CanvasAgentLauncher(
  React: Runtime,
  { onClick, isOpen }: { onClick(): void; isOpen: boolean },
) {
  return isOpen ? null : (
    <button
      type="button"
      aria-label="打开 AIFISHER Agent"
      title="AIFISHER Agent"
      onClick={onClick}
      data-fisherai-agent-launcher="true"
      className="fixed bottom-6 right-6 rounded-full flex items-center justify-center z-50 transition-all hover:scale-105"
      style={{
        width: '48px',
        height: '48px',
        background: 'var(--af-surface)',
        border: '1px solid var(--af-border)',
        boxShadow: 'var(--af-shadow)',
      }}
    >
      <img src="/aifisher-mark-white.svg" alt="" className="w-6 h-7 object-contain select-none" />
    </button>
  );
}
