export interface CanvasPositionedNode {
  id: string;
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface MoveCanvasNodesOptions {
  activeNodeId: string;
  selectedNodeIds: readonly string[];
  movementX: number;
  movementY: number;
  zoom: number;
}

export type SelectionResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';

export interface CanvasNodeFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

export interface ResizeCanvasSelectionOptions {
  frames: readonly CanvasNodeFrame[];
  handle: SelectionResizeHandle;
  movementX: number;
  movementY: number;
  zoom: number;
}

export interface CanvasHistory<TSnapshot> {
  past: readonly TSnapshot[];
  present: TSnapshot;
  future: readonly TSnapshot[];
  limit: number;
}

export interface StableCanvasEditingAdapter {
  resizeNode<TNode extends CanvasPositionedNode>(nodes: readonly TNode[], options: { id: string; width: number; height: number }): TNode[];
  moveNodes<TNode extends CanvasPositionedNode>(
    nodes: readonly TNode[],
    options: MoveCanvasNodesOptions,
  ): TNode[];
  resizeSelection<TNode extends CanvasPositionedNode>(
    nodes: readonly TNode[],
    options: ResizeCanvasSelectionOptions,
  ): TNode[];
  getMovableNodeIds(
    selectedNodeIds: readonly string[],
    lockedByNodeId?: Readonly<Record<string, unknown>>,
  ): string[];
  hasPendingMove(): boolean;
  commit<TSnapshot>(
    history: CanvasHistory<TSnapshot>,
    nextSnapshot: TSnapshot,
  ): CanvasHistory<TSnapshot>;
  undo<TSnapshot>(history: CanvasHistory<TSnapshot>): CanvasHistory<TSnapshot>;
  redo<TSnapshot>(history: CanvasHistory<TSnapshot>): CanvasHistory<TSnapshot>;
  reset<TSnapshot>(snapshot: TSnapshot, limit?: number): CanvasHistory<TSnapshot>;
  getDiagnostics(): {
    commitCalls: number;
    lockedFilterCalls: number;
    moveCalls: number;
    resizeCalls: number;
    redoCalls: number;
    resetCalls: number;
    undoCalls: number;
  };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_EDITING__?: StableCanvasEditingAdapter;
  }
}

export function moveCanvasNodes<TNode extends CanvasPositionedNode>(
  nodes: readonly TNode[],
  options: MoveCanvasNodesOptions,
): TNode[] {
  if (options.movementX === 0 && options.movementY === 0) {
    return nodes as TNode[];
  }
  if (!Number.isFinite(options.zoom) || options.zoom <= 0) return nodes as TNode[];

  const deltaX = options.movementX / options.zoom;
  const deltaY = options.movementY / options.zoom;
  const movingNodeIds =
    options.selectedNodeIds.includes(options.activeNodeId) && options.selectedNodeIds.length > 1
      ? new Set(options.selectedNodeIds)
      : new Set([options.activeNodeId]);

  return nodes.map((node) =>
    movingNodeIds.has(node.id) ? { ...node, x: node.x + deltaX, y: node.y + deltaY } : node,
  );
}

