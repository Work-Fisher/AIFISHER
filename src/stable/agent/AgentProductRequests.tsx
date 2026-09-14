import { useSyncExternalStore } from 'react';
import type { CanvasProductControl } from './canvasProductControl';
export function AgentProductRequests({
  controller,
  sessionId,
}: {
  controller: CanvasProductControl;
  sessionId: string;
}) {
  const items = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <div className="space-y-2 text-xs text-[var(--af-text-secondary)]" aria-live="polite">
      {items
        .filter((item) => item.sessionId === sessionId || item.sessionId.startsWith('external-'))
        .map((item) => (
          <section
            key={item.id}
            className="rounded-lg border border-[var(--af-border-control)] p-3"
          >
            <p>{item.label}</p>
            {item.state === 'pending' ? (
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="rounded bg-[var(--af-primary)] px-3 py-1.5 text-[var(--af-on-primary)]"
                  onClick={() => void controller.approve(item.id)}
                >
                  打开原操作流程
                </button>
                <button type="button" onClick={() => controller.cancel(item.id)}>
                  取消
                </button>
              </div>
            ) : (
              <p>
                {item.state === 'opened'
                  ? '已进入原操作流程，请核对选择或节点结果。'
                  : item.state === 'cancelled'
                    ? '已取消'
                    : '操作未确认，画布可能已变化，请核对。'}
              </p>
            )}
          </section>
        ))}
    </div>
  );
}
