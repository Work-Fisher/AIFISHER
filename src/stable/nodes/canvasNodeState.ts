import type * as React from 'react';
import {
  createNodeOperations,
  createNodeMenuOperations,
  createCanvasNode,
  updateCanvasNode,
  connectNewCanvasNode,
  type CanvasNode,
  type NodeRuntime,
} from './canvasNodeOperations';
import { installNodeFramework } from './nodeFramework';
import type {
  WorkflowCanvasNodeRecord,
  WorkflowVerifiedCanvasInsertion,
  WorkflowCanvasOutputValue,
} from '../local/workflowCanvasNodes';
import type { WorkflowCanvasBlueprint } from '../local/workflowManagerClient';

export { createNodeOperations, createNodeMenuOperations } from './canvasNodeOperations';
export { useCanvasContextMenu } from '../canvas/canvasContextHooks';
export { createCanvasTextActions } from '../canvas/canvasTextActions';
type Hooks = Pick<typeof React, 'useState' | 'useRef' | 'useCallback' | 'useEffect'>;
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
interface NodeStore {
  getNodes(): CanvasNode[];
  setNodes: Setter<CanvasNode[]>;
  setSelected: Setter<string[]>;
}
interface StateRuntime extends NodeRuntime {
  getWidth(node: CanvasNode): number;
  layout(options: {
    nodes: CanvasNode[];
    selectedNodeIds: string[];
    setNodes: Setter<CanvasNode[]>;
  }): {
    autoAlignNodes: (...args: never[]) => void;
    gridLayoutNodes: (...args: never[]) => void;
  };
}
function workflowNode(node: CanvasNode | undefined): node is CanvasNode & WorkflowCanvasNodeRecord {
  return node?.type === 'ComfyUI' && node.kind === 'workflow';
}
function eventDetail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail;
}

