import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import { useComposerPricing } from '../nodes/mediaComposer';
import { imageToolModel } from '../media/imageAngleDraft';
export function ImageToolGenerateButton({
  label,
  onClick,
  editing = false,
  aspectRatio = '16:9',
}: {
  label: string;
  editing?: boolean;
  aspectRatio?: string;
  onClick(): void;
}) {
  const pricing = useComposerPricing(React);
  const clicked = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const estimate = pricing?.priceFor(
    imageToolModel.name,
    'image-to-image',
    '1K',
    aspectRatio,
    null,
    null,
  );
  return (
    <button
      className="primary"
      aria-label={label}
      disabled={pending}
      title={editing ? '保存角度参数' : '使用 GPT2.5 低价版，费用以实际账单为准'}
      onClick={() => {
        if (clicked.current) return;
        clicked.current = true;
        setPending(true);
        try {
          onClick();
        } finally {
          clicked.current = false;
          setPending(false);
        }
      }}
    >
      {!editing && typeof estimate === 'number' && Number.isFinite(estimate)
        ? `约 ¥${estimate.toFixed(2)} · `
        : ''}
      {label}
      <ArrowUp size={17} />
    </button>
  );
}