function selectionScale(
  frames: readonly CanvasNodeFrame[],
  options: ResizeCanvasSelectionOptions,
): { anchorX: number; anchorY: number; scaleX: number; scaleY: number } | null {
  if (frames.length < 2 || !Number.isFinite(options.zoom) || options.zoom <= 0) return null;
  if (frames.some((frame) => (
    !Number.isFinite(frame.x)
    || !Number.isFinite(frame.y)
    || !Number.isFinite(frame.width)
    || !Number.isFinite(frame.height)
    || frame.width <= 0
    || frame.height <= 0
  ))) return null;

  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;

  const movesLeft = options.handle.includes('left');
  const movesRight = options.handle.includes('right');
  const movesTop = options.handle.includes('top');
  const movesBottom = options.handle.includes('bottom');
  const deltaX = options.movementX / options.zoom;
  const deltaY = options.movementY / options.zoom;
  const minimumScaleX = Math.max(
    ...frames.map((frame) => Math.max(1, frame.minWidth ?? 80) / frame.width),
  );
  const minimumScaleY = Math.max(
    ...frames.map((frame) => Math.max(1, frame.minHeight ?? 80) / frame.height),
  );

  let scaleX = movesLeft ? (width - deltaX) / width : movesRight ? (width + deltaX) / width : 1;
  let scaleY = movesTop ? (height - deltaY) / height : movesBottom ? (height + deltaY) / height : 1;
  const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom);
  if (isCorner) {
    const directionX = movesLeft ? -width : width;
    const directionY = movesTop ? -height : height;
    const projectedScale = 1 + (
      deltaX * directionX + deltaY * directionY
    ) / (width * width + height * height);
    const uniformScale = Math.max(minimumScaleX, minimumScaleY, projectedScale);
    scaleX = uniformScale;
    scaleY = uniformScale;
  } else {
    if (movesLeft || movesRight) scaleX = Math.max(minimumScaleX, scaleX);
    if (movesTop || movesBottom) scaleY = Math.max(minimumScaleY, scaleY);
  }

  return {
    anchorX: movesLeft ? maxX : minX,
    anchorY: movesTop ? maxY : minY,
    scaleX,
    scaleY,
  };
}

export function resizeCanvasSelection<TNode extends CanvasPositionedNode>(
  nodes: readonly TNode[],
  options: ResizeCanvasSelectionOptions,
): TNode[] {
  if (options.movementX === 0 && options.movementY === 0) return nodes as TNode[];
  const transform = selectionScale(options.frames, options);
  if (!transform) return nodes as TNode[];

  const frameById = new Map(options.frames.map((frame) => [frame.id, frame]));
  return nodes.map((node) => {
    const frame = frameById.get(node.id);
    if (!frame) return node;
    return {
      ...node,
      x: transform.anchorX + (frame.x - transform.anchorX) * transform.scaleX,
      y: transform.anchorY + (frame.y - transform.anchorY) * transform.scaleY,
      width: frame.width * transform.scaleX,
      height: frame.height * transform.scaleY,
    };
  });
}

export function getMovableNodeIds(
  selectedNodeIds: readonly string[],
  lockedByNodeId: Readonly<Record<string, unknown>> = {},
): string[] {
  return [...new Set(selectedNodeIds.filter((nodeId) => !lockedByNodeId[nodeId]))];
}

export function createCanvasHistory<TSnapshot>(
  initialSnapshot: TSnapshot,
  limit = 50,
): CanvasHistory<TSnapshot> {
  return {
    past: [],
    present: initialSnapshot,
    future: [],
    limit: Math.max(1, Math.trunc(limit)),
  };
}

export function commitCanvasHistory<TSnapshot>(
  history: CanvasHistory<TSnapshot>,
  nextSnapshot: TSnapshot,
): CanvasHistory<TSnapshot> {
  if (JSON.stringify(nextSnapshot) === JSON.stringify(history.present)) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: nextSnapshot,
    future: [],
  };
}

function replaceSnapshotNodes<TSnapshot>(
  snapshot: TSnapshot,
  geometry: ReadonlyMap<string, Record<string, unknown>>,
): TSnapshot {
  if (!geometry.size || !snapshot || typeof snapshot !== 'object' || !('nodes' in snapshot)) {
    return snapshot;
  }
  if (!Array.isArray(snapshot.nodes)) return snapshot;
  // Pointer events can finish before React publishes their last geometry. Patch
  // only those fields: asynchronous results and node additions/deletions win.
  const nodes = (snapshot.nodes as CanvasPositionedNode[]).map(node => {
    const patch = geometry.get(node.id);
    return patch ? { ...node, ...patch } : node;
  });
  return { ...snapshot, nodes };
}