/** Listeners act on one live store; no side effects run inside React state updaters. */
export function attachWorkflowNodeEvents(
  store: NodeStore,
  runtime: Pick<StateRuntime, 'getWidth' | 'createId'>,
) {
  const frames = new Set<number>();
  const listeners = new Map<string, EventListener>();
  const listen = <T>(name: string, handler: (detail: T) => void) => {
    const listener: EventListener = (event) => handler(eventDetail<T>(event));
    listeners.set(name, listener);
    window.addEventListener(name, listener);
  };
  const capture = (nodes: CanvasNode[], id: string) =>
    window.__FISHERAI_WORKFLOW_NODES__?.captureExample(nodes, id);
  listen<
    | WorkflowCanvasBlueprint
    | {
        blueprint: WorkflowCanvasBlueprint;
        verified?: WorkflowVerifiedCanvasInsertion;
        requestId?: string;
      }
  >('fisherai:add-workflow-node', (detail) => {
    const adapter = window.__FISHERAI_WORKFLOW_NODES__;
    if (!adapter || !detail) return;
    const request = 'blueprint' in detail ? detail : { blueprint: detail };
    const blueprint = request.blueprint;
    if (!blueprint) return;
    const before = store.getNodes();
    const definitionId = blueprint.workflowRef?.definitionId;
    if (definitionId)
      before
        .filter(workflowNode)
        .filter((node) => node.workflowRef?.definitionId === definitionId)
        .some((node) => capture(before, node.id));
    const position = {
      x: before.length
        ? Math.max(...before.map((node) => node.x + runtime.getWidth(node))) + 80
        : 160,
      y: before.length ? Math.min(...before.map((node) => node.y)) : 140,
    };
    const inserted = request.verified
      ? adapter.instantiateVerifiedRun(blueprint, request.verified, position)
      : adapter.instantiateExample(blueprint, position);
    const nodes = inserted.nodes as CanvasNode[];
    if (!nodes.length || nodes.some((node) => before.some((existing) => existing.id === node.id)))
      return;
    const after = [...before, ...nodes];
    store.setNodes(after);
    store.setSelected(inserted.selectedNodeIds);
    const workflow = nodes.find(workflowNode);
    if (workflow) capture(after, workflow.id);
    const frame = requestAnimationFrame(() => {
      frames.delete(frame);
      if (!nodes.every((node) => store.getNodes().some((existing) => existing.id === node.id)))
        return;
      window.dispatchEvent(
        new CustomEvent('fisherai:workflow-canvas-inserted', {
          detail: {
            requestId: request.requestId,
            nodeIds: inserted.selectedNodeIds,
            workflowNodeId: workflow?.id ?? '',
            nodes,
          },
        }),
      );
    });
    frames.add(frame);
  });
  listen<{ nodeId: string; blueprint: WorkflowCanvasBlueprint }>(
    'fisherai:update-workflow-node',
    (detail) => {
      const adapter = window.__FISHERAI_WORKFLOW_NODES__;
      if (!adapter || !detail?.nodeId || !detail.blueprint) return;
      const before = store.getNodes();
      const target = before.find((node) => node.id === detail.nodeId);
      if (!workflowNode(target)) return;
      const updated = adapter.updateNode(target, detail.blueprint);
      store.setNodes(before.map((node) => (node.id === target.id ? updated : node)));
    },
  );
  listen<{ workflowNodeId: string; slotIndex: number; sourceNode: CanvasNode }>(
    'fisherai:add-workflow-input-node',
    (detail) => {
      const adapter = window.__FISHERAI_WORKFLOW_NODES__;
      if (
        !adapter ||
        !detail?.sourceNode?.id ||
        !Number.isInteger(detail.slotIndex) ||
        detail.slotIndex < 0
      )
        return;
      const nodes = store.getNodes(),
        slot = detail.slotIndex;
      const target = nodes.find((node) => node.id === detail.workflowNodeId);
      if (
        !workflowNode(target) ||
        nodes.some((node) => node.id === detail.sourceNode.id) ||
        target.parentIds?.[slot] ||
        !adapter
          .getInputSlots(target)
          .some((input) => input.slotIndex === slot && input.source === 'input-port')
      )
        return;
      const source = installNodeFramework().create({
        ...detail.sourceNode,
        x: target.x - 440,
        y: target.y + slot * (detail.sourceNode.type === 'Upload Audio' ? 240 : 380),
        parentIds: [],
        sourcePortIndices: [],
      }) as CanvasNode;
      if (!adapter.canConnect(target, source, slot, 0)) return;
      const capacity = adapter.getInputCapacity(target);
      const parents = Array.from(
        { length: capacity },
        (_, index) => target.parentIds?.[index] ?? '',
      );
      const ports = Array.from(
        { length: capacity },
        (_, index) => target.sourcePortIndices?.[index] ?? 0,
      );
      parents[slot] = source.id;
      ports[slot] = 0;
      const updated = {
        ...target,
        parentIds: parents,
        sourcePortIndices: ports,
        ...(target.executionState?.status === 'validation-error'
          ? { status: 'idle', executionState: { status: 'idle' as const }, errorMessage: undefined }
          : {}),
      };
      const after = [...nodes.map((node) => (node.id === target.id ? updated : node)), source];
      store.setNodes(after);
      store.setSelected([target.id, source.id]);
      capture(after, target.id);
    },
  );
  listen<{
    sourceNodeId: string;
    runId: string;
    outputs: (WorkflowCanvasOutputValue & { portIndex?: number })[];
  }>('fisherai:add-workflow-output-nodes', (detail) => {
    if (!detail?.sourceNodeId || !detail.runId || !Array.isArray(detail.outputs)) return;
    const nodes = store.getNodes(),
      source = nodes.find((node) => node.id === detail.sourceNodeId);
    if (!workflowNode(source)) return;
    // Replayed results are only accepted for the currently observed workflow run.
    if (source.executionState?.runId !== detail.runId) return;
    const existing = new Set(
      nodes
        .filter(
          (node) =>
            node.workflowSourceRunId === detail.runId && node.parentIds?.includes(source.id),
        )
        .map((node) => node.workflowSourcePortId),
    );
    const created: CanvasNode[] = [];
    for (const output of detail.outputs) {
      if (!output || typeof output.portId !== 'string' || existing.has(output.portId)) continue;
      existing.add(output.portId);
      const type =
        output.mediaKind === 'video'
          ? 'Upload Video'
          : output.mediaKind === 'audio'
            ? 'Upload Audio'
            : ['image', 'mask'].includes(output.mediaKind)
              ? 'Upload Image'
              : 'Text';
      const value =
        typeof output.value === 'string'
          ? output.value
          : output.value === undefined
            ? ''
            : JSON.stringify(output.value, null, 2);
      created.push({
        id: runtime.createId(),
        type,
        x: source.x + runtime.getWidth(source) + 180,
        y: source.y + created.length * 360,
        title: output.label || '工作流结果',
        prompt: value || source.title || '',
        textContent: type === 'Text' ? value : undefined,
        status: 'success',
        progress: 100,
        resultUrl: typeof output.url === 'string' ? output.url : undefined,
        parentIds: [source.id],
        sourcePortIndices: [
          Number.isInteger(output.portIndex) && Number(output.portIndex) >= 0
            ? Number(output.portIndex)
            : 0,
        ],
        workflowSourceRunId: detail.runId,
        workflowSourcePortId: output.portId,
        model: source.title || 'ComfyUI 工作流',
        projectId: source.projectId,
      });
    }
    if (!created.length) return;
    const after = [...nodes, ...created];
    store.setNodes(after);
    store.setSelected(created.map((node) => node.id));
    capture(after, source.id);
  });
  return () => {
    listeners.forEach((listener, name) => window.removeEventListener(name, listener));
    frames.forEach(cancelAnimationFrame);
  };
}

