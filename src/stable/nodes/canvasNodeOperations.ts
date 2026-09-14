import type { Dispatch, SetStateAction } from 'react';
import { installNodeFramework } from './nodeFramework';
import { newNodeDimensions } from './nodeCreationDimensions';
import { installStableCanvasClipboard } from '../canvas/canvasClipboard';
import { connectCanvasNodes, type CanvasConnectionNode } from '../canvas/canvasConnections';
import type { CanvasViewport } from '../canvas/canvasNavigation';

export interface CanvasNode extends CanvasConnectionNode {
  x: number;
  y: number;
  kind?: string;
  comfyMode?: string;
  videoModel?: string;
  videoMode?: string;
}
interface Model {
  name: string;
  imageModes?: { value: string }[];
  videoModes?: { value: string }[];
  audioModes?: { value: string }[];
  languageModes?: { value: string }[];
  aspectRatios?: string[];
  resolutions?: string[];
}
export interface NodeRuntime {
  createId(): string;
  imageModels: Model[];
  videoModels: Model[];
  audioModels: Model[];
  textModels: Model[];
  templates: { id: string; inputs: { type: string }[] }[];
  mediaType(type: string): string;
  canConnect(
    source: CanvasNode,
    target: CanvasNode,
    nodes: CanvasNode[],
    port?: number,
  ): string | false | null;
  validateConnection(
    source: CanvasNode,
    target: CanvasNode,
    nodes: CanvasNode[],
    model?: string,
    mode?: string,
    port?: number,
  ): boolean;
}
export interface NodeOperationsOptions {
  nodes: CanvasNode[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
}
export interface NodeMenu {
  type: string;
  x: number;
  y: number;
  sourceNodeId?: string;
  sourceNodeIds?: string[];
  connectorSide?: 'left' | 'right';
  sourcePortIndex?: number;
}

/** Fresh media nodes use the project's last chosen dimensions, checked against their model. */
export function createCanvasNode(
  runtime: NodeRuntime,
  type: string,
  point: { x: number; y: number },
  projectId?: string,
): CanvasNode {
  const image = runtime.imageModels[0],
    video = runtime.videoModels[0];
  const audio = runtime.audioModels[0],
    text = runtime.textModels[0];
  const upload = ['Upload Image', 'Upload Video', 'Upload Audio'].includes(type);
  const model =
    type === 'Image'
      ? image
      : type === 'Video'
        ? video
        : type === 'Audio'
          ? audio
          : type === 'Text'
            ? text
            : undefined;
  const template = type === 'ComfyUI' ? runtime.templates[0] : undefined;
  const node = installNodeFramework().createFresh({
    id: runtime.createId(),
    type,
    ...point,
    prompt: '',
    status: upload ? 'success' : 'idle',
    model: model?.name ?? (type === 'ComfyUI' ? 'ComfyUI' : 'Upload'),
    imageModel: type === 'Image' ? image?.name : undefined,
    videoModel: type === 'Video' ? video?.name : undefined,
    audioModel: type === 'Audio' ? audio?.name : undefined,
    textModel: type === 'Text' ? text?.name : undefined,
    imageMode: type === 'Image' ? (image?.imageModes?.[0]?.value ?? 'text-to-image') : undefined,
    videoMode: type === 'Video' ? (video?.videoModes?.[0]?.value ?? 'text-to-video') : undefined,
    audioMode: type === 'Audio' ? (audio?.audioModes?.[0]?.value ?? 'instrumental') : undefined,
    textMode: type === 'Text' ? (text?.languageModes?.[0]?.value ?? 'multimodal-chat') : undefined,
    comfyMode: template?.id,
    isCameraUIOpen: type === 'ComfyUI' ? true : undefined,
    aspectRatio: type === 'Video' ? '16:9' : '1:1',
    resolution: type === 'Video' ? '720p' : '1K',
    parentIds: template ? template.inputs.map(() => '') : [],
    projectId: projectId || undefined,
  }) as CanvasNode;
  if (type === 'Image' || type === 'Video') {
    const models = type === 'Image' ? runtime.imageModels : runtime.videoModels;
    const selectedModel = models.find((entry) => entry.name === node.model);
    Object.assign(node, newNodeDimensions(type, projectId, selectedModel));
  }
  return node;
}

export function updateCanvasNode(
  nodes: CanvasNode[],
  id: string,
  patch: Partial<CanvasNode>,
  runtime: NodeRuntime,
): CanvasNode[] {
  const original = nodes.find((node) => node.id === id);
  if (!original) return nodes;
  const updated = { ...original, ...patch };
  if (updated.type === 'ComfyUI' && patch.comfyMode) {
    const template = runtime.templates.find((item) => item.id === patch.comfyMode);
    if (template) {
      updated.parentIds = template.inputs.map((_, index) => updated.parentIds?.[index] ?? '');
      updated.sourcePortIndices = template.inputs.map(
        (_, index) => updated.sourcePortIndices?.[index] ?? 0,
      );
    }
    if (patch.comfyMode === 'adjust-angle') updated.isCameraUIOpen = true;
  }
  if (
    patch.imageModel ||
    patch.videoModel ||
    patch.imageMode ||
    patch.videoMode ||
    patch.audioModel || patch.audioMode || patch.textModel || patch.languageMode || patch.textMode ||
    patch.comfyMode
  ) {
    const parents: string[] = [],
      ports: number[] = [];
    const indexed = updated.type === 'ComfyUI';
    const currentNodes = nodes.map((node) => (node.id === id ? updated : node));
    for (const [index, parentId] of (updated.parentIds ?? []).entries()) {
      const parent = currentNodes.find((node) => node.id === parentId);
      const sourcePort = updated.sourcePortIndices?.[index] ?? 0;
      const candidate = indexed
        ? updated
        : { ...updated, parentIds: parents, sourcePortIndices: ports };
      const valid =
        parent &&
        runtime.validateConnection(
          parent.kind === 'workflow' ? { ...parent, __fisherSourcePort: sourcePort } : parent,
          candidate,
          currentNodes,
          updated[`${updated.type.toLowerCase()}Model`] as string | undefined,
          (updated.type === 'Text' ? updated.languageMode || updated.textMode : updated[`${updated.type.toLowerCase()}Mode`] || updated.comfyMode) as string | undefined,
          indexed ? index : undefined,
        );
      if (valid || indexed) {
        parents.push(valid ? parentId : '');
        ports.push(valid ? sourcePort : 0);
      }
    }
    updated.parentIds = parents;
    if (updated.sourcePortIndices !== undefined || indexed) updated.sourcePortIndices = ports;
  }
  return nodes.map((node) => (node.id === id ? updated : node));
}

function worldPoint(x: number, y: number, viewport: CanvasViewport) {
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return undefined;
  const point = { x: (x - viewport.x) / viewport.zoom, y: (y - viewport.y) / viewport.zoom };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}

export function createNodeOperations(options: NodeOperationsOptions, runtime: NodeRuntime) {
  const clipboard = installStableCanvasClipboard();
  const { setNodes, setSelectedNodeIds } = options;
  const addNode = (
    type: string,
    x: number,
    y: number,
    parentId: string | undefined,
    viewport: CanvasViewport,
    projectId?: string,
  ) => {
    const point = worldPoint(x, y, viewport);
    if (!point) return undefined;
    const created = createCanvasNode(runtime, type, point, projectId);
    setNodes((nodes) => {
      const parent = nodes.find((node) => node.id === parentId);
      if (parent) {
        if (created.type === 'ComfyUI') {
          if (created.parentIds?.length) created.parentIds[0] = parent.id;
        } else created.parentIds = [parent.id];
        if (created.type === 'Image Compare') {
          created.aspectRatio = parent.aspectRatio || '1:1';
          created.resultAspectRatio = parent.resultAspectRatio;
        }
      }
      return [...nodes, created];
    });
    setSelectedNodeIds([created.id]);
    return created.id;
  };
  const deleteNode = (id: string) => {
    setNodes((nodes) => clipboard.delete(nodes, [id]));
    setSelectedNodeIds((ids) => ids.filter((candidate) => candidate !== id));
  };
  const deleteNodes = (ids: string[]) => {
    setNodes((nodes) => clipboard.delete(nodes, ids));
    setSelectedNodeIds([]);
  };
  return {
    addNode,
    deleteNode,
    deleteNodes,
    updateNode: (id: string, patch: Partial<CanvasNode>) =>
      setNodes((nodes) => updateCanvasNode(nodes, id, patch, runtime)),
  };
}

/** New-node connections validate against each preceding insertion, including occupied slots. */
export function connectNewCanvasNode(
  nodes: CanvasNode[],
  sourceId: string,
  targetId: string,
  runtime: NodeRuntime,
  sourcePort = 0,
): CanvasNode[] {
  const source = nodes.find((node) => node.id === sourceId),
    target = nodes.find((node) => node.id === targetId);
  if (!source || !target) return nodes;
  let port: number | undefined, count: number | undefined;
  if (target.kind === 'workflow') {
    const workflow = window.__FISHERAI_WORKFLOW_NODES__;
    if (!workflow) return nodes;
    port = workflow.resolveAvailableInputSlot(target, source, sourcePort);
    if (port < 0 || !workflow.canConnect(target, source, port, sourcePort)) return nodes;
    count = workflow.getInputCapacity(target);
  } else if (target.type === 'ComfyUI') {
    const template =
      runtime.templates.find((item) => item.id === target.comfyMode) ?? runtime.templates[0];
    if (!template) return nodes;
    const media = runtime.mediaType(source.type);
    port = template.inputs.findIndex(
      (slot, index) => !target.parentIds?.[index] && (slot.type === 'any' || slot.type === media),
    );
    if (port < 0) return nodes;
    count = template.inputs.length;
  }
  const mode = runtime.canConnect(
    source.kind === 'workflow' ? { ...source, __fisherSourcePort: sourcePort } : source,
    target,
    nodes,
    port,
  );
  if (!mode) return nodes;
  if (target.type === 'Image Compare' && (target.parentIds?.length ?? 0) >= 2) return nodes;
  if (target.type === 'Image Composite' && (target.parentIds?.length ?? 0) >= 10) return nodes;
  return connectCanvasNodes(nodes, {
    parentId: sourceId,
    childId: targetId,
    sourcePortIndex: sourcePort,
    portIndex: port,
    inputCount: count,
    connectionMode: mode === 'default' ? undefined : mode,
    modeField:
      target.type === 'Image' ? 'imageMode' : target.type === 'Video' ? 'videoMode' : undefined,
  });
}

export function createNodeMenuOperations(
  options: NodeOperationsOptions & ReturnType<typeof createNodeOperations>,
  runtime: NodeRuntime,
) {
  return {
    handleSelectTypeFromMenu: (
      type: string,
      menu: NodeMenu,
      viewport: CanvasViewport,
      close: () => void,
      projectId?: string,
    ) => {
      if (type === 'DELETE') {
        if (menu.sourceNodeId) options.deleteNode(menu.sourceNodeId);
        close();
        return;
      }
      if (!['node-connector', 'add-nodes'].includes(menu.type) || !menu.sourceNodeId) {
        options.addNode(type, menu.x, menu.y, undefined, viewport, projectId);
        close();
        return;
      }
      const point = worldPoint(menu.x, menu.y, viewport);
      if (!point) {
        close();
        return;
      }
      const created = createCanvasNode(runtime, type, point, projectId);
      const ids = [
        ...new Set(menu.sourceNodeIds?.length ? menu.sourceNodeIds : [menu.sourceNodeId]),
      ];
      options.setNodes((nodes) => {
        const sources = ids.filter((id) => nodes.some((node) => node.id === id));
        if (!sources.length) return nodes;
        let next = [...nodes, created];
        const firstSource = nodes.find((node) => node.id === sources[0]);
        if (
          menu.connectorSide !== 'left' &&
          created.type === 'Image Composite' &&
          firstSource &&
          runtime.mediaType(firstSource.type) === 'image'
        ) {
          created.aspectRatio = firstSource.aspectRatio || '1:1';
          created.resultAspectRatio = firstSource.resultAspectRatio;
        }
        for (const id of sources)
          next =
            menu.connectorSide === 'left'
              ? connectNewCanvasNode(next, created.id, id, runtime)
              : connectNewCanvasNode(next, id, created.id, runtime, menu.sourcePortIndex ?? 0);
        return next;
      });
      options.setSelectedNodeIds([created.id]);
      close();
    },
  };
}
