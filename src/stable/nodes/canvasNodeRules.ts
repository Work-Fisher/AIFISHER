import type { CanvasNode } from './canvasNodeOperations';
import { adaptiveMediaNodeSize, videoDisplayAspectRatio } from '../media/mediaNodeSizing';

export const nodeTypes = {
  TEXT: 'Text',
  IMAGE: 'Image',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  UPLOAD_IMAGE: 'Upload Image',
  UPLOAD_VIDEO: 'Upload Video',
  UPLOAD_AUDIO: 'Upload Audio',
  IMAGE_COMPARE: 'Image Compare',
  IMAGE_COMPOSITE: 'Image Composite',
  COMFYUI: 'ComfyUI',
};
export const nodeStatuses = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
};
export const portHeight = 26,
  portGap = 8,
  legacyWorkflowWidth = 240;
export const legacyWorkflowPortTop = () => 1 + 36 + 12 + 2 * (36 + 12);
interface Parameter {
  id: string;
  label: string;
  type: string;
  default?: unknown;
  options?: Array<{ value: string | number; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  children?: Parameter[];
}
export interface WorkflowTemplate {
  id: string;
  label: string;
  category: string;
  inputs: Array<{ id: string; label: string; type: string }>;
  outputs: Array<{ id: string; label: string; type: string }>;
  parameters: Parameter[];
}
/** Only the dedicated legacy MiniMax node is creatable; imported workflows own their schemas. */
export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: 'minimax-h3-t2va',
    label: 'MiniMax H3 本地音视频',
    category: 'MiniMax H3',
    inputs: [
      { id: 'text', label: '提示词', type: 'text' },
      { id: 'firstFrame', label: '首帧', type: 'image' },
      { id: 'lastFrame', label: '尾帧', type: 'image' },
      ...(['image', 'video', 'audio'] as const).flatMap((type) =>
        Array.from({ length: type === 'image' ? 9 : 3 }, (_, index) => ({
          id: `reference${type[0].toUpperCase()}${type.slice(1)}${index + 1}`,
          label: `参考${{ image: '图片', video: '视频', audio: '音频' }[type]}${index + 1}`,
          type,
        })),
      ),
    ],
    outputs: [{ id: 'video', label: '音视频', type: 'video' }],
    parameters: [
      {
        id: 'aspectRatio',
        label: '画面比例',
        type: 'select',
        default: '16:9',
        options: [
          { value: '16:9', label: '横屏 16:9' },
          { value: '9:16', label: '竖屏 9:16' },
          { value: '1:1', label: '方形 1:1' },
          { value: '4:3', label: '标准 4:3' },
          { value: '3:4', label: '竖幅 3:4' },
          { value: '21:9', label: '超宽 21:9' },
        ],
      },
      {
        id: 'megapixels',
        label: '像素规模',
        type: 'select',
        default: 0.4,
        options: [
          { value: 0.1, label: '0.1 MP · 草稿' },
          { value: 0.2, label: '0.2 MP · 快速' },
          { value: 0.4, label: '0.4 MP · 864×480 级' },
          { value: 0.6, label: '0.6 MP · 高清' },
          { value: 1, label: '1.0 MP · 高质量' },
        ],
      },
      { id: 'duration', label: '时长（秒）', type: 'number', default: 8, min: 1, max: 60, step: 1 },
      {
        id: 'seed',
        label: '随机种子',
        type: 'number',
        default: 1,
        min: 0,
        max: 4294967295,
        step: 1,
      },
    ],
  },
];

