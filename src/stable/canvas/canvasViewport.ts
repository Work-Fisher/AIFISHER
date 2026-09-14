import type * as React from 'react';
import {
  getWheelMode,
  panViewport,
  shouldKeepWheelInsideControl,
  STABLE_MAX_ZOOM,
  STABLE_MIN_ZOOM,
  zoomViewportAtPoint,
  type CanvasViewport,
  type StableWheelSample,
} from './canvasNavigation';

export { STABLE_MIN_ZOOM, STABLE_MAX_ZOOM };

interface ViewportNode {
  id: string;
  x: number;
  y: number;
  height?: number;
}
interface CanvasBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
type ReactHooks = Pick<typeof React, 'useState' | 'useRef' | 'useCallback' | 'useEffect'>;

function boundsOf(canvas: HTMLElement | null): CanvasBounds {
  const bounds = canvas?.getBoundingClientRect();
  return bounds && bounds.width > 0 && bounds.height > 0
    ? bounds
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export function sliderViewport(
  viewport: CanvasViewport,
  value: number,
  bounds: CanvasBounds,
): CanvasViewport {
  if (!Number.isFinite(value) || !(viewport.zoom > 0)) return viewport;
  const zoom = Math.min(STABLE_MAX_ZOOM, Math.max(STABLE_MIN_ZOOM, value));
  const x = bounds.width / 2;
  const y = bounds.height / 2;
  return {
    x: x - ((x - viewport.x) * zoom) / viewport.zoom,
    y: y - ((y - viewport.y) * zoom) / viewport.zoom,
    zoom,
  };
}

export function focusedViewport(
  nodes: readonly ViewportNode[],
  selectedIds: readonly string[] | undefined,
  bounds: CanvasBounds,
  getWidth: (node: ViewportNode) => number,
  getHeight: (node: ViewportNode) => number,
): CanvasViewport | null {
  const selected = selectedIds?.length
    ? nodes.filter((node) => selectedIds.includes(node.id))
    : nodes;
  if (!selected.length) return selectedIds?.length ? null : { x: 0, y: 0, zoom: 1 };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const node of selected) {
    const width = getWidth(node);
    const height = node.height || getHeight(node);
    if (![node.x, node.y, width, height].every(Number.isFinite) || width < 0 || height < 0)
      return null;
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + width);
    bottom = Math.max(bottom, node.y + height);
  }
  const zoom = Math.max(
    STABLE_MIN_ZOOM,
    Math.min(
      STABLE_MAX_ZOOM,
      bounds.width / (right - left + 200),
      bounds.height / (bottom - top + 200),
      1.2,
    ),
  );
  return {
    x: bounds.width / 2 - ((left + right) / 2) * zoom,
    y: bounds.height / 2 - ((top + bottom) / 2) * zoom,
    zoom,
  };
}

/** Use the canvas's React instance; this module never bundles a second React runtime. */
export function useCanvasViewport(
  hooks: ReactHooks,
  getWidth: (node: ViewportNode) => number,
  getHeight: (node: ViewportNode) => number,
) {
  const [viewport, updateViewport] = hooks.useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const canvasRef = hooks.useRef<HTMLElement | null>(null);
  const rendered = hooks.useRef(viewport);
  const releaseTimer = hooks.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelBounds = hooks.useRef<CanvasBounds | null>(null);
  const acceleratedCanvas = hooks.useRef<HTMLElement | null>(null);
  const writeTransform = hooks.useCallback((next: CanvasViewport) => {
    const layer = canvasRef.current?.querySelector<HTMLElement>('#canvas-viewport-content');
    if (layer) layer.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
  }, []);
  const cancelPending = hooks.useCallback(() => {
    if (releaseTimer.current !== null) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    acceleratedCanvas.current?.removeAttribute('data-canvas-wheel-active');
    acceleratedCanvas.current = null;
    wheelBounds.current = null;
  }, []);
  const setViewport = hooks.useCallback((value: React.SetStateAction<CanvasViewport>) => {
    cancelPending();
    const next = typeof value === 'function' ? value(rendered.current) : value;
    rendered.current = next;
    writeTransform(next);
    updateViewport(next);
  }, [cancelPending, writeTransform]);
  const handleWheel = hooks.useCallback((event: StableWheelSample & { target: EventTarget | null }) => {
    if (shouldKeepWheelInsideControl(event.target)) return;
    if (acceleratedCanvas.current !== canvasRef.current || !wheelBounds.current) {
      cancelPending();
      wheelBounds.current = boundsOf(canvasRef.current);
      acceleratedCanvas.current = canvasRef.current;
      acceleratedCanvas.current?.setAttribute('data-canvas-wheel-active', 'true');
    }
    const adapter = window.__FISHERAI_CANVAS_NAVIGATION__;
    const bounds = wheelBounds.current!;
    const next = getWheelMode(event) === 'pan'
      ? (adapter ? adapter.pan(rendered.current, event) : panViewport(rendered.current, event))
      : (adapter ? adapter.zoomAt(rendered.current, event, bounds) : zoomViewportAtPoint(rendered.current, event, {
        x: event.clientX - bounds.left, y: event.clientY - bounds.top,
      }));
    // Match the relay's React Flow viewport: paint the input immediately,
    // without a second smoothing animation restarting after every wheel notch.
    rendered.current = next;
    writeTransform(next);
    updateViewport(next);
    if (releaseTimer.current !== null) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(cancelPending, 150);
  }, [cancelPending, writeTransform]);
  const handleSliderZoom = hooks.useCallback(
    (event: { target: { value: string } }) => {
      const value = Number.parseFloat(event.target.value);
      const bounds = boundsOf(canvasRef.current);
      setViewport((current) => sliderViewport(current, value, bounds));
    },
    [setViewport],
  );
  const focusOnNodes = hooks.useCallback(
    (nodes: readonly ViewportNode[], selectedIds?: readonly string[]) => {
      const next = focusedViewport(
        nodes,
        selectedIds,
        boundsOf(canvasRef.current),
        getWidth,
        getHeight,
      );
      if (next) setViewport(next);
    },
    [getWidth, getHeight, setViewport],
  );
  hooks.useEffect(() => cancelPending, [cancelPending]);
  return { viewport, setViewport, canvasRef, handleWheel, handleSliderZoom, focusOnNodes };
}
