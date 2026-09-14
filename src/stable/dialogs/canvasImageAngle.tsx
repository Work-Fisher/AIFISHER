import { ImageToolGenerateButton } from './imageToolGenerateButton';
import * as React from 'react';
import { Box, RotateCcw, X } from 'lucide-react';
import { activateModal } from '../design/modalFocus';
import { activateSidePanel } from '../prompt/nodeSidePanel';
import {
  angleDirections,
  defaultImageAngle,
  imageAngleDescription,
  normalizeImageAngle,
  type ImageAngle,
} from '../prompt/imageAngle';
import './imageAngle.css';
interface Props {
  node: { id: string; resultUrl?: string; imageAngle?: unknown; aspectRatio?: string };
  onClose(): void;
  onApply(id: string, angle: ImageAngle): void;
  editing?: boolean;
}
export function CanvasImageAngle({ node, onClose, onApply, editing = false }: Props) {
  const root = React.useRef<HTMLDivElement>(null);
  const [angle, setAngle] = React.useState(() => normalizeImageAngle(node.imageAngle));
  const [error, setError] = React.useState('');
  const drag = React.useRef<{ id: number; x: number; y: number; angle: ImageAngle } | null>(null);
  React.useEffect(
    () => (root.current ? (editing ? activateModal(root.current, onClose) : activateSidePanel(root.current, onClose)) : undefined),
    [onClose, editing],
  );
  React.useLayoutEffect(() => {
    if (editing || !root.current) return;
    const panel = root.current;
    const anchor = [...document.querySelectorAll<HTMLElement>('[data-node-id]')].find(element => element.dataset.nodeId === node.id);
    if (!anchor) return;
    let frame = 0;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(720, window.innerWidth - 24);
      panel.style.left = `${Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))}px`;
      panel.style.top = `${rect.bottom + 12}px`;
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 24)}px`;
      frame = requestAnimationFrame(position);
    };
    position();
    return () => cancelAnimationFrame(frame);
  }, [editing, node.id]);
  const patch = (value: Partial<ImageAngle>) =>
    setAngle((current) => normalizeImageAngle({ ...current, ...value }));
  const description = imageAngleDescription(angle);
  return (
    <div
      className={editing ? 'af-angle-backdrop' : 'af-angle-anchored'}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal={editing ? true : undefined}
        aria-label="调整图片角度"
        className="af-angle-panel"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header>
          <Box size={18} />
          <strong>角度</strong>
          <span>拖拽调整观察方向</span>
          <button aria-label="关闭角度" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="af-angle-body">
          <div
            className="af-angle-stage"
            aria-label="拖拽调整角度"
            role="group"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, angle };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId) return;
              setAngle(
                normalizeImageAngle({
                  ...start.angle,
                  azimuth: start.angle.azimuth - (event.clientX - start.x) * 0.7,
                  elevation: start.angle.elevation + (event.clientY - start.y) * 0.4,
                }),
              );
            }}
            onPointerUp={(event) => {
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onWheel={(event) => patch({ zoom: angle.zoom - Math.sign(event.deltaY) * 0.3 })}
          >
            <div
              className="af-angle-object"
              style={{
                transform: `scale(${0.65 + angle.zoom * 0.07}) rotateX(${-angle.elevation}deg) rotateY(${-angle.azimuth}deg)`,
              }}
            >
              <div className="af-angle-front">
                {node.resultUrl && (
                  <img draggable={false} src={node.resultUrl} alt="原图视角示意" />
                )}
              </div>
              <div className="af-angle-back">背面</div>
              <div className="af-angle-left">左</div>
              <div className="af-angle-right">右</div>
              <div className="af-angle-top">上</div>
              <div className="af-angle-bottom">下</div>
            </div>
            <span className="af-angle-caption">视角示意 · 实际结果由模型生成</span>
          </div>
          <div className="af-angle-controls">
            {(
              [
                ['azimuth', '水平角度', 0, 359, 1, '°'],
                ['elevation', '俯仰角度', -30, 60, 1, '°'],
                ['zoom', '取景远近', 0, 10, 0.1, ''],
              ] as const
            ).map(([key, label, min, max, step, unit]) => (
              <label key={key}>
                <span>{label}</span>
                <output>
                  {angle[key]}
                  {unit}
                </output>
                <input
                  aria-label={label}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={angle[key]}
                  onChange={(event) => patch({ [key]: Number(event.target.value) })}
                />
              </label>
            ))}
            <details className="af-angle-presets-menu">
              <summary>快捷视角</summary>
              <div className="af-angle-presets">
                {angleDirections.map((name, index) => (
                  <button
                    key={name}
                    aria-pressed={description.direction === name}
                    onClick={() => patch({ azimuth: index * 45 })}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </details>
            <p>
              {description.direction} · {description.elevation} · {description.distance}
            </p>
          </div>
        </div>
        <footer>
          <button onClick={() => setAngle({ ...defaultImageAngle })}>
            <RotateCcw size={14} />
            重置
          </button>
          <span role="status">
            {error ||
              (editing
                ? '保存角度设置后，点击生成查看结果。'
                : 'GPT2.5 低价版 · 自动连接原图，按账户实际用量计费。')}
          </span>
          <ImageToolGenerateButton
            editing={editing}
            aspectRatio={node.aspectRatio || '16:9'}
            label={editing ? '应用设置' : '生成新角度'}
            onClick={() => {
              try {
                onApply(node.id, angle);
                onClose();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '创建失败，请重试');
              }
            }}
          />
        </footer>
      </div>
    </div>
  );
}