export function undoCanvasHistory<TSnapshot>(
  history: CanvasHistory<TSnapshot>,
): CanvasHistory<TSnapshot> {
  if (history.past.length === 0) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redoCanvasHistory<TSnapshot>(
  history: CanvasHistory<TSnapshot>,
): CanvasHistory<TSnapshot> {
  if (history.future.length === 0) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: history.future[0],
    future: history.future.slice(1),
  };
}

export function installStableCanvasEditing(): StableCanvasEditingAdapter {
  if (window.__FISHERAI_CANVAS_EDITING__) return window.__FISHERAI_CANVAS_EDITING__;
  let commitCalls = 0;
  let lockedFilterCalls = 0;
  let moveCalls = 0;
  let resizeCalls = 0;
  let redoCalls = 0;
  let resetCalls = 0;
  let undoCalls = 0;
  const pendingGeometry = new Map<string, Record<string, unknown>>();
  const rememberGeometry = (before: readonly CanvasPositionedNode[], after: readonly CanvasPositionedNode[], fields: string[]) => {
    after.forEach((node, index) => {
      if (node === before[index]) return;
      const patch = { ...pendingGeometry.get(node.id) };
      for (const field of fields) patch[field] = node[field];
      pendingGeometry.set(node.id, patch);
    });
  };
  const adapter: StableCanvasEditingAdapter = {
    resizeNode(nodes, options) {
      if (![options.width, options.height].every(Number.isFinite)) return nodes as typeof nodes[number][];
      const resized = nodes.map(node => {
        if (node.id !== options.id) return node;
        const minimum = node.type === 'Text' ? 252 : 200;
        const width = Math.max(minimum, options.width), height = Math.max(minimum, options.height);
        return node.width === width && node.height === height ? node : { ...node, width, height };
      });
      if (resized.some((node, index) => node !== nodes[index])) {
        resizeCalls += 1;
        rememberGeometry(nodes, resized, ['width', 'height']);
        return resized;
      }
      return nodes as typeof nodes[number][];
    },
    moveNodes(nodes, options) {
      const movedNodes = moveCanvasNodes(nodes, options);
      if (movedNodes !== nodes) {
        moveCalls += 1;
        rememberGeometry(nodes, movedNodes, ['x', 'y']);
      }
      return movedNodes;
    },
    resizeSelection(nodes, options) {
      const resizedNodes = resizeCanvasSelection(nodes, options);
      if (resizedNodes !== nodes) {
        resizeCalls += 1;
        rememberGeometry(nodes, resizedNodes, ['x', 'y', 'width', 'height']);
      }
      return resizedNodes;
    },
    getMovableNodeIds(selectedNodeIds, lockedByNodeId) {
      lockedFilterCalls += 1;
      return getMovableNodeIds(selectedNodeIds, lockedByNodeId);
    },
    hasPendingMove() {
      return pendingGeometry.size > 0;
    },
    commit(history, nextSnapshot) {
      const resolvedSnapshot = replaceSnapshotNodes(nextSnapshot, pendingGeometry);
      pendingGeometry.clear();
      const committedHistory = commitCanvasHistory(history, resolvedSnapshot);
      if (committedHistory !== history) commitCalls += 1;
      return committedHistory;
    },
    undo(history) {
      pendingGeometry.clear();
      const undoneHistory = undoCanvasHistory(history);
      if (undoneHistory !== history) undoCalls += 1;
      return undoneHistory;
    },
    redo(history) {
      pendingGeometry.clear();
      const redoneHistory = redoCanvasHistory(history);
      if (redoneHistory !== history) redoCalls += 1;
      return redoneHistory;
    },
    reset(snapshot, limit) {
      pendingGeometry.clear();
      resetCalls += 1;
      return createCanvasHistory(snapshot, limit);
    },
    getDiagnostics() {
      return {
        commitCalls,
        lockedFilterCalls,
        moveCalls,
        resizeCalls,
        redoCalls,
        resetCalls,
        undoCalls,
      };
    },
  };
  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_EDITING__ = adapter;
  return adapter;
}
