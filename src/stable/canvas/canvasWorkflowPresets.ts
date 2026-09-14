import { remapCanvasNodeReferences } from './canvasNodeReferences';
import type * as React from 'react';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { CanvasViewport } from './canvasNavigation';
import {
  collectWorkflowPresetComposition,
  canCreateWorkflowPresetComposition,
} from './workflowPresetComposition';
import { interruptedMediaNode } from '../media/mediaOperationRecovery';

type Hooks = Pick<typeof React, 'useState' | 'useRef' | 'useEffect'>;
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
interface PresetOptions {
  nodes: CanvasNode[];
  getNodes: () => CanvasNode[];
  selectedNodeIds: string[];
  viewport: CanvasViewport;
  projectId?: string;
  enabled: boolean;
  setNodes: Setter<CanvasNode[]>;
  setSelectedNodeIds: Setter<string[]>;
  closeWorkflowPresetPanel: () => void;
}
interface PresetRuntime {
  width: (node: CanvasNode) => number;
  height: (node: CanvasNode) => number;
  capture: (element: HTMLElement, options: Record<string, unknown>) => Promise<string>;
}
const categories = ['基础 SKILL', '图像 SKILL', '视频 SKILL', '音频 SKILL', '组合 SKILL', '其他'];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const nameFor = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(
      /\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm|m4v|mkv|mp3|wav|m4a|ogg|aac|flac)(?=工作流?$|$)/i,
      '',
    ) || '节点组合';
function bounds(nodes: CanvasNode[], runtime: Pick<PresetRuntime, 'width' | 'height'>) {
  const minX = Math.min(...nodes.map((node) => node.x)),
    minY = Math.min(...nodes.map((node) => node.y));
  return {
    minX,
    minY,
    width: Math.max(...nodes.map((node) => node.x + runtime.width(node))) - minX,
    height: Math.max(...nodes.map((node) => node.y + runtime.height(node))) - minY,
  };
}
export async function capturePresetCover(
  nodes: CanvasNode[],
  viewport: CanvasViewport,
  runtime: PresetRuntime,
) {
  const element = document.getElementById('canvas-viewport-content');
  if (!nodes.length || !(element instanceof HTMLElement)) return '';
  const ids = new Set(nodes.map((node) => node.id)),
    edges = new Set<string>();
  for (const node of nodes)
    for (const [index, parent] of (node.parentIds ?? []).entries())
      if (ids.has(parent)) edges.add(`${parent}-${node.id}-${index}`);
  const area = bounds(nodes, runtime),
    padding = 48;
  const origin = {
    x: Math.floor(area.minX * viewport.zoom + viewport.x - padding),
    y: Math.floor(area.minY * viewport.zoom + viewport.y - padding),
  };
  const width = Math.max(1, Math.ceil(area.width * viewport.zoom + padding * 2)),
    height = Math.max(1, Math.ceil(area.height * viewport.zoom + padding * 2));
  const largest = Math.max(width, height),
    target = Math.min(960, Math.max(360, largest));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const capture = runtime.capture(element, {
      cacheBust: true,
      pixelRatio: Math.min(2, target / largest),
      backgroundColor: '#0d0d0d',
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${viewport.x - origin.x}px, ${viewport.y - origin.y}px, 0) scale(${viewport.zoom})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        willChange: 'auto',
      },
      filter: (candidate: Node) => {
        if (!(candidate instanceof Element)) return true;
        if (candidate.closest('[data-selection-bounding-box="true"]')) return false;
        if (
          candidate.hasAttribute('data-canvas-grid-background') ||
          candidate.id === 'canvas-viewport-content' ||
          candidate.tagName.toLowerCase() === 'svg' ||
          candidate.hasAttribute('data-canvas-nodes-layer')
        )
          return true;
        const node = candidate.closest('[data-node-id]');
        if (node) return ids.has(node.getAttribute('data-node-id') || '');
        const edge = candidate.closest('[data-edge-key]');
        return !!edge && edges.has(edge.getAttribute('data-edge-key') || '');
      },
    });
    return await Promise.race([
      capture,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(''), 5000);
      }),
    ]);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** A preset is a fresh graph: remap every known reference, preserve fixed input holes,
 * and never borrow an in-flight task identity from the original project. */
