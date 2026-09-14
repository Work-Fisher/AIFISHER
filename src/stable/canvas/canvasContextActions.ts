export type CanvasContextMenuType = 'global' | 'add-nodes' | 'node-options';
export type CanvasConnectorSide = 'left' | 'right';

export interface CanvasContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: CanvasContextMenuType;
  sourceNodeId?: string;
  sourceNodeIds?: string[];
  connectorSide?: CanvasConnectorSide;
  sourcePortIndex?: number;
}

export interface CanvasContextActionEligibility {
  selectedNodeCount: number;
  hasClipboard: boolean;
}

export interface StableCanvasContextActionsAdapter {
  openCanvasMenu(type: 'global' | 'add-nodes', x: number, y: number): CanvasContextMenuState;
  openNodeMenu(
    nodeIds: readonly string[],
    sourceNodeId: string,
    x: number,
    y: number,
  ): CanvasContextMenuState | null;
  openNextNodeMenu(
    nodeIds: readonly string[],
    sourceNodeId: string,
    connectorSide: CanvasConnectorSide,
    x: number,
    y: number,
    sourceNodeIds?: readonly string[],
    sourcePortIndex?: number,
  ): CanvasContextMenuState | null;
  getEligibility(input: CanvasContextActionEligibility): {
    canCreateAsset: boolean;
    canCreateWorkflow: boolean;
    canPaste: boolean;
  };
  getDiagnostics(): { openCalls: number; rejectedCalls: number };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_CONTEXT_ACTIONS__?: StableCanvasContextActionsAdapter;
  }
}

function coordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function createStableCanvasContextActions(): StableCanvasContextActionsAdapter {
  let openCalls = 0;
  let rejectedCalls = 0;

  const reject = () => {
    rejectedCalls += 1;
    return null;
  };
  const open = (state: CanvasContextMenuState) => {
    openCalls += 1;
    return state;
  };

  return {
    openCanvasMenu(type, x, y) {
      return open({ isOpen: true, x: coordinate(x), y: coordinate(y), type });
    },
    openNodeMenu(nodeIds, sourceNodeId, x, y) {
      if (!nodeIds.includes(sourceNodeId)) return reject();
      return open({
        isOpen: true,
        x: coordinate(x),
        y: coordinate(y),
        type: 'node-options',
        sourceNodeId,
      });
    },
    openNextNodeMenu(nodeIds, sourceNodeId, connectorSide, x, y, sourceNodeIds, sourcePortIndex) {
      if (!nodeIds.includes(sourceNodeId)) return reject();
      const knownNodeIds = new Set(nodeIds);
      const candidates = sourceNodeIds?.length ? sourceNodeIds : [sourceNodeId];
      const validSourceNodeIds = [...new Set(candidates)].filter((id) => knownNodeIds.has(id));
      if (!validSourceNodeIds.includes(sourceNodeId)) validSourceNodeIds.unshift(sourceNodeId);

      return open({
        isOpen: true,
        x: coordinate(x),
        y: coordinate(y),
        type: 'add-nodes',
        sourceNodeId,
        sourceNodeIds: validSourceNodeIds,
        connectorSide,
        ...(sourcePortIndex === undefined ? {} : { sourcePortIndex: Math.max(0, Math.trunc(sourcePortIndex)) }),
      });
    },
    getEligibility({ selectedNodeCount, hasClipboard }) {
      return {
        canCreateAsset: selectedNodeCount > 0,
        canCreateWorkflow: selectedNodeCount >= 2,
        canPaste: hasClipboard,
      };
    },
    getDiagnostics() {
      return { openCalls, rejectedCalls };
    },
  };
}

export function installStableCanvasContextActions(): StableCanvasContextActionsAdapter {
  if (window.__FISHERAI_CANVAS_CONTEXT_ACTIONS__) return window.__FISHERAI_CANVAS_CONTEXT_ACTIONS__;
  const adapter = Object.freeze(createStableCanvasContextActions());
  window.__FISHERAI_CANVAS_CONTEXT_ACTIONS__ = adapter;
  return adapter;
}
