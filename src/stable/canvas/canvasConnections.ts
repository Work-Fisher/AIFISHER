export interface CanvasConnectionNode {
  id: string;
  type: string;
  parentIds?: string[];
  sourcePortIndices?: number[];
  parameterValues?: Record<string, unknown>;
  imageMode?: string;
  imageModel?: string;
  midjourneyReferenceNodeIds?: Partial<Record<'cref' | 'sref' | 'dref', string>>;
  aspectRatio?: string;
  resultAspectRatio?: string;
  [key: string]: unknown;
}

const IMAGE_REFERENCE_NODE_TYPES = new Set([
  'Image',
  'Upload Image',
  'Image Compare',
  'Image Composite',
  'ComfyUI',
]);

function hasImageReference(
  nodes: readonly CanvasConnectionNode[],
  parentIds: readonly string[],
): boolean {
  return parentIds.some((parentId) => {
    const parent = nodes.find((node) => node.id === parentId);
    return parent ? IMAGE_REFERENCE_NODE_TYPES.has(parent.type) : false;
  });
}

function isTextLikeWorkflowControl(control: unknown): boolean {
  if (!control || typeof control !== 'object') return false;
  const kind = String((control as { kind?: unknown }).kind || '').toLowerCase();
  return ['text', 'textarea', 'string', 'prompt', 'multiline'].includes(kind);
}

function workflowTextParameterKeyAtSlot(
  node: CanvasConnectionNode,
  targetSlotIndex: number,
): string | undefined {
  if (node.kind !== 'workflow' || targetSlotIndex < 0 || targetSlotIndex >= 20) return undefined;
  let slotIndex = 0;
  const inputPorts = Array.isArray(node.inputPorts) ? node.inputPorts : [];
  for (const rawPort of inputPorts) {
    if (!rawPort || typeof rawPort !== 'object' || slotIndex >= 20) continue;
    const port = rawPort as { multiple?: unknown; maximumItems?: unknown };
    const count = port.multiple
      ? Math.min(20 - slotIndex, Math.max(1, Math.trunc(Number(port.maximumItems) || 1)))
      : 1;
    slotIndex += count;
  }
  const parameters = Array.isArray(node.parameterSchema) ? node.parameterSchema : [];
  for (const rawParameter of parameters) {
    if (!rawParameter || typeof rawParameter !== 'object' || slotIndex >= 20) continue;
    const parameter = rawParameter as { key?: unknown; control?: unknown };
    if (!isTextLikeWorkflowControl(parameter.control)) continue;
    if (slotIndex === targetSlotIndex && typeof parameter.key === 'string') return parameter.key;
    slotIndex += 1;
  }
  return undefined;
}

function clearWorkflowTextParameterAtSlot<TNode extends CanvasConnectionNode>(
  node: TNode,
  targetSlotIndex: number,
): void {
  const key = workflowTextParameterKeyAtSlot(node, targetSlotIndex);
  if (!key) return;
  const currentValues =
    node.parameterValues && typeof node.parameterValues === 'object' && !Array.isArray(node.parameterValues)
      ? (node.parameterValues as Record<string, unknown>)
      : {};
  if (currentValues[key] === '') return;
  node.parameterValues = { ...currentValues, [key]: '' };
}

export interface ConnectCanvasNodesOptions {
  parentId: string;
  childId: string;
  portIndex?: number;
  sourcePortIndex?: number;
  inputCount?: number;
  connectionMode?: string;
  modeField?: 'imageMode' | 'videoMode' | 'comfyMode';
}

export interface CanvasConnectionIdentity {
  parentId: string;
  childId: string;
  portIndex?: number;
}

export interface StableCanvasConnectionsAdapter {
  connect<TNode extends CanvasConnectionNode>(
    nodes: readonly TNode[],
    options: ConnectCanvasNodesOptions,
  ): TNode[];
  disconnect<TNode extends CanvasConnectionNode>(
    nodes: readonly TNode[],
    connection: CanvasConnectionIdentity,
  ): TNode[];
  getDiagnostics(): { connectCalls: number; disconnectCalls: number };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_CONNECTIONS__?: StableCanvasConnectionsAdapter;
  }
}