export function instantiateWorkflowPreset(
  input: unknown,
  projectId: string | undefined,
  center: { x: number; y: number },
  runtime: Pick<PresetRuntime, 'width' | 'height'>,
  createId: () => string = () => crypto.randomUUID(),
): CanvasNode[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('工作流内容为空');
  const nodes = copy(input) as CanvasNode[];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (
      !node ||
      typeof node.id !== 'string' ||
      !node.id ||
      ids.has(node.id) ||
      typeof node.type !== 'string' ||
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y)
    )
      throw new Error('工作流节点数据无效');
    ids.add(node.id);
  }
  const area = bounds(nodes, runtime),
    translation = {
      x: center.x - area.minX - area.width / 2,
      y: center.y - area.minY - area.height / 2,
    };
  const idMap = new Map(nodes.map((node) => [node.id, createId()]));
  return nodes.map((source) => {
    const node = interruptedMediaNode(source);
    const parents = Array.isArray(node.parentIds) ? node.parentIds : [];
    const indexed = node.type === 'ComfyUI' || node.kind === 'workflow';
    const indices = parents
      .map((_, index) => index)
      .filter((index) => indexed || idMap.has(parents[index]));
    const result: CanvasNode = {
      ...node,
      id: idMap.get(node.id)!,
      projectId,
      groupId: undefined,
      x: node.x + translation.x,
      y: node.y + translation.y,
      parentIds: indices.map((index) => idMap.get(parents[index]) || ''),
      sourcePortIndices: Array.isArray(node.sourcePortIndices)
        ? indices.map((index) =>
            idMap.has(parents[index]) ? (node.sourcePortIndices![index] ?? 0) : 0,
          )
        : undefined,
      ...remapCanvasNodeReferences(node, id => idMap.get(id)),
      generationAttemptId: undefined,
      localWorkflowOperationId: undefined,
      generationStartedAt: undefined,
      generationStartTime: undefined,
      generationDiagnosticCode: undefined,
      executionState: node.kind === 'workflow' ? { status: 'idle' } : node.executionState,
      status:
        node.status === 'loading' || node.status === 'queued'
          ? node.resultUrl
            ? 'success'
            : 'idle'
          : node.status || 'success',
    };
    return result;
  });
}

export function useCanvasWorkflowPresets(
  hooks: Hooks,
  options: PresetOptions,
  runtime: PresetRuntime,
) {
  const live = hooks.useRef(options);
  live.current = options;
  const epochRef = hooks.useRef(0);
  const [isOpen, setOpen] = hooks.useState(false),
    [cover, setCover] = hooks.useState('');
  const [snapshot, setSnapshot] = hooks.useState<CanvasNode[]>([]),
    [knownCategories, setCategories] = hooks.useState(categories);
  hooks.useEffect(() => {
    epochRef.current++;
    setOpen(false);
    setSnapshot([]);
    setCover('');
    return () => {
      epochRef.current++;
    };
  }, [options.enabled, options.projectId]);
  const valid = (epoch: number, projectId: string | undefined) =>
    epoch === epochRef.current && live.current.enabled && live.current.projectId === projectId;
  const selected = collectWorkflowPresetComposition(options.nodes, options.selectedNodeIds);
  return {
    isCreateWorkflowPresetModalOpen: isOpen,
    setIsCreateWorkflowPresetModalOpen: (value: React.SetStateAction<boolean>) => {
      epochRef.current++;
      setOpen(value);
    },
    workflowPresetCoverUrl: cover,
    workflowPresetCategories: knownCategories,
    workflowPresetDefaultName: selected.length
      ? nameFor(selected[0].title || selected[0].prompt || '节点组合')
      : '我的工作流',
    canCreateWorkflowPreset: canCreateWorkflowPresetComposition(
      options.nodes,
      options.selectedNodeIds,
    ),
    async handleOpenCreateWorkflowPreset() {
      const current = live.current;
      if (
        !current.enabled ||
        !canCreateWorkflowPresetComposition(current.getNodes(), current.selectedNodeIds)
      )
        return;
      const nodes = copy(
        collectWorkflowPresetComposition(current.getNodes(), current.selectedNodeIds),
      );
      const epoch = ++epochRef.current,
        projectId = current.projectId;
      setSnapshot(nodes);
      setCover('');
      const categoryRequest = fetch('/api/library/workflows', {
        signal: AbortSignal.timeout(5000),
      }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (valid(epoch, projectId) && Array.isArray(data))
          setCategories([
            ...new Set([
              ...categories,
              ...data.map((item) => String(item.category || '').trim()).filter(Boolean),
            ]),
          ]);
      });
      const previewRequest = capturePresetCover(nodes, current.viewport, runtime).then((url) => {
        if (valid(epoch, projectId)) setCover(url);
      });
      await Promise.allSettled([categoryRequest, previewRequest]);
      if (valid(epoch, projectId)) setOpen(true);
    },
    async handleSaveWorkflowPreset(name: string, category: string) {
      if (!live.current.enabled || !snapshot.length) return;
      const response = await fetch('/api/library/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, coverDataUrl: cover, nodes: snapshot }),
      });
      if (!response.ok) throw new Error('创建工作流失败');
    },
    async handleImportWorkflowPreset(preset: { id: string }) {
      const current = live.current;
      if (!current.enabled) return;
      const epoch = epochRef.current,
        projectId = current.projectId;
      const response = await fetch('/api/library/workflows/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preset.id, projectId }),
      });
      if (!response.ok) throw new Error('导入工作流失败');
      const data = await response.json();
      if (!valid(epoch, projectId)) return;
      const viewport = live.current.viewport;
      const nodes = instantiateWorkflowPreset(
        data.workflow?.nodes,
        projectId,
        {
          x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
          y: (window.innerHeight / 2 - viewport.y) / viewport.zoom,
        },
        runtime,
      );
      current.setNodes((existing) => [...existing, ...nodes]);
      current.setSelectedNodeIds(nodes.map((node) => node.id));
      current.closeWorkflowPresetPanel();
    },
  };
}
