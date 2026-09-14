import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';
import { compareGeometry, comparePosition } from './compareGeometry';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useRef' | 'useState' | 'useEffect' | 'useCallback'
>;
interface Payload {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
  title?: string;
}
interface Props {
  payload: Payload | null;
  onClose(): void;
}
interface View {
  x: number;
  y: number;
  scale: number;
}
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const button =
  'px-3 py-1.5 text-[11px] font-bold text-[var(--af-text-secondary)] bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] rounded-full transition-colors';
const numberInput =
  'w-[54px] h-7 px-1.5 rounded-md bg-[var(--af-input)] border border-[var(--af-border-control)] text-[10px] text-[var(--af-text)] outline-none focus:border-[var(--af-info)] text-center tabular-nums';

/** Original diagonal A/B comparison, with one image load and a contained interaction lifetime. */
export function CanvasComparePreview(React: Runtime, { payload, onClose }: Props) {
  const root = React.useRef<HTMLDivElement>(null),
    viewport = React.useRef<HTMLDivElement>(null),
    surface = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = React.useState(50),
    [angle, setAngle] = React.useState(0),
    [swapped, setSwapped] = React.useState(false);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [view, setView] = React.useState<View>({ x: 0, y: 0, scale: 1 });
  const current = React.useRef(view),
    space = React.useRef(false);
  const drag = React.useRef<{
    id: number;
    mode: 'pan' | 'divider';
    x: number;
    y: number;
    origin: View;
  } | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const update = React.useCallback((next: View) => {
    current.current = next;
    setView(next);
  }, []);
  const zoom = React.useCallback(
    (factor: number, x?: number, y?: number) => {
      const element = viewport.current;
      if (!element) return;
      const before = current.current,
        scale = clamp(before.scale * factor, 0.05, 20);
      const anchorX = x ?? element.clientWidth / 2,
        anchorY = y ?? element.clientHeight / 2;
      update({
        scale,
        x: anchorX - ((anchorX - before.x) / before.scale) * scale,
        y: anchorY - ((anchorY - before.y) / before.scale) * scale,
      });
    },
    [update],
  );
  React.useEffect(() => {
    if (!payload || !root.current || !viewport.current) return;
    setPosition(50);
    setAngle(0);
    setSwapped(false);
    space.current = false;
    drag.current = null;
    const release = activateModal(root.current, () => close.current());
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      zoom(
        event.deltaY > 0 ? 1 / 1.15 : 1.15,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    const blur = () => {
      space.current = false;
      drag.current = null;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', blur);
    return () => {
      release();
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
      blur();
    };
  }, [payload, zoom]);
  const leftUrl = payload ? (swapped ? payload.rightUrl : payload.leftUrl) : null;
  React.useEffect(() => {
    const element = viewport.current;
    if (!leftUrl || !element) return;
    let active = true;
    setSize({ width: 0, height: 0 });
    setLoadError(false);
    const image = new Image();
    const fit = () => {
      if (!active || !(image.naturalWidth || image.width) || !(image.naturalHeight || image.height))
        return;
      const width = image.naturalWidth || image.width,
        height = image.naturalHeight || image.height;
      const ratio = Math.min(
        Math.max(element.clientWidth - 80, 100) / width,
        Math.max(element.clientHeight - 200, 100) / height,
      );
      const fitted = { width: width * ratio, height: height * ratio };
      setSize(fitted);
      update({
        x: (element.clientWidth - fitted.width) / 2,
        y: (element.clientHeight - fitted.height) / 2,
        scale: 1,
      });
    };
    image.onload = fit;
    image.onerror = () => {
      if (active) setLoadError(true);
    };
    image.src = leftUrl;
    window.addEventListener('resize', fit);
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
      window.removeEventListener('resize', fit);
    };
  }, [leftUrl, update]);
  if (!payload) return null;
  const geometry = compareGeometry(size.width, size.height, angle, position);
  const moveDivider = (x: number, y: number) => {
    const bounds = surface.current?.getBoundingClientRect();
    if (bounds && bounds.width > 0 && bounds.height > 0)
      setPosition(
        comparePosition(
          size.width,
          size.height,
          angle,
          ((x - bounds.left) / bounds.width) * size.width,
          ((y - bounds.top) / bounds.height) * size.height,
        ),
      );
  };
  const releasePointer = (event: ReactTypes.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resetView = () => {
    const element = viewport.current;
    if (element)
      update({
        x: (element.clientWidth - size.width) / 2,
        y: (element.clientHeight - size.height) / 2,
        scale: 1,
      });
  };
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={payload.title || '图片对比'}
      tabIndex={-1}
      className="fixed inset-0 z-[110] bg-[var(--af-overlay)] backdrop-blur-sm flex items-center justify-center"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.code === 'Space' &&
          !(
            event.target instanceof Element &&
            event.target.closest('input,textarea,select,button,[contenteditable="true"]')
          )
        ) {
          event.preventDefault();
          space.current = true;
        }
      }}
      onKeyUp={(event) => {
        event.stopPropagation();
        if (event.code === 'Space') space.current = false;
      }}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-2 w-max max-w-[calc(100%-88px)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          className="flex min-h-11 items-center gap-1 px-2 py-1.5 rounded-full bg-[var(--af-surface-raised)] backdrop-blur shadow-lg border border-[var(--af-border)]"
          style={{ flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <button
            className="px-3 py-1.5 text-[11px] font-bold text-[var(--af-info)] bg-[var(--af-info-bg)] border border-[var(--af-info)] hover:bg-[var(--af-info-bg)] rounded-full transition-colors"
            onClick={() => setSwapped((value) => !value)}
          >
            交换 A / B
          </button>
          <span className="text-[10px] font-bold text-[var(--af-text-muted)] whitespace-nowrap">
            位置
          </span>
          <input
            aria-label="对比线位置"
            type="range"
            min={0}
            max={100}
            step={1}
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
            className="w-24 accent-blue-500 cursor-pointer"
          />
          <input
            aria-label="对比线位置数值"
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(position)}
            onChange={(event) => setPosition(clamp(Number(event.target.value), 0, 100))}
            className={numberInput}
          />
          <span className="text-[10px] font-bold text-[var(--af-text-muted)] whitespace-nowrap">
            角度
          </span>
          <input
            aria-label="对比线角度"
            type="range"
            min={0}
            max={90}
            step={1}
            value={angle}
            onChange={(event) => setAngle(Number(event.target.value))}
            className="w-24 accent-blue-500 cursor-pointer"
          />
          <input
            aria-label="对比线角度数值"
            type="number"
            min={0}
            max={90}
            step={1}
            value={angle}
            onChange={(event) => setAngle(clamp(Number(event.target.value), 0, 90))}
            className={numberInput}
          />
          <button
            className={button}
            onClick={() => {
              setPosition(50);
              setAngle(0);
            }}
          >
            复位
          </button>
        </div>
      </div>
      <button
        onClick={onClose}
        title="取消"
        aria-label="取消"
        className="absolute top-4 right-6 flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-full text-[var(--af-text)] transition-colors z-[120]"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <div
        ref={viewport}
        data-fisherai-compare-viewport="true"
        className="relative w-full h-full overflow-hidden select-none"
        onPointerDown={(event) => {
          if (![0, 1].includes(event.button)) return;
          event.preventDefault();
          root.current?.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const mode = event.button === 1 || space.current ? 'pan' : 'divider';
          drag.current = {
            id: event.pointerId,
            mode,
            x: event.clientX,
            y: event.clientY,
            origin: current.current,
          };
          if (mode === 'divider') moveDivider(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.id !== event.pointerId) return;
          if (active.mode === 'divider') moveDivider(event.clientX, event.clientY);
          else
            update({
              ...active.origin,
              x: active.origin.x + event.clientX - active.x,
              y: active.origin.y + event.clientY - active.y,
            });
        }}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onLostPointerCapture={(event) => {
          if (drag.current?.id === event.pointerId) drag.current = null;
        }}
      >
        <div
          data-fisherai-compare-help="true"
          style={{
            position: 'absolute',
            bottom: 96,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            padding: '8px 16px',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 9999,
            background: 'rgba(0,0,0,.72)',
            color: 'rgba(255,255,255,.78)',
            fontSize: 11,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            backdropFilter: 'blur(10px)',
          }}
        >
          滚轮缩放 · 中键拖动画面 · 空格＋左键拖动画面 · 左键移动对比线
        </div>
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[var(--af-surface)] backdrop-blur-md rounded-full px-4 py-2.5 z-50 border border-[var(--af-border)] shadow-2xl"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button className={button} title="缩小" aria-label="缩小" onClick={() => zoom(1 / 1.15)}>
            −
          </button>
          <span className="text-[var(--af-text)] text-[13px] font-bold min-w-[54px] text-center font-mono">
            {Math.round(view.scale * 100)}%
          </span>
          <button className={button} title="放大" aria-label="放大" onClick={() => zoom(1.15)}>
            +
          </button>
          <button className={button} onClick={resetView}>
            重置
          </button>
        </div>
        {loadError && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center text-[var(--af-text)] pointer-events-none"
          >
            图片读取失败，请关闭后重试。
          </div>
        )}
        <div
          ref={surface}
          className="absolute overflow-hidden bg-[var(--af-input)] shadow-2xl"
          style={{
            width: size.width,
            height: size.height,
            left: 0,
            top: 0,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            transition: 'none',
          }}
        >
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={swapped ? payload.leftUrl : payload.rightUrl}
              alt="对比图 B"
              className="block w-full h-full pointer-events-none"
              draggable={false}
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: geometry.clipPath }}
            >
              <img
                src={leftUrl!}
                alt="对比图 A"
                className="block w-full h-full pointer-events-none"
                draggable={false}
              />
            </div>
          </div>
          <div
            className="absolute bg-[var(--af-media-text)] pointer-events-none z-10"
            style={{
              left: geometry.lineStart.x,
              top: geometry.lineStart.y,
              width: geometry.lineLength,
              height: 1,
              boxShadow: '0 0 0 1px var(--af-media-bg)',
              transform: `translateY(-0.5px) rotate(${geometry.lineAngle}deg)`,
              transformOrigin: '0 50%',
            }}
          />
        </div>
      </div>
    </div>
  );
}
