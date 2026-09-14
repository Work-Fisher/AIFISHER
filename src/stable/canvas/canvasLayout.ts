export interface CanvasLayoutNode {
  id: string;
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface CanvasNodeMeasurer<TNode extends CanvasLayoutNode> {
  getWidth(node: TNode): number;
  getHeight(node: TNode): number;
  horizontalGap?: number;
  verticalGap?: number;
  flowColumnsIndependently?: boolean;
}

export interface StableCanvasLayoutAdapter {
  align<TNode extends CanvasLayoutNode>(
    nodes: readonly TNode[],
    selectedNodeIds: readonly string[],
    measurer: CanvasNodeMeasurer<TNode>,
  ): TNode[];
  grid<TNode extends CanvasLayoutNode>(
    nodes: readonly TNode[],
    selectedNodeIds: readonly string[],
    columns: number,
    measurer: CanvasNodeMeasurer<TNode>,
  ): TNode[];
  getDiagnostics(): { alignCalls: number; gridCalls: number };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_LAYOUT__?: StableCanvasLayoutAdapter;
  }
}

export function autoAlignCanvasNodes<TNode extends CanvasLayoutNode>(
  nodes: readonly TNode[],
  selectedNodeIds: readonly string[],
  measurer: CanvasNodeMeasurer<TNode>,
): TNode[] {
  if (selectedNodeIds.length < 2) return nodes as TNode[];
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter((node) => selectedNodeIdSet.has(node.id));
  if (selectedNodes.length < 2) return nodes as TNode[];

  const minX = Math.min(...selectedNodes.map((node) => node.x));
  const minY = Math.min(...selectedNodes.map((node) => node.y));
  const maxX = Math.max(...selectedNodes.map((node) => node.x + measurer.getWidth(node)));
  const maxY = Math.max(...selectedNodes.map((node) => node.y + measurer.getHeight(node)));
  const orientation = maxY - minY > maxX - minX ? 'vertical' : 'horizontal';
  const sortedNodes = [...selectedNodes].sort((first, second) =>
    orientation === 'horizontal' ? first.x - second.x : first.y - second.y,
  );
  const horizontalGap = measurer.horizontalGap ?? 40;
  const verticalGap = measurer.verticalGap ?? 40;
  const positions = new Map<string, { x: number; y: number }>();
  let currentX = minX;
  let currentY = minY;

  for (const node of sortedNodes) {
    positions.set(node.id, { x: currentX, y: currentY });
    if (orientation === 'horizontal') currentX += measurer.getWidth(node) + horizontalGap;
    else currentY += measurer.getHeight(node) + verticalGap;
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, ...position } : node;
  });
}

export function gridLayoutCanvasNodes<TNode extends CanvasLayoutNode>(
  nodes: readonly TNode[],
  selectedNodeIds: readonly string[],
  requestedColumns: number,
  measurer: CanvasNodeMeasurer<TNode>,
): TNode[] {
  if (selectedNodeIds.length < 2) return nodes as TNode[];
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter((node) => selectedNodeIdSet.has(node.id));
  if (selectedNodes.length < 2) return nodes as TNode[];

  const columns = Math.max(1, Math.trunc(requestedColumns));
  const minX = Math.min(...selectedNodes.map((node) => node.x));
  const minY = Math.min(...selectedNodes.map((node) => node.y));
  const horizontalGap = measurer.horizontalGap ?? 40;
  const verticalGap = measurer.verticalGap ?? 40;
  const sortedNodes = [...selectedNodes].sort((first, second) =>
    Math.abs(first.y - second.y) > 100 ? first.y - second.y : first.x - second.x,
  );
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...sortedNodes
        .filter((_node, index) => index % columns === column)
        .map((node) => measurer.getWidth(node)),
      0,
    ),
  );
  const columnY = new Array<number>(columns).fill(minY);
  const positions = new Map<string, { x: number; y: number }>();
  let rowY = minY;
  let rowHeight = 0;

  sortedNodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    let x = minX;
    for (let precedingColumn = 0; precedingColumn < column; precedingColumn += 1) {
      x += columnWidths[precedingColumn] + horizontalGap;
    }

    let y: number;
    if (measurer.flowColumnsIndependently) {
      y = columnY[column];
      columnY[column] = y + measurer.getHeight(node) + verticalGap;
    } else {
      if (column === 0 && row > 0) {
        rowY += rowHeight + verticalGap;
        rowHeight = 0;
      }
      y = rowY;
      rowHeight = Math.max(rowHeight, measurer.getHeight(node));
    }
    positions.set(node.id, { x, y });
  });

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, ...position } : node;
  });
}

export function installStableCanvasLayout(): StableCanvasLayoutAdapter {
  if (window.__FISHERAI_CANVAS_LAYOUT__) return window.__FISHERAI_CANVAS_LAYOUT__;
  let alignCalls = 0;
  let gridCalls = 0;
  const adapter: StableCanvasLayoutAdapter = {
    align(nodes, selectedNodeIds, measurer) {
      const nextNodes = autoAlignCanvasNodes(nodes, selectedNodeIds, measurer);
      if (nextNodes !== nodes) alignCalls += 1;
      return nextNodes;
    },
    grid(nodes, selectedNodeIds, columns, measurer) {
      const nextNodes = gridLayoutCanvasNodes(nodes, selectedNodeIds, columns, measurer);
      if (nextNodes !== nodes) gridCalls += 1;
      return nextNodes;
    },
    getDiagnostics() {
      return { alignCalls, gridCalls };
    },
  };
  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_LAYOUT__ = adapter;
  return adapter;
}
