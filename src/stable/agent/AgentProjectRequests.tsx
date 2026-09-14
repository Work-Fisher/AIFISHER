import { useSyncExternalStore } from 'react';
import type { CanvasProjectControl } from './canvasProjectControl';

export function AgentProjectRequests({
  controller,
  sessionId,
}: {
  controller: CanvasProjectControl;
  sessionId: string;
}) {
  const items = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <div className="space-y-2" aria-live="polite">
      {items
        .filter((item) => item.sessionId === sessionId || item.sessionId.startsWith('external-'))
        .map((item) => (
          <section
            key={item.id}
            className="rounded-lg border border-[var(--af-border-control)] bg-[var(--af-surface)] p-3 text-xs text-[var(--af-text-secondary)]"
          >
            <p>{item.label}</p>
            {item.kind === 'delete' && (
              <p className="my-2">删除后项目将从列表移除。请确认目标项目。</p>
            )}
            {item.state === 'pending' ? (
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="rounded bg-[var(--af-primary)] px-3 py-1.5 text-[var(--af-on-primary)]"
                  onClick={() => void controller.approve(item.id)}
                >
                  {item.kind === 'import'
                    ? '选择项目文件'
                    : item.kind === 'export'
                      ? '下载项目备份'
                      : '确认删除'}
                </button>
                <button type="button" onClick={() => controller.cancel(item.id)}>
                  取消
                </button>
              </div>
            ) : (
              <p className="mt-2">
                {item.state === 'running'
                  ? '正在处理…'
                  : item.state === 'cancelled'
                    ? '已取消'
                    : item.state === 'unconfirmed'
                      ? '结果未确认，请核对项目列表；不会自动重复操作。'
                      : item.kind === 'import'
                        ? '已打开文件选择，请完成选择并核对导入结果。'
                        : item.kind === 'export'
                          ? '已发起下载，请核对保存的文件。'
                          : '已删除'}
              </p>
            )}
          </section>
        ))}
    </div>
  );
}