export function connectCanvasNodes<TNode extends CanvasConnectionNode>(
  nodes: readonly TNode[],
  options: ConnectCanvasNodesOptions,
): TNode[] {
  if (options.parentId === options.childId) return nodes as TNode[];
  const parent = nodes.find((node) => node.id === options.parentId);
  if (!parent || parent.uploadPending === true) return nodes as TNode[];
  const child = nodes.find((node) => node.id === options.childId);
  if (!child) return nodes as TNode[];

  const nextChild: TNode = { ...child };
  const parentIds = [...(child.parentIds ?? [])];
  const sourcePortIndices = [...(child.sourcePortIndices ?? [])];
  while (sourcePortIndices.length < parentIds.length) sourcePortIndices.push(0);
  if (sourcePortIndices.length > parentIds.length) sourcePortIndices.length = parentIds.length;
  if (child.type === 'ComfyUI') {
    const inputCount = Math.max(0, Math.trunc(options.inputCount ?? parentIds.length));
    const portIndex = options.portIndex ?? 0;
    if (portIndex < 0 || portIndex >= inputCount) return nodes as TNode[];
    while (parentIds.length < inputCount) parentIds.push('');
    if (parentIds.length > inputCount) parentIds.length = inputCount;
    while (sourcePortIndices.length < inputCount) sourcePortIndices.push(0);
    if (sourcePortIndices.length > inputCount) sourcePortIndices.length = inputCount;
    if (parentIds[portIndex] && parentIds[portIndex] !== options.parentId) {
      return nodes as TNode[];
    }
    parentIds[portIndex] = options.parentId;
    sourcePortIndices[portIndex] = Math.max(0, Math.trunc(options.sourcePortIndex ?? 0));
    clearWorkflowTextParameterAtSlot(nextChild, portIndex);
  } else if (child.type === 'Image Compare' && !parentIds.includes(options.parentId)) {
    const nextParentIds =
      parentIds.length < 2 ? [...parentIds, options.parentId] : [parentIds[0], options.parentId];
    parentIds.splice(0, parentIds.length, ...nextParentIds);
  } else if (child.type === 'Image Composite' && !parentIds.includes(options.parentId)) {
    const nextParentIds =
      parentIds.length < 10
        ? [...parentIds, options.parentId]
        : [...parentIds.slice(1), options.parentId];
    parentIds.splice(0, parentIds.length, ...nextParentIds);
  } else if (!parentIds.includes(options.parentId)) {
    parentIds.push(options.parentId);
  }

  nextChild.parentIds = parentIds;
  if (child.type === 'ComfyUI') {
    nextChild.sourcePortIndices = sourcePortIndices;
  } else if (options.sourcePortIndex !== undefined || child.sourcePortIndices !== undefined) {
    const originalParentIds = child.parentIds ?? [];
    nextChild.sourcePortIndices = parentIds.map((parentId, index) => {
      if (parentId === options.parentId) {
        return Math.max(0, Math.trunc(options.sourcePortIndex ?? sourcePortIndices[index] ?? 0));
      }
      const originalIndex = originalParentIds.indexOf(parentId);
      return originalIndex >= 0 ? sourcePortIndices[originalIndex] ?? 0 : 0;
    });
  }
  if (child.type === 'Image Compare') {
    const firstParent = nodes.find((node) => node.id === parentIds[0]);
    nextChild.aspectRatio = firstParent?.aspectRatio;
    nextChild.resultAspectRatio = firstParent?.resultAspectRatio;
  }
  if (
    options.connectionMode &&
    options.connectionMode !== 'default' &&
    options.modeField
  ) {
    Object.assign(nextChild, { [options.modeField]: options.connectionMode });
  }
  if (JSON.stringify(nextChild) === JSON.stringify(child)) return nodes as TNode[];
  return nodes.map((node) => (node.id === child.id ? nextChild : node));
}

