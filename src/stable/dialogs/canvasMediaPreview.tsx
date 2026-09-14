import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useRef' | 'useEffect' | 'useCallback'
>;
interface Props {
  mediaUrl: string | null;
  onClose(): void;
}
interface Transform {
  x: number;
  y: number;
  scale: number;
}
const initial = (): Transform => ({ x: 0, y: 0, scale: 1 });
const clamp = (value: number) => Math.min(5, Math.max(0.25, value));
function isVideoPreview(url: string) {
  const pathname = url.split(/[?#]/)[0].toLowerCase();
  return /\.(mp4|webm|mov|m4v|mkv)$/.test(pathname) || /\/videos\//.test(pathname);
}
export function CanvasMediaPreview(React: Runtime, { mediaUrl, onClose }: Props) {
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const [transform, setTransform] = React.useState(initial);
  const current = React.useRef(transform),
    container = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerId: number; x: number; y: number; origin: Transform } | null>(
    null,
  );
  const [dragging, setDragging] = React.useState(false);
  const update = React.useCallback((next: Transform) => {
    current.current = next;
    setTransform(next);
  }, []);
  const reset = () => update(initial());
  React.useEffect(() => {
    update(initial());
    drag.current = null;
    setDragging(false);
    const root = container.current;
    if (!mediaUrl || !root) return;
    const releaseFocus = activateModal(root, () => closeRef.current());
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const before = current.current,
        scale = clamp(before.scale + (event.deltaY > 0 ? -0.15 : 0.15));
      const bounds = root.getBoundingClientRect();
      const x = event.clientX - bounds.left - bounds.width / 2,
        y = event.clientY - bounds.top - bounds.height / 2;
      update({
        scale,
        x: x - ((x - before.x) / before.scale) * scale,
        y: y - ((y - before.y) / before.scale) * scale,
      });
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => {
      releaseFocus();
      root.removeEventListener('wheel', wheel);
      drag.current = null;
    };
  }, [mediaUrl, update]);
  if (!mediaUrl) return null;
  const zoom = (delta: number) =>
    update({ ...current.current, scale: clamp(current.current.scale + delta) });
  const release = (event: ReactTypes.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
      tabIndex={-1}
      className="fixed inset-0 bg-[var(--af-overlay)] backdrop-blur-sm flex items-center justify-center z-[100]"
      onPointerDown={(event) => event.stopPropagation()}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
        else if (event.key === '0') reset();
        else if (event.key === '+' || event.key === '=') zoom(0.15);
        else if (event.key === '-') zoom(-0.15);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !dragging) onClose();
      }}
      style={{ cursor: dragging ? 'grabbing' : 'grab', outline: 'none' }}
    >
      <button
        onClick={onClose}
        title="取消"
        aria-label="取消"
        className="absolute top-4 right-6 flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-full text-[var(--af-text)] transition-colors z-[110]"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[var(--af-surface)] backdrop-blur-sm rounded-full px-4 py-2 z-10">
        <button
          className="p-1 text-[var(--af-text)] hover:text-[var(--af-text)] transition-colors"
          aria-label="缩小"
          onClick={() => zoom(-0.15)}
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="text-[var(--af-text)] text-sm font-medium min-w-[50px] text-center">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          className="p-1 text-[var(--af-text)] hover:text-[var(--af-text)] transition-colors"
          aria-label="放大"
          onClick={() => zoom(0.15)}
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div className="flex items-center ml-1 pl-3 border-l border-[var(--af-border)]">
          <button
            className="px-2.5 py-1 text-[11px] font-bold text-[var(--af-text)] hover:text-[var(--af-text)] bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-md transition-all active:scale-95"
            onClick={reset}
          >
            重置
          </button>
        </div>
      </div>
      <div
        className="max-w-[90vw] max-h-[90vh] select-none"
        data-fisherai-media-preview-transform="true"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          transition: dragging ? 'none' : 'transform 0.1s ease-out',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (
            ![0, 1].includes(event.button) ||
            (event.target instanceof Element && event.target.closest('button,input')) ||
            (event.button === 0 && event.target instanceof Element && event.target.closest('video'))
          )
            return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            origin: current.current,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active && active.pointerId === event.pointerId)
            update({
              ...active.origin,
              x: active.origin.x + event.clientX - active.x,
              y: active.origin.y + event.clientY - active.y,
            });
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        {isVideoPreview(mediaUrl) ? (
          <video
            src={mediaUrl}
            title="按住鼠标中键拖动画面，左键操作播放控件"
            controls
            autoPlay
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            draggable={false}
          />
        ) : (
          <img
            src={mediaUrl}
            alt="Fullscreen preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
