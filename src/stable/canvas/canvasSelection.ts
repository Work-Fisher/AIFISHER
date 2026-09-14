import type { CanvasViewport } from './canvasNavigation';

export interface SelectNodeOptions {
  additive: boolean;
  locked?: boolean;
}

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenMarquee {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface SelectGroupOptions {
  additive: boolean;
  lockedIds?: ReadonlySet<string>;
}

export interface SelectionModifiers {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface StableCanvasSelectionAdapter {
  selectNode(
    selectedIds: readonly string[],
    nodeId: string,
    modifiers: SelectionModifiers,
    locked?: boolean,
  ): string[];
  selectGroup(
    selectedIds: readonly string[],
    groupNodeIds: readonly string[],
    modifiers: SelectionModifiers,
    lockedByNodeId?: Readonly<Record<string, unknown>>,
  ): string[];
  intersectsMarquee(
    bounds: CanvasBounds,
    marquee: ScreenMarquee,
    viewport: CanvasViewport,
  ): boolean;
  clearSelection(): string[];
  getDiagnostics(): {
    clearCalls: number;
    groupCalls: number;
    marqueeCalls: number;
    nodeCalls: number;
  };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_SELECTION__?: StableCanvasSelectionAdapter;
  }
}

export function selectNode(
  selectedIds: readonly string[],
  nodeId: string,
  options: SelectNodeOptions,
): string[] {
  if (options.locked || selectedIds.includes(nodeId)) return [...selectedIds];
  return options.additive ? [...selectedIds, nodeId] : [nodeId];
}

export function intersectsMarquee(
  bounds: CanvasBounds,
  marquee: ScreenMarquee,
  viewport: CanvasViewport,
): boolean {
  const screenLeft = Math.min(marquee.startX, marquee.endX);
  const screenRight = Math.max(marquee.startX, marquee.endX);
  const screenTop = Math.min(marquee.startY, marquee.endY);
  const screenBottom = Math.max(marquee.startY, marquee.endY);
  const canvasLeft = (screenLeft - viewport.x) / viewport.zoom;
  const canvasRight = (screenRight - viewport.x) / viewport.zoom;
  const canvasTop = (screenTop - viewport.y) / viewport.zoom;
  const canvasBottom = (screenBottom - viewport.y) / viewport.zoom;
  const nodeRight = bounds.x + bounds.width;
  const nodeBottom = bounds.y + bounds.height;

  return !(
    canvasRight < bounds.x ||
    canvasLeft > nodeRight ||
    canvasBottom < bounds.y ||
    canvasTop > nodeBottom
  );
}

export function selectGroup(
  selectedIds: readonly string[],
  groupNodeIds: readonly string[],
  options: SelectGroupOptions,
): string[] {
  const selectableIds = groupNodeIds.filter((id) => !options.lockedIds?.has(id));
  if (!options.additive) return [...new Set(selectableIds)];
  return [...new Set([...selectedIds, ...selectableIds])];
}

function isAdditiveSelection(modifiers: SelectionModifiers): boolean {
  return Boolean(modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey);
}

export function installStableCanvasSelection(): StableCanvasSelectionAdapter {
  if (window.__FISHERAI_CANVAS_SELECTION__) return window.__FISHERAI_CANVAS_SELECTION__;
  let clearCalls = 0;
  let groupCalls = 0;
  let marqueeCalls = 0;
  let nodeCalls = 0;
  const adapter: StableCanvasSelectionAdapter = {
    selectNode(selectedIds, nodeId, modifiers, locked) {
      nodeCalls += 1;
      return selectNode(selectedIds, nodeId, {
        additive: isAdditiveSelection(modifiers),
        locked,
      });
    },
    selectGroup(selectedIds, groupNodeIds, modifiers, lockedByNodeId = {}) {
      groupCalls += 1;
      const lockedIds = new Set(
        groupNodeIds.filter((nodeId) => Boolean(lockedByNodeId[nodeId])),
      );
      return selectGroup(selectedIds, groupNodeIds, {
        additive: isAdditiveSelection(modifiers),
        lockedIds,
      });
    },
    intersectsMarquee(bounds, marquee, viewport) {
      marqueeCalls += 1;
      return intersectsMarquee(bounds, marquee, viewport);
    },
    clearSelection() {
      clearCalls += 1;
      return [];
    },
    getDiagnostics() {
      return { clearCalls, groupCalls, marqueeCalls, nodeCalls };
    },
  };
  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_SELECTION__ = adapter;
  return adapter;
}
