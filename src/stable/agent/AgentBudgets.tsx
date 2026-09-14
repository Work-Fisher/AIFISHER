import { useSyncExternalStore } from 'react';
import type { CanvasBudgetControl } from './canvasBudgetControl';
const labels: Record<string, string> = {
  aspectRatio: '比例',
  resolution: '分辨率',
  duration: '时长',
  generateCount: '单次数量',
  imageMode: '图片模式',
  videoMode: '视频模式',
  audioMode: '音频模式',
  languageMode: '文本模式',
  detail: '细节',
  quality: '质量',
  web_search: '联网搜索',
  imageBase64: '图片输入数',
  images: '图片输入数',
  videos: '视频输入数',
  audios: '音频输入数',
  videoUrl: '视频输入数',
};
export function AgentBudgets({
  controller,
  sessionId,
}: {
  controller: CanvasBudgetControl;
  sessionId: string;
}) {
  const grants = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <div className="space-y-2 text-xs text-[var(--af-text-secondary)]" aria-live="polite">
      {controller.getError() && <p className="text-[var(--af-warning)]">{controller.getError()}</p>}
      {grants
        .filter(
          (grant) =>
            grant.sessionId === sessionId ||
            grant.sessionId.startsWith('external-') ||
            grant.state === 'approved',
        )
        .map((grant) => (
          <section
            key={grant.id}
            className="rounded-lg border border-[var(--af-border-control)] bg-[var(--af-surface)] p-3"
          >
            <p className="font-medium text-[var(--af-text)]">
              连续生成授权 ·{' '}
              {grant.state === 'pending'
                ? '等待确认'
                : grant.state === 'approved'
                  ? '已授权'
                  : '已撤销'}
            </p>
            <p className="my-2">
              限当前项目、以下模型和参数，允许更换提示词和对应数量的素材。最多 {grant.maxRequests}{' '}
              次请求、{grant.maxOutputs} 个结果；有效至 {new Date(grant.expiresAt).toLocaleString()}
              。
            </p>
            <p>
              {grant.budgetMicros === null
                ? '按请求次数和结果数量限制，不承诺费用封顶，费用按服务商账单结算。'
                : `费用上限 ¥${grant.budgetMicros / 1000000}。仅在服务端能确认费用上界时提交，否则停止；目录估价不能代替此证据。`}
            </p>
            {grant.profiles.map((profile, index) => {
              const value = JSON.parse(profile) as Record<string, unknown>;
              return (
                <details key={index} className="my-2">
                  <summary>
                    {String(
                      value.imageModel || value.videoModel || value.audioModel || value.textModel,
                    )}
                  </summary>
                  {Object.entries(value)
                    .filter(
                      ([key]) =>
                        !['imageModel', 'videoModel', 'audioModel', 'textModel'].includes(key),
                    )
                    .map(([key, item]) => (
                      <p key={key}>
                        {labels[key] || key}：
                        {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                      </p>
                    ))}
                </details>
              );
            })}
            <p className="my-2">
              已占用 {grant.usedRequests} 次请求、{grant.usedOutputs}{' '}
              个结果。提交结果不明时继续占用额度，避免重复扣费。
            </p>
            <div className="flex gap-3">
              {grant.state === 'pending' && (
                <button
                  type="button"
                  className="rounded bg-[var(--af-primary)] px-3 py-1.5 text-[var(--af-on-primary)]"
                  onClick={() => void controller.approve(grant.id)}
                >
                  确认授权与费用
                </button>
              )}
              {grant.state !== 'revoked' && (
                <button type="button" onClick={() => void controller.revoke(grant.id)}>
                  {grant.state === 'pending' ? '取消' : '撤销后续授权'}
                </button>
              )}
            </div>
          </section>
        ))}
    </div>
  );
}
