import { useSyncExternalStore } from 'react';
import type { CanvasCreationControl } from './canvasCreationControl';

const states = {
  pending: '等待确认',
  submitted: '已开始提交，正在等待结果',
  success: '已完成',
  failed: '生成失败，已停止后续节点',
  unconfirmed: '请在节点核对原任务，勿重复生成',
  stopped: '未提交，授权失效、配置变化或检查未通过',
};
export function AgentGenerationBatches({
  controller,
  sessionId,
}: {
  controller: CanvasCreationControl;
  sessionId: string;
}) {
  const batches = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <div className="space-y-2" aria-live="polite">
      {controller.getError() && (
        <p className="text-xs text-[var(--af-warning)]">{controller.getError()}</p>
      )}
      {batches
        .filter((batch) => batch.sessionId === sessionId || batch.sessionId.startsWith('external-'))
        .map((batch) => (
          <section
            key={batch.id}
            className="rounded-lg border border-[var(--af-border-control)] bg-[var(--af-surface)] p-3 text-xs text-[var(--af-text-secondary)]"
          >
            <div className="mb-2 font-medium text-[var(--af-text)]">
              生成批次 · {batch.items.length} 个节点
            </div>
            <p className="mb-2">
              {batch.authorizationId
                ? '本批使用已批准的连续生成授权，提交受其模型、参数、数量、期限和费用条件约束。'
                : '确认按以下配置提交，费用以服务商账单为准，不设费用封顶。本次确认 10 分钟内有效。'}
              撤销不能退回生成费用。
            </p>
            {batch.items.map((item) => (
              <details key={item.nodeId} className="mb-2">
                <summary className="cursor-pointer">
                  {item.title} · {item.model} · 数量 {item.count} · {states[item.state]}
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[var(--af-text-secondary)]">
                  {item.parameters}
                </pre>
                <p className="mt-1">引用：{item.references.join('、') || '无'}</p>
              </details>
            ))}
            {batch.state === 'pending' ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="rounded bg-[var(--af-primary)] px-3 py-1.5 text-[var(--af-on-primary)]"
                  onClick={() => void controller.approve(batch.id)}
                >
                  确认本批生成与费用
                </button>
                <button
                  type="button"
                  className="text-[var(--af-text-secondary)]"
                  onClick={() => controller.cancel(batch.id)}
                >
                  取消
                </button>
              </div>
            ) : (
              <p>
                {batch.state === 'running'
                  ? '正在执行本批；失败或配置变化会停止剩余任务。'
                  : batch.state === 'cancelled'
                    ? '已停止后续提交；已提交任务请核对节点状态。'
                    : '本批已结束。结果及中断恢复请在对应画布节点查看。'}
              </p>
            )}
            {batch.state === 'running' && (
              <button
                type="button"
                className="mt-2 text-[var(--af-text-secondary)]"
                onClick={() => void controller.cancel(batch.id)}
              >
                停止后续任务
              </button>
            )}
            {batch.recovered && (
              <p className="mt-2 text-[var(--af-text-secondary)]">
                这是恢复的批次记录，原授权不会重新执行。未确认结果请查询对应节点的原任务。
              </p>
            )}
          </section>
        ))}
    </div>
  );
}