function positive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
function ratio(value: unknown, separator: string) {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(separator);
  const width = positive(parts[0]),
    height = positive(parts[1]);
  return parts.length === 2 && width && height ? positive(width / height) : undefined;
}
export function nodeAspectRatio(node: CanvasNode, parent?: CanvasNode): number {
  if (node.type === 'Video') return videoDisplayAspectRatio(node);
  return (
    ratio(node.resultAspectRatio, '/') ??
    ratio(node.aspectRatio, ':') ??
    (parent && ['Image', 'Upload Image'].includes(parent.type)
      ? ratio(parent.resultAspectRatio, '/')
      : undefined) ??
    (['Video', 'Upload Video'].includes(node.type)
      ? 16 / 9
      : ['Audio', 'Upload Audio'].includes(node.type)
        ? 4
        : 1)
  );
}
export function workflowParameterHeight(
  parameters: Parameter[],
  node: CanvasNode,
  gap = 8,
): number {
  return parameters.reduce((height, parameter, index) => {
    let row = parameter.type === 'info' ? 120 : 32;
    if (
      parameter.type === 'group' &&
      (node[`__expanded_${parameter.id}`] ?? parameter.default) &&
      parameter.children?.length
    )
      row += 4 + workflowParameterHeight(parameter.children, node, 10) + 8;
    return height + row + (index < parameters.length - 1 ? gap : 0);
  }, 0);
}
export function legacyWorkflowHeight(node: CanvasNode) {
  const template =
    workflowTemplates.find((item) => item.id === node.comfyMode) ?? workflowTemplates[0];
  const ports = Math.max(template.inputs.length, template.outputs.length);
  return (
    legacyWorkflowPortTop() +
    (ports ? ports * portHeight + (ports - 1) * portGap + 12 : 0) +
    (template.parameters.length ? workflowParameterHeight(template.parameters, node) + 12 : 0) +
    1 +
    8 +
    44 +
    20 +
    1
  );
}
export function nodeWidth(node: CanvasNode, parent?: CanvasNode): number {
  const media = adaptiveMediaNodeSize(node);
  if (media) return media.width;
  const stored = positive(node.width);
  if (stored) return stored;
  if (node.type === 'Text') return 252;
  if (['Audio', 'Upload Audio'].includes(node.type)) return 365;
  if (node.type === 'ComfyUI')
    return node.kind === 'workflow'
      ? (positive(window.__FISHERAI_WORKFLOW_NODES__?.getNodeSize(node).width) ?? 520)
      : node.comfyMode === 'minimax-h3-t2va'
        ? 900
        : legacyWorkflowWidth;
  return 252 * Math.max(1, nodeAspectRatio(node, parent));
}
export function nodeHeight(node: CanvasNode, parent?: CanvasNode): number {
  // Dynamic workflow measurement must supersede a height saved before its parameters changed.
  if (node.type === 'ComfyUI' && node.kind === 'workflow')
    return (
      positive(window.__FISHERAI_WORKFLOW_NODES__?.getNodeSize(node).height) ??
      positive(node.height) ??
      520
    );
  const media = adaptiveMediaNodeSize(node);
  if (media) return media.height;
  const stored = positive(node.height);
  if (stored) return stored;
  if (node.type === 'Text') return node.isPromptExpanded ? 480 : 252;
  if (['Audio', 'Upload Audio'].includes(node.type)) return 112;
  if (node.type === 'ComfyUI')
    return node.comfyMode === 'minimax-h3-t2va' ? 680 : legacyWorkflowHeight(node);
  return 252 / Math.min(1, nodeAspectRatio(node, parent));
}
export function legacyPortY(_node: CanvasNode, _side: string, index = 0) {
  return legacyWorkflowPortTop() + index * (portHeight + portGap) + portHeight / 2;
}
export function nodePortX(node: CanvasNode, side: 'left' | 'right', width: number) {
  return node.type === 'ComfyUI' && node.comfyMode === 'minimax-h3-t2va'
    ? node.x + width / 2 + (side === 'left' ? -241 : 241)
    : node.x + (side === 'right' ? width : 0);
}
export function nodePortY(node: CanvasNode, side: 'left' | 'right', index: number, height: number) {
  if (node.kind === 'workflow')
    return (
      node.y +
      (side === 'left'
        ? (window.__FISHERAI_WORKFLOW_NODES__?.getInputPortY(node, index) ?? height / 2)
        : (window.__FISHERAI_WORKFLOW_NODES__?.getOutputPortY(node, index) ?? height / 2))
    );
  if (node.type === 'ComfyUI' && node.comfyMode === 'minimax-h3-t2va')
    return (
      node.y +
      (side === 'left' ? (window.__FISHERAI_MINIMAX_H3__?.getPortY(node, index) ?? 500) : 201)
    );
  return node.y + (node.type === 'ComfyUI' ? legacyPortY(node, side, index) : height / 2);
}

