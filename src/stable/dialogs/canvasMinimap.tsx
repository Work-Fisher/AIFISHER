import type * as ReactTypes from 'react';
import type { CanvasViewport } from '../canvas/canvasNavigation';
import {
  minimapScene,
  minimapViewport,
  type MinimapNode,
  type NodeMeasurement,
} from './minimapGeometry';
type Runtime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'useState'
  | 'useRef'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useMemo'
  | 'useCallback'
>;
interface Props {
  nodes: MinimapNode[];
  viewport: CanvasViewport;
  onViewportChange(viewport: CanvasViewport): void;
  width?: number;
  height?: number;
  canvasRef?: ReactTypes.RefObject<HTMLElement | null>;
  documentEpoch?: number;
}

export function CanvasMinimap(React: Runtime, props: Props, measure: NodeMeasurement) {
  const { nodes, viewport, width = 250, height = 150, canvasRef, documentEpoch } = props;
  const rootRef = React.useRef<HTMLDivElement>(null),
    dragRef = React.useRef<number | null>(null),
    currentRef = React.useRef(props);
  const [dragging, setDragging] = React.useState(false),
    [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    currentRef.current = props;
  });
  React.useLayoutEffect(() => {
    const canvas = canvasRef?.current ?? document.getElementById('canvas-background');
    const update = () => {
      const rect = canvas?.getBoundingClientRect();
      const next = {
        width: rect?.width || window.innerWidth,
        height: rect?.height || window.innerHeight,
      };
      setCanvasSize((old) => (old.width === next.width && old.height === next.height ? old : next));
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (canvas) observer?.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [canvasRef, documentEpoch]);
  const { width: measureWidth, height: measureHeight } = measure;
  const scene = React.useMemo(
    () => minimapScene(nodes, { width, height }, { width: measureWidth, height: measureHeight }),
    [nodes, width, height, measureWidth, measureHeight],
  );
  const frame = minimapViewport(scene, viewport, canvasSize);
  const release = React.useCallback(() => {
    const id = dragRef.current;
    dragRef.current = null;
    if (id !== null && rootRef.current?.hasPointerCapture?.(id))
      rootRef.current.releasePointerCapture(id);
    setDragging(false);
  }, []);
  React.useEffect(() => {
    const root = rootRef.current;
    dragRef.current = null;
    setDragging(false);
    const stop = () => release();
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('blur', stop);
      const id = dragRef.current;
      dragRef.current = null;
      if (id !== null && root?.hasPointerCapture?.(id)) root.releasePointerCapture(id);
    };
  }, [documentEpoch, release]);
  const pan = (event: ReactTypes.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height || !scene.scale) return;
    const localX = ((event.clientX - rect.left) * width) / rect.width,
      localY = ((event.clientY - rect.top) * height) / rect.height;
    const worldX = (localX - scene.offsetX) / scene.scale + scene.minX,
      worldY = (localY - scene.offsetY) / scene.scale + scene.minY;
    const current = currentRef.current;
    if (current.documentEpoch !== documentEpoch) return;
    current.onViewportChange({
      ...current.viewport,
      x: canvasSize.width / 2 - worldX * current.viewport.zoom,
      y: canvasSize.height / 2 - worldY * current.viewport.zoom,
    });
  };
  if (!scene.frames.length) return null;
  return (
    <div
      ref={rootRef}
      data-fisherai-minimap="true"
      aria-label="画布小地图"
      className={`fixed bottom-[80px] left-6 rounded-lg overflow-hidden z-50 shadow-2xl group ${dragging ? 'cursor-grabbing' : 'cursor-grab'} bg-[var(--af-input)]`}
      style={{ width, height, touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
        pan(event);
      }}
      onPointerMove={(event) => {
        if (dragRef.current === event.pointerId) pan(event);
      }}
      onPointerUp={(event) => {
        if (dragRef.current === event.pointerId) {
          pan(event);
          release();
        }
      }}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        dragRef.current = null;
        setDragging(false);
      }}
    >
      <svg width="100%" height="100%" className="opacity-60">
        {scene.frames.map((node) => (
          <rect
            key={node.id}
            x={(node.x - scene.minX) * scene.scale + scene.offsetX}
            y={(node.y - scene.minY) * scene.scale + scene.offsetY}
            width={node.width * scene.scale}
            height={node.height * scene.scale}
            rx={2}
            fill={node.type === 'Video' ? '#a855f7' : '#3b82f6'}
          />
        ))}
      </svg>
      <div
        data-fisherai-minimap-viewport="true"
        className="absolute border-2 border-[var(--af-focus)] pointer-events-none"
        style={{
          ...frame,
          background: 'color-mix(in srgb, var(--af-focus) 10%, transparent)',
          boxShadow: '0 0 10px rgba(59,130,246,.5)',
        }}
      />
    </div>
  );
}
