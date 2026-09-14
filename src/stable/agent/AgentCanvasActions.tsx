import { useState } from 'react';
import type { CanvasActionLog } from './codexClient';
import type { CanvasActionHandler } from '../../shared/canvasControlProtocol.js';

export function AgentCanvasActions({
  actions,
  projectId,
  sessionId,
  execute,
  disabled,
}: {
  actions: CanvasActionLog[];
  projectId: string;
  sessionId: string;
  execute?: CanvasActionHandler;
  disabled: boolean;
}) {
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const handleUndo = async (operationId: string, expiresAt: number) => {
    if (!execute || busy || disabled) return;
    setBusy(operationId);
    try {
      const context = { projectId, sessionId, expiresAt };
      const snapshot = await execute({
        ...context,
        requestId: crypto.randomUUID(),
        command: { action: 'read' },
      });
      if (!snapshot.ok) {
        setFeedback((current) => ({ ...current, [operationId]: '当前画布不可用' }));
        return;
      }
      const result = await execute({
        ...context,
        requestId: crypto.randomUUID(),
        command: { action: 'undo', revision: snapshot.revision, operationId },
      });
      setFeedback((current) => ({
        ...current,
        [operationId]: result.ok
          ? '已撤销'
          : result.code === 'CONFLICT'
            ? '画布已有后续修改，请使用画布撤销逐步恢复'
            : '该回执已失效，请核对画布历史',
      }));
    } catch {
      setFeedback((current) => ({ ...current, [operationId]: '未能确认撤销结果，请核对画布' }));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <details className="mt-2 text-xs text-[var(--af-text-secondary)]" open={actions.length <= 3}>
      <summary className="cursor-pointer">画布操作 · {actions.length}</summary>
      <div className="mt-1 space-y-1" aria-live="polite">
        {actions.map((action, index) => (
          <div key={action.operationId || index} className="flex flex-wrap items-center gap-2">
            <span>
              {action.ok
                ? ['awaiting-user', 'awaiting-approval'].includes(action.state || '')
                  ? '已准备，请在下方确认'
                  : action.state === 'running'
                    ? '批次已开始，请核对节点结果'
                    : action.state === 'ready-to-open'
                      ? '回答结束后保存并切换项目'
                      : action.state === 'accepted'
                        ? '已收到操作回执，请核对任务状态'
                        : action.action === 'undo'
                          ? '已撤销画布修改'
                          : `已完成 ${action.operationCount || 1} 项画布操作`
                : action.code === 'CONFLICT'
                  ? '画布已变化，本次操作未执行'
                  : action.code === 'UNCONFIRMED'
                    ? '操作结果未确认，请核对画布'
                    : '本次画布操作未执行'}
            </span>
            {action.ok && action.action !== 'undo' && action.operationId && execute ? (
              <button
                type="button"
                className="text-[var(--af-text-secondary)] underline underline-offset-2 disabled:opacity-40"
                disabled={disabled || !!busy || feedback[action.operationId] === '已撤销'}
                onClick={() => void handleUndo(action.operationId!, Date.now() + 10000)}
              >
                撤销这次操作
              </button>
            ) : null}
            {action.operationId && feedback[action.operationId] ? (
              <span>{feedback[action.operationId]}</span>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
