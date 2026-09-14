export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}

export interface WheelModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface WheelDelta {
  deltaX?: number;
  deltaY: number;
  deltaMode?: number;
}

export interface StableWheelSample extends WheelDelta, WheelModifiers {
  clientX: number;
  clientY: number;
}

export interface CanvasElementBounds {
  left: number;
  top: number;
}

export type WheelMode = 'pan' | 'zoom';

export const STABLE_MIN_ZOOM = 0.05;
export const STABLE_MAX_ZOOM = 5;
export const STABLE_WHEEL_ZOOM_SENSITIVITY = 0.002;

const CANVAS_COMPOSITING_POLICY_SELECTOR =
  '[data-fisherai-canvas-compositing-policy]';

const CANVAS_INTERACTION_SELECTOR = '#canvas-background';
const browserZoomGuardDocuments = new WeakSet<Document>();

const WHEEL_CONTROL_SELECTOR = [
  '[data-af-node-parameters]',
  '[data-fisherai-asset-preview]',
  '[data-fisherai-minimax-prompt-surface]',
  '[data-fisherai-workflow-prompt-editor]',
  '[data-fisherai-workflow-parameters]',
  '[data-fisherai-model-picker]',
  '[data-fisherai-model-picker-flyout]',
  '.prompt-editor-container',
  '.text-node-content',
].join(',');

export function shouldKeepWheelInsideControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(WHEEL_CONTROL_SELECTOR));
}

export function shouldPreventBrowserZoom(
  target: EventTarget | null,
  modifiers: WheelModifiers,
): boolean {
  return Boolean(
    (modifiers.ctrlKey || modifiers.metaKey)
    && target instanceof Element
    && target.closest(CANVAS_INTERACTION_SELECTOR),
  );
}

export function installCanvasLocalBrowserZoomGuard(
  targetDocument: Document = document,
): void {
  if (browserZoomGuardDocuments.has(targetDocument)) return;
  targetDocument.addEventListener('wheel', (event) => {
    if (shouldPreventBrowserZoom(event.target, event)) event.preventDefault();
  }, { capture: true, passive: false });
  browserZoomGuardDocuments.add(targetDocument);
}

export function getWheelMode(modifiers: WheelModifiers): WheelMode {
  return modifiers.altKey ? 'pan' : 'zoom';
}

export function canvasToScreen(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function screenToCanvas(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function panViewport(viewport: CanvasViewport, wheel: WheelDelta): CanvasViewport {
  return {
    ...viewport,
    x: viewport.x - (wheel.deltaX || 0),
    y: viewport.y - wheel.deltaY,
  };
}

export function zoomViewportAtPoint(
  viewport: CanvasViewport,
  wheel: WheelDelta,
  pointer: CanvasPoint,
): CanvasViewport {
  const factor = Math.pow(2, -wheel.deltaY * (wheel.deltaMode === 1 ? 0.05 : wheel.deltaMode ? 1 : STABLE_WHEEL_ZOOM_SENSITIVITY));
  const zoom = Math.min(
    Math.max(STABLE_MIN_ZOOM, viewport.zoom * factor),
    STABLE_MAX_ZOOM,
  );
  if (zoom === viewport.zoom) return viewport;
  const zoomRatio = zoom / viewport.zoom;
  return {
    x: pointer.x - (pointer.x - viewport.x) * zoomRatio,
    y: pointer.y - (pointer.y - viewport.y) * zoomRatio,
    zoom,
  };
}

export interface StableCanvasNavigationAdapter {
  getWheelMode(modifiers: WheelModifiers): WheelMode;
  shouldKeepWheelInsideControl(target: EventTarget | null): boolean;
  pan(viewport: CanvasViewport, wheel: WheelDelta): CanvasViewport;
  zoomAt(
    viewport: CanvasViewport,
    wheel: StableWheelSample,
    bounds: CanvasElementBounds,
  ): CanvasViewport;
  getDiagnostics(): { panCalls: number; zoomCalls: number };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_NAVIGATION__?: StableCanvasNavigationAdapter;
  }
}

export function installStableCanvasCompositingPolicy(
  targetDocument: Document = document,
): HTMLStyleElement {
  const installed = targetDocument.querySelector<HTMLStyleElement>(
    CANVAS_COMPOSITING_POLICY_SELECTOR,
  );
  if (installed) return installed;

  const style = targetDocument.createElement('style');
  style.dataset.fisheraiCanvasCompositingPolicy = 'true';
  style.textContent = `
#canvas-viewport-content {
  will-change: auto !important;
}
[data-canvas-wheel-active] #canvas-viewport-content [data-node-id] {
  will-change: transform !important;
}
`;
  (targetDocument.head || targetDocument.documentElement).append(style);
  return style;
}

export function installStableCanvasNavigation(): StableCanvasNavigationAdapter {
  installStableCanvasCompositingPolicy();
  installCanvasLocalBrowserZoomGuard();
  let panCalls = 0;
  let zoomCalls = 0;
  const adapter: StableCanvasNavigationAdapter = Object.freeze({
    getWheelMode,
    shouldKeepWheelInsideControl,
    pan(viewport: CanvasViewport, wheel: WheelDelta) {
      panCalls += 1;
      return panViewport(viewport, wheel);
    },
    zoomAt(
      viewport: CanvasViewport,
      wheel: StableWheelSample,
      bounds: CanvasElementBounds,
    ) {
      zoomCalls += 1;
      return zoomViewportAtPoint(viewport, wheel, {
        x: wheel.clientX - bounds.left,
        y: wheel.clientY - bounds.top,
      });
    },
    getDiagnostics() {
      return { panCalls, zoomCalls };
    },
  });
  window.__FISHERAI_CANVAS_NAVIGATION__ = adapter;
  return adapter;
}