export function disconnectCanvasNodes<TNode extends CanvasConnectionNode>(
  nodes: readonly TNode[],
  connection: CanvasConnectionIdentity,
): TNode[] {
  const child = nodes.find((node) => node.id === connection.childId);
  if (!child) return nodes as TNode[];
  const parentIds = [...(child.parentIds ?? [])];
  const sourcePortIndices = [...(child.sourcePortIndices ?? [])];
  while (sourcePortIndices.length < parentIds.length) sourcePortIndices.push(0);
  if (sourcePortIndices.length > parentIds.length) sourcePortIndices.length = parentIds.length;
  let nextParentIds: string[];

  if (child.type === 'ComfyUI') {
    nextParentIds = parentIds.map((parentId, index) =>
      typeof connection.portIndex === 'number'
        ? index === connection.portIndex
          ? ''
          : parentId
        : parentId === connection.parentId
          ? ''
          : parentId,
    );
  } else {
    nextParentIds = parentIds.filter((parentId) => parentId !== connection.parentId);
  }
  if (JSON.stringify(nextParentIds) === JSON.stringify(parentIds)) return nodes as TNode[];

  const nextChild: TNode = { ...child, parentIds: nextParentIds };
  if (
    child.imageModel === 'Midjourney Imagine · API'
    && child.midjourneyReferenceNodeIds
  ) {
    nextChild.midjourneyReferenceNodeIds = Object.fromEntries(
      Object.entries(child.midjourneyReferenceNodeIds)
        .filter(([, nodeId]) => nodeId !== connection.parentId),
    );
  }
  if (child.type === 'ComfyUI') {
    nextChild.sourcePortIndices = sourcePortIndices.map((sourcePortIndex, index) =>
      typeof connection.portIndex === 'number'
        ? index === connection.portIndex ? 0 : sourcePortIndex
        : parentIds[index] === connection.parentId ? 0 : sourcePortIndex);
    nextParentIds.forEach((parentId, index) => {
      if (!parentId && parentIds[index]) clearWorkflowTextParameterAtSlot(nextChild, index);
    });
  } else if (child.sourcePortIndices !== undefined) {
    nextChild.sourcePortIndices = nextParentIds.map((parentId) => {
      const originalIndex = parentIds.indexOf(parentId);
      return originalIndex >= 0 ? sourcePortIndices[originalIndex] ?? 0 : 0;
    });
  }
  if (child.type === 'Image Compare') {
    const firstParent = nodes.find((node) => node.id === nextParentIds[0]);
    nextChild.aspectRatio = firstParent?.aspectRatio;
    nextChild.resultAspectRatio = firstParent?.resultAspectRatio;
  }
  if (
    child.type === 'Image' &&
    child.imageMode === 'image-to-image' &&
    !hasImageReference(nodes, nextParentIds)
  ) {
    nextChild.imageMode = 'text-to-image';
  }
  return nodes.map((node) => (node.id === child.id ? nextChild : node));
}

export function installStableCanvasConnections(): StableCanvasConnectionsAdapter {
  if (window.__FISHERAI_CANVAS_CONNECTIONS__) return window.__FISHERAI_CANVAS_CONNECTIONS__;
  let connectCalls = 0;
  let disconnectCalls = 0;
  const adapter: StableCanvasConnectionsAdapter = {
    connect(nodes, options) {
      const nextNodes = connectCanvasNodes(nodes, options);
      if (nextNodes !== nodes) connectCalls += 1;
      return nextNodes;
    },
    disconnect(nodes, connection) {
      const nextNodes = disconnectCanvasNodes(nodes, connection);
      if (nextNodes !== nodes) disconnectCalls += 1;
      return nextNodes;
    },
    getDiagnostics() {
      return { connectCalls, disconnectCalls };
    },
  };
  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_CONNECTIONS__ = adapter;
  return adapter;
}
