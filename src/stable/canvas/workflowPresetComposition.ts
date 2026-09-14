export interface WorkflowPresetCanvasNode {
  id: string;
  type?: string;
  kind?: string;
  parentIds?: string[];
  frameInputs?: Array<{ nodeId?: string }>;
  comfyInputs?: Record<string, string>;
  linkedVideoNodeId?: string;
  compositeLayout?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StableWorkflowPresetCompositionAdapter {
  collect<TNode extends WorkflowPresetCanvasNode>(
    nodes: readonly TNode[],
    selectedNodeIds: readonly string[],
  ): TNode[];
  canCreate<TNode extends WorkflowPresetCanvasNode>(
    nodes: readonly TNode[],
    selectedNodeIds: readonly string[],
  ): boolean;
}

declare global {
  interface Window {
    __FISHERAI_WORKFLOW_PRESET_COMPOSITION__?: StableWorkflowPresetCompositionAdapter;
  }
}

function referencedNodeIds(node: WorkflowPresetCanvasNode): string[] {
  const references = [
    ...(node.parentIds ?? []),
    ...(node.frameInputs ?? []).map((input) => input.nodeId ?? ''),
    ...Object.values(node.comfyInputs ?? {}),
    node.linkedVideoNodeId ?? '',
    ...Object.keys(node.compositeLayout ?? {}),
  ];
  return [...new Set(references.filter(Boolean))];
}

/**
 * 工作流预设只自动带走其依赖的上游节点，不追踪下游消费者。
 * 这样既能保存图片/文字/音频/视频输入及连线，也不会把整张画布意外打包。
 */
export function collectWorkflowPresetComposition<TNode extends WorkflowPresetCanvasNode>(
  nodes: readonly TNode[],
  selectedNodeIds: readonly string[],
): TNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set(selectedNodeIds.filter((nodeId) => nodeById.has(nodeId)));
  const workflowRoots = [...selected]
    .map((nodeId) => nodeById.get(nodeId)!)
    .filter((node) => node.kind === 'workflow');

  // 普通多选保持原语义；只有选择了通用工作流节点才自动展开依赖。
  if (workflowRoots.length === 0) return nodes.filter((node) => selected.has(node.id));

  const included = new Set(selected);
  const pending = [...workflowRoots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    for (const referencedId of referencedNodeIds(node)) {
      if (included.has(referencedId)) continue;
      const referencedNode = nodeById.get(referencedId);
      if (!referencedNode) continue;
      included.add(referencedId);
      pending.push(referencedNode);
    }
  }

  // 使用原画布顺序，保证保存封面、层级与恢复顺序稳定。
  return nodes.filter((node) => included.has(node.id));
}

export function canCreateWorkflowPresetComposition<TNode extends WorkflowPresetCanvasNode>(
  nodes: readonly TNode[],
  selectedNodeIds: readonly string[],
): boolean {
  const selected = nodes.filter((node) => selectedNodeIds.includes(node.id));
  if (selected.some((node) => node.kind === 'workflow')) return true;
  return selected.length >= 2;
}

export function installWorkflowPresetComposition(): StableWorkflowPresetCompositionAdapter {
  const adapter = Object.freeze({
    collect: collectWorkflowPresetComposition,
    canCreate: canCreateWorkflowPresetComposition,
  });
  window.__FISHERAI_WORKFLOW_PRESET_COMPOSITION__ = adapter;
  return adapter;
}