export function useCanvasNodes(hooks: Hooks, runtime: StateRuntime) {
  const [nodes, publishNodes] = hooks.useState<CanvasNode[]>([]);
  const current = hooks.useRef(nodes);
  const [selectedNodeIds, setSelectedNodeIds] = hooks.useState<string[]>([]);
  const setNodes = hooks.useCallback<Setter<CanvasNode[]>>((update) => {
    const next = typeof update === 'function' ? update(current.current) : update;
    current.current = next;
    publishNodes(next);
  }, []);
  const getNodes = hooks.useCallback(() => current.current, []);
  const operations = createNodeOperations({ nodes, setNodes, setSelectedNodeIds }, runtime);
  const menu = createNodeMenuOperations(
    { nodes, setNodes, setSelectedNodeIds, ...operations },
    runtime,
  );
  const layout = runtime.layout({ nodes, setNodes, selectedNodeIds });
  const getWidth = runtime.getWidth,
    createId = runtime.createId;
  hooks.useEffect(
    () =>
      attachWorkflowNodeEvents(
        { getNodes, setNodes, setSelected: setSelectedNodeIds },
        { getWidth, createId },
      ),
    [getNodes, setNodes, getWidth, createId],
  );
  const selectedId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;
  const networkUrl = nodes.find((node) => node.id === selectedId)?.networkUrl;
  hooks.useEffect(() => {
    if (!selectedId || typeof networkUrl !== 'string' || !networkUrl) return;
    const controller = new AbortController();
    void fetch('/api/verify-tos-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ networkUrl }),
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!controller.signal.aborted && result?.exists === false)
          setNodes((latest) =>
            latest.map((node) =>
              node.id === selectedId && node.networkUrl === networkUrl
                ? { ...node, networkUrl: undefined }
                : node,
            ),
          );
      })
      .catch(() => {
        /* Verification failure is not evidence that an asset has expired. */
      });
    return () => controller.abort();
  }, [selectedId, networkUrl, setNodes]);
  return {
    nodes,
    setNodes,
    getNodes,
    selectedNodeIds,
    configureAgentNode: (nodes: CanvasNode[], id: string, patch: Partial<CanvasNode>) => updateCanvasNode(nodes, id, patch, runtime),
    createAgentNode: (type: string, point: { x: number; y: number }, projectId: string) => createCanvasNode(runtime, type, point, projectId),
    connectAgentNodes: (nodes: CanvasNode[], sourceId: string, targetId: string, sourcePort?: number) => connectNewCanvasNode(nodes, sourceId, targetId, runtime, sourcePort),
    setSelectedNodeIds,
    ...operations,
    ...menu,
    ...layout,
    clearSelection: () => setSelectedNodeIds([]),
  };
}
