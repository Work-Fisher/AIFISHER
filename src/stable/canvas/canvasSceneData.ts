import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { CanvasGroup } from './canvasGroups';
import type { CanvasViewport } from './canvasNavigation';

/** Document projections are stable across viewport changes. */
export function canvasSceneData(
  nodes: CanvasNode[],
  measure: {
    width(node: CanvasNode): number;
    height(node: CanvasNode): number;
    text(node: CanvasNode): string;
  },
  previous?: { nodes: CanvasNode[]; display: Map<string, { inputUrl?: string; connectedImageNodes: Record<string, unknown>[] }> },
) {
  const previousById = new Map(previous?.nodes.map(node => [node.id, node]) || []);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const nodesByGroupId = new Map<string, CanvasNode[]>();
  const nodeDisplayData = new Map<
    string,
    { inputUrl?: string; connectedImageNodes: Record<string, unknown>[] }
  >();
  const bounds = nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    width: measure.width(node),
    height: measure.height(node),
  }));
  // Cache only context-independent traversals within this document projection.
  // A branch cut by a cycle depends on its ancestors and cannot be reused by
  // another root. An explicit stack preserves parent order without call-stack limits.
  const resolvedInputs = new Map<string, string | undefined>();
  type Frame = { id: string; parents: string[]; next: number; cycle: boolean };
  const frameFor = (id: string): Frame => ({
    id,
    parents: byId.get(id)?.parentIds || [],
    next: 0,
    cycle: false,
  });
  const inputUrl = (id: string): string | undefined => {
    if (resolvedInputs.has(id)) return resolvedInputs.get(id);
    const visited = new Set([id]);
    const stack = [frameFor(id)];
    const finish = (url: string | undefined) => {
      const frame = stack.pop()!;
      if (!frame.cycle) resolvedInputs.set(frame.id, url);
      const ancestor = stack.at(-1);
      if (ancestor && frame.cycle) ancestor.cycle = true;
    };
    while (stack.length) {
      const frame = stack.at(-1)!;
      if (frame.next >= frame.parents.length) {
        finish(undefined);
        continue;
      }
      const parentId = frame.parents[frame.next++];
      const parent = byId.get(parentId);
      if (!parent) continue;
      const direct =
        parent.type === 'Video' && parent.lastFrame ? parent.lastFrame : parent.resultUrl;
      const url =
        typeof direct === 'string' &&
        direct &&
        !['text-node-placeholder', 'audio-node-placeholder'].includes(direct)
          ? direct
          : resolvedInputs.get(parentId);
      if (url) {
        while (stack.length) finish(url);
        return url;
      }
      if (resolvedInputs.has(parentId)) continue;
      if (visited.has(parentId)) {
        frame.cycle = true;
        continue;
      }
      visited.add(parentId);
      stack.push(frameFor(parentId));
    }
  };
  for (const node of nodes) {
    if (typeof node.groupId === 'string' && node.groupId) {
      const collection = nodesByGroupId.get(node.groupId) || [];
      collection.push(node);
      nodesByGroupId.set(node.groupId, collection);
    }
    const oldNode = previousById.get(node.id);
    const oldDisplay = previous?.display.get(node.id);
    const resolvedUrl = inputUrl(node.id);
    if (oldDisplay && oldNode?.parentIds === node.parentIds && oldDisplay.inputUrl === resolvedUrl &&
      (node.parentIds || []).every(id => byId.get(id) === previousById.get(id))) {
      nodeDisplayData.set(node.id, oldDisplay);
      continue;
    }
    const connectedImageNodes = (node.parentIds || [])
      .flatMap<Record<string, unknown>>((id) => {
        const parent = byId.get(id);
        if (!parent) return [];
        let url = parent.resultUrl || parent.dataUrl;
        if (['Video', 'Upload Video'].includes(parent.type)) url = parent.lastFrame || url;
        else if (parent.type === 'Text') url = 'text-node-placeholder';
        else if (['Audio', 'Upload Audio'].includes(parent.type)) url = 'audio-node-placeholder';
        return [
          {
            ...parent,
            url: url || '',
            prompt: parent.type === 'Text' ? measure.text(parent) : parent.prompt,
            title: parent.title || parent.id,
          },
        ];
      })
      .filter(
        (parent) =>
          parent.url ||
          parent.type === 'Text' ||
          typeof parent.textContent === 'string' ||
          typeof parent.prompt === 'string',
      );
    nodeDisplayData.set(node.id, { inputUrl: resolvedUrl, connectedImageNodes });
  }
  return { nodesByGroupId, nodeDisplayData, bounds };
}

/** Panning only intersects cached bounds; it never traverses references again. */
export function canvasVisibleScene(
  scene: ReturnType<typeof canvasSceneData>,
  groups: CanvasGroup[],
  viewport: CanvasViewport,
  size: { width: number; height: number },
) {
  const { nodesByGroupId } = scene;
  const left = -viewport.x / viewport.zoom - 1600,
    top = -viewport.y / viewport.zoom - 1600;
  const right = (size.width - viewport.x) / viewport.zoom + 1600,
    bottom = (size.height - viewport.y) / viewport.zoom + 1600;
  const visibleNodeIds = new Set(
    scene.bounds
      .filter(
        (node) =>
          node.x + node.width > left &&
          node.x < right &&
          node.y + node.height > top &&
          node.y < bottom,
      )
      .map((node) => node.id),
  );
  const visibleGroups = groups.filter((group) => {
    const children = nodesByGroupId.get(group.id) || [];
    return children.length >= 2 && children.some((node) => visibleNodeIds.has(node.id));
  });
  return { visibleNodeIds, visibleGroups };
}

/** Cache belongs to one canvas and one set of measurement functions. */
export function createCanvasSceneProjector(measure: Parameters<typeof canvasSceneData>[1]) {
  let previous: Parameters<typeof canvasSceneData>[2];
  return (nodes: CanvasNode[]) => {
    const scene = canvasSceneData(nodes, measure, previous);
    previous = { nodes, display: scene.nodeDisplayData };
    return scene;
  };
}