export type MediaKind = 'text' | 'image' | 'video' | 'audio' | 'mask' | 'json' | 'other';
export function nodeMediaKind(value: CanvasNode | string): MediaKind {
  if (typeof value !== 'string' && value.kind === 'workflow')
    return (
      window.__FISHERAI_WORKFLOW_NODES__?.getOutputMediaKind(
        value,
        Number(value.__fisherSourcePort ?? 0),
      ) || 'other'
    );
  const type = typeof value === 'string' ? value : value.type;
  if (type === 'Text') return 'text';
  if (['Image', 'Upload Image', 'Image Compare', 'Image Composite', 'ComfyUI'].includes(type))
    return 'image';
  if (['Video', 'Upload Video'].includes(type)) return 'video';
  if (['Audio', 'Upload Audio'].includes(type)) return 'audio';
  return 'other';
}
interface Mode {
  value: string;
  allowedInputs?: Partial<Record<MediaKind, number>>;
}
interface Model {
  name: string;
  maxInputs?: number;
  imageModes?: Mode[];
  videoModes?: Mode[];
  languageModes?: Mode[];
  audioModes?: Mode[];
}
export interface ModelCatalog {
  image: Model[];
  video: Model[];
  text: Model[];
  audio: Model[];
}
function targetModel(node: CanvasNode, catalog: ModelCatalog, override?: string) {
  const kind = ['Image', 'Upload Image'].includes(node.type)
    ? 'image'
    : ['Video', 'Upload Video'].includes(node.type)
      ? 'video'
      : node.type === 'Text'
        ? 'text'
        : ['Audio', 'Upload Audio'].includes(node.type)
          ? 'audio'
          : undefined;
  if (!kind) return undefined;
  const model = catalog[kind].find(
    (item) => item.name === (override || node[`${kind}Model`] || node.model),
  );
  const modes =
    (kind === 'image'
      ? model?.imageModes
      : kind === 'video'
        ? model?.videoModes
        : kind === 'text'
          ? model?.languageModes
          : model?.audioModes) || [];
  return {
    model,
    modes,
    mode: (kind === 'text' ? node.languageMode || node.textMode : node[`${kind}Mode`]) as string | undefined,
    defaultMode: {
      image: 'text-to-image',
      video: 'text-to-video',
      text: 'multimodal-chat',
      audio: 'instrumental',
    }[kind],
  };
}
export function validateConnection(
  source: CanvasNode,
  target: CanvasNode,
  nodes: CanvasNode[],
  modelOverride: string | undefined,
  modeOverride: string | undefined,
  port: number | undefined,
  catalog: ModelCatalog,
): boolean {
  if (!source || !target || source.id === target.id || source.parentIds?.includes(target.id))
    return false;
  const kind = nodeMediaKind(source);
  const parents = (target.parentIds || []).filter((id) => id !== source.id);
  if (['Image Compare', 'Image Composite'].includes(target.type))
    return (
      kind === 'image' &&
      parents.filter(Boolean).length < (target.type === 'Image Compare' ? 2 : 10)
    );
  if (target.type === 'ComfyUI') {
    if (target.kind === 'workflow')
      return (
        window.__FISHERAI_WORKFLOW_NODES__?.canConnect(
          target,
          source,
          port ?? 0,
          Number(source.__fisherSourcePort ?? 0),
        ) ?? false
      );
    const template = workflowTemplates.find(
      (item) => item.id === (modeOverride || target.comfyMode || workflowTemplates[0].id),
    );
    if (!template) return false;
    if (port !== undefined && port !== null) {
      const slot = template.inputs[port];
      return !!slot && (slot.type === 'any' || slot.type === kind);
    }
    const occupied = parents.filter(Boolean),
      capacity = template.inputs.length;
    if (occupied.length >= capacity) return false;
    if ((target.parentIds || []).some((id) => !id) || (target.parentIds || []).length < capacity)
      return true;
    const remaining = template.inputs.map((slot) => slot.type);
    for (const id of occupied) {
      const parent = nodes.find((node) => node.id === id);
      const matching = parent ? remaining.indexOf(nodeMediaKind(parent)) : -1;
      const any = remaining.indexOf('any');
      remaining.splice(matching >= 0 ? matching : any >= 0 ? any : 0, 1);
    }
    return remaining.includes('any') || remaining.includes(kind);
  }
  const targetConfig = targetModel(target, catalog, modelOverride);
  if (!targetConfig?.model) return true;
  const mode = targetConfig.modes.find(
    (item) => item.value === (modeOverride || targetConfig.mode || targetConfig.defaultMode),
  );
  if (!mode) return true;
  if (parents.length >= (targetConfig.model.maxInputs || 10)) return false;
  const allowed = mode.allowedInputs?.[kind];
  if (
    allowed === undefined ||
    parents.filter((id) => {
      const parent = nodes.find((node) => node.id === id);
      return parent && nodeMediaKind(parent) === kind;
    }).length >= allowed
  )
    return false;
  return kind !== 'video' || allowed <= 0 || !!source.networkUrl;
}
export function chooseConnectionMode(
  source: CanvasNode,
  target: CanvasNode,
  nodes: CanvasNode[],
  port: number | undefined,
  catalog: ModelCatalog,
): string | null {
  const validate = (mode?: string) =>
    validateConnection(source, target, nodes, undefined, mode, port, catalog);
  if (target.type === 'ComfyUI') {
    if (target.kind === 'workflow') return 'fisherai-workflow';
    const mode = target.comfyMode || workflowTemplates[0].id;
    return validate(mode) ? mode : null;
  }
  const config = targetModel(target, catalog);
  if (!config?.model || !config.modes.length) return validate() ? 'default' : null;
  const current = config.mode || config.modes[0].value;
  if (validate(current)) return current;
  return config.modes.find((mode) => mode.value !== current && validate(mode.value))?.value ?? null;
}
