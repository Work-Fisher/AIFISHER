import { remapCanvasNodeReferences } from './canvasNodeReferences';
import { disconnectCanvasNodes } from './canvasConnections';

export interface CanvasClipboardNode {
  id: string;
  type: string;
  x: number;
  y: number;
  parentIds?: string[];
  groupId?: string;
  [key: string]: unknown;
}

export interface CloneCanvasNodesOptions {
  offset: number;
  createId: () => string;
  preserveParentConnections?: boolean;
  targetPoint?: { x: number; y: number };
}

export interface CanvasClipboardViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasClipboardBounds {
  left: number;
  top: number;
}

export interface InsertClonedCanvasNodesOptions {
  preserveChildConnections?: boolean;
}

export interface ClonedCanvasNodes<TNode extends CanvasClipboardNode> {
  newNodes: TNode[];
  idMap: Map<string, string>;
}

export interface StableCanvasClipboardAdapter {
  clone<TNode extends CanvasClipboardNode>(
    nodes: readonly TNode[],
    options: CloneCanvasNodesOptions,
  ): ClonedCanvasNodes<TNode>;
  insert<TNode extends CanvasClipboardNode>(
    nodes: readonly TNode[],
    newNodes: readonly TNode[],
    idMap: ReadonlyMap<string, string>,
    options?: InsertClonedCanvasNodesOptions,
  ): TNode[];
  delete<TNode extends CanvasClipboardNode>(
    nodes: readonly TNode[],
    nodeIds: readonly string[],
  ): TNode[];
  getDiagnostics(): { cloneCalls: number; deleteCalls: number; insertCalls: number };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_CLIPBOARD__?: StableCanvasClipboardAdapter;
  }
}

export const GENERATING_COPY_MESSAGE = '正在生成，请在生成后复制。';

export function hasGeneratingCanvasNodes(nodes: readonly CanvasClipboardNode[]): boolean {
  return nodes.some((node) => ['loading', 'queued'].includes(String(node.status)));
}

export function cloneCanvasNodes<TNode extends CanvasClipboardNode>(
  nodes: readonly TNode[],
  options: CloneCanvasNodesOptions,
): ClonedCanvasNodes<TNode> {
  if (hasGeneratingCanvasNodes(nodes)) throw new Error(GENERATING_COPY_MESSAGE);
  const idMap = new Map(nodes.map((node) => [node.id, options.createId()]));
  const origin = nodes.reduce(
    (current, node) => ({
      x: Math.min(current.x, node.x),
      y: Math.min(current.y, node.y),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
  );
  const targetPoint = options.targetPoint;
  const translation =
    targetPoint && Number.isFinite(targetPoint.x) && Number.isFinite(targetPoint.y)
      ? { x: targetPoint.x - origin.x, y: targetPoint.y - origin.y }
      : { x: options.offset, y: options.offset };
  const newNodes = nodes.map((node) => {
    const clonedNode = {
      ...node,
      ...(node.localWorkflowOperationId || node.generationAttemptId ||
      ['loading', 'queued'].includes(String(node.status))
        ? {
            localWorkflowOperationId: undefined,
            generationAttemptId: undefined,
            generationStartTime: undefined,
            generationDiagnosticCode: undefined,
            progress: undefined,
            status: node.resultUrl ? 'success' : 'idle',
            errorMessage: undefined,
          }
        : {}),
      ...remapCanvasNodeReferences(node, id => options.preserveParentConnections ? idMap.get(id) ?? id : undefined),
      id: idMap.get(node.id)!,
      x: node.x + translation.x,
      y: node.y + translation.y,
      parentIds: options.preserveParentConnections
        ? node.parentIds?.map((parentId) => idMap.get(parentId) ?? parentId)
        : [],
    };
    delete clonedNode.groupId;
    return clonedNode;
  });
  return { newNodes, idMap };
}

export function pointerToCanvasPoint(
  pointer: { clientX: number; clientY: number } | undefined,
  viewport: CanvasClipboardViewport,
  bounds: CanvasClipboardBounds = { left: 0, top: 0 },
): { x: number; y: number } | undefined {
  if (!pointer || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return undefined;
  return {
    x: (pointer.clientX - bounds.left - viewport.x) / viewport.zoom,
    y: (pointer.clientY - bounds.top - viewport.y) / viewport.zoom,
  };
}

export function insertClonedCanvasNodes<TNode extends CanvasClipboardNode>(
  nodes: readonly TNode[],
  newNodes: readonly TNode[],
  idMap: ReadonlyMap<string, string>,
  options: InsertClonedCanvasNodesOptions = {},
): TNode[] {
  const existingNodes = options.preserveChildConnections
    ? nodes.map((node) => {
        const clonedParents = (node.parentIds ?? [])
          .filter((parentId) => idMap.has(parentId))
          .map((parentId) => idMap.get(parentId)!);
        return clonedParents.length > 0
          ? {
              ...node,
              parentIds: [...new Set([...(node.parentIds ?? []), ...clonedParents])],
            }
          : node;
      })
    : nodes;
  return [...existingNodes, ...newNodes];
}

export function deleteCanvasNodes<TNode extends CanvasClipboardNode>(
  nodes: readonly TNode[],
  nodeIds: readonly string[],
): TNode[] {
  const deletedNodeIds = new Set(nodeIds);
  if (!nodes.some((node) => deletedNodeIds.has(node.id))) return nodes as TNode[];

  let remaining = nodes.filter((node) => !deletedNodeIds.has(node.id));
  for (const node of remaining) {
    for (const parentId of new Set(node.parentIds ?? [])) {
      if (deletedNodeIds.has(parentId))
        remaining = disconnectCanvasNodes(remaining, { parentId, childId: node.id });
    }
  }
  return remaining;
}

export function installStableCanvasClipboard(): StableCanvasClipboardAdapter {
  if (window.__FISHERAI_CANVAS_CLIPBOARD__) return window.__FISHERAI_CANVAS_CLIPBOARD__;
  let cloneCalls = 0;
  let deleteCalls = 0;
  let insertCalls = 0;
  const adapter: StableCanvasClipboardAdapter = {
    clone(nodes, options) {
      const cloned = cloneCanvasNodes(nodes, options);
      if (cloned.newNodes.length > 0) cloneCalls += 1;
      return cloned;
    },
    insert(nodes, newNodes, idMap, options) {
      const nextNodes = insertClonedCanvasNodes(nodes, newNodes, idMap, options);
      if (newNodes.length > 0) insertCalls += 1;
      return nextNodes;
    },
    delete(nodes, nodeIds) {
      const nextNodes = deleteCanvasNodes(nodes, nodeIds);
      if (nextNodes !== nodes) deleteCalls += 1;
      return nextNodes;
    },
    getDiagnostics() {
      return { cloneCalls, deleteCalls, insertCalls };
    },
  };
  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_CLIPBOARD__ = adapter;
  return adapter;
}
