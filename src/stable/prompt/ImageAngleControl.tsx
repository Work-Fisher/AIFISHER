import * as React from 'react';
import { createPortal } from 'react-dom';
import { Box, X } from 'lucide-react';
import { CanvasImageAngle } from '../dialogs/canvasImageAngle';
import { imageAngleDescription, type ImageAngle } from './imageAngle';
interface Props {
  node: { id: string; imageAngle?: unknown; resultUrl?: string };
  referenceUrl?: string;
  disabled?: boolean;
  onUpdate(id: string, patch: { imageAngle: ImageAngle | null }): void;
}
export function ImageAngleControl({ node, referenceUrl, disabled, onUpdate }: Props) {
  const [open, setOpen] = React.useState(false);
  if (!node.imageAngle) return null;
  const description = imageAngleDescription(node.imageAngle);
  return (
    <div className="flex items-center gap-1 text-xs text-[var(--af-text-secondary)] mt-2">
      <button
        type="button"
        disabled={disabled}
        className="flex items-center gap-1 rounded-md bg-[var(--af-surface-raised)] px-2 py-1"
        onClick={() => setOpen(true)}
      >
        <Box size={13} />
        {description.direction} · {description.elevation} · {description.distance}
      </button>
      <button
        type="button"
        aria-label="移除角度设置"
        disabled={disabled}
        onClick={() => onUpdate(node.id, { imageAngle: null })}
      >
        <X size={13} />
      </button>
      {open &&
        createPortal(
          <CanvasImageAngle
            editing
            node={{ ...node, resultUrl: referenceUrl || node.resultUrl }}
            onClose={() => setOpen(false)}
            onApply={(id, imageAngle) => {
              if (disabled) throw new Error('图片正在生成，请完成后再修改角度。');
              onUpdate(id, { imageAngle });
            }}
          />,
          document.body,
        )}
    </div>
  );
}
