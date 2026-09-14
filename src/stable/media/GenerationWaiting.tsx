import './generationWaiting.css';

export function GenerationWaiting({ operation = '图片生成' }: { operation?: string }) {
  return <div data-fisherai-regeneration-overlay="true" className="af-generation-waiting" role="status" aria-live="polite">
    <span className="af-generation-waiting-ring" aria-hidden="true" />
    <strong>正在生成</strong>
    <span className="af-generation-waiting-operation">{operation}</span>
    <small>完成后自动显示结果</small>
  </div>;
}
