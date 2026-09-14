import { useState } from 'react';
import type { PromptProposal } from './codexClient';

export function AgentPromptProposals({
  edits,
  disabled,
  onLocateNode,
  onApplyPrompt,
}: {
  edits: PromptProposal[];
  disabled: boolean;
  onLocateNode?(id: string): void;
  onApplyPrompt?(proposal: PromptProposal): string | null;
}) {
  const [applied, setApplied] = useState<string[]>([]);
  const [error, setError] = useState('');
  return (
    <div className="space-y-3 mb-4">
      {edits.map((edit) => (
        <div
          key={edit.id}
          className="border border-[var(--af-border-control)] rounded-xl p-3 space-y-2 text-sm text-[var(--af-text)]"
        >
          <button className="text-[var(--af-info)]" onClick={() => onLocateNode?.(edit.nodeId)}>
            {edit.title || edit.nodeId}
          </button>
          <details>
            <summary className="text-xs text-[var(--af-text-secondary)] cursor-pointer">
              查看原提示词
            </summary>
            <p className="whitespace-pre-wrap max-h-32 overflow-auto">{edit.before || '空'}</p>
          </details>
          <p className="whitespace-pre-wrap max-h-48 overflow-auto">{edit.after}</p>
          <button
            className="px-2 py-1 rounded-md border border-[var(--af-border-control)] hover:bg-[var(--af-hover)] disabled:opacity-40 text-xs"
            disabled={disabled || applied.includes(edit.id) || !onApplyPrompt}
            onClick={() => {
              const failure = onApplyPrompt?.(edit);
              if (failure) setError(failure);
              else {
                setApplied((current) => [...current, edit.id]);
                setError('');
              }
            }}
          >
            {applied.includes(edit.id) ? '已应用，可在画布撤销' : '应用提示词'}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-[var(--af-warning)]">
          {error}
        </p>
      )}
    </div>
  );
}
