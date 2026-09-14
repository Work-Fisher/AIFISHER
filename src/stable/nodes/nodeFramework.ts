export type NodeMediaType = 'text' | 'image' | 'video' | 'audio' | 'any';
export type NodeCategory = 'generation' | 'asset' | 'tool' | 'workflow';
export type NodeLifecycleStatus =
  'idle' | 'queued' | 'loading' | 'success' | 'error' | 'cancelled' | 'timed-out' | 'stale';

export interface PortDefinition {
  id: string;
  media: NodeMediaType[];
  required?: boolean;
  multiple?: boolean;
  maximum?: number;
}

export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  initialStatus: NodeLifecycleStatus;
}

export interface NodeResult {
  mediaType?: Exclude<NodeMediaType, 'any'>;
  url?: string;
  urls?: string[];
  text?: string;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface NodeResultRecord extends NodeResult {
  id: string;
  generationId: string;
}

export interface NodeParameterOption {
  label: string;
  value: string | number | boolean;
}

export interface ModelAdvancedParameter {
  key: string;
  label: string;
  type: 'select' | 'toggle' | 'number' | 'text';
  default?: unknown;
  options?: NodeParameterOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeModelCapability {
  name: string;
  maxInputs?: number;
  supportedReferenceTypes?: NodeMediaType[];
  resolutions?: string[];
  aspectRatios?: string[];
  advancedParams?: ModelAdvancedParameter[];
}

export interface NodeInputReference {
  id: string;
  slotId: string;
  media: Exclude<NodeMediaType, 'any'>;
}

export interface NodeInputIssue {
  code:
    | 'REQUIRED_INPUT_MISSING'
    | 'SLOT_CAPACITY_EXCEEDED'
    | 'SLOT_MEDIA_UNSUPPORTED'
    | 'MODEL_INPUT_LIMIT_EXCEEDED'
    | 'MODEL_MEDIA_UNSUPPORTED'
    | 'UNKNOWN_INPUT_SLOT';
  message: string;
  slotId?: string;
  inputId?: string;
}

export interface NodeInputValidation {
  valid: boolean;
  counts: Partial<Record<Exclude<NodeMediaType, 'any'>, number>>;
  issues: NodeInputIssue[];
}

export interface NodeParameterField {
  key: string;
  label: string;
  kind: 'model' | 'select' | 'ratio' | 'toggle' | 'number' | 'text';
  value: unknown;
  options?: NodeParameterOption[];
  min?: number;
  max?: number;
  step?: number;
  advanced?: boolean;
}

export interface StableNodeRecord {
  id: string;
  type: string;
  x: number;
  y: number;
  parentIds?: string[];
  [key: string]: unknown;
}

export interface NodeState extends StableNodeRecord {
  status?: NodeLifecycleStatus | (string & {});
  result?: NodeResult;
  errorMessage?: string;
  errorDetails?: { code: string; message: string; retryable: boolean };
  generationId?: string;
  generationQueuedAt?: number;
  generationStartedAt?: number;
  generationCompletedAt?: number;
  resultHistory?: NodeResultRecord[];
  activeResultId?: string;
  collapsed?: boolean;
}

export interface NodePresentation {
  width: number;
  height: number;
  expandedHeight: number;
  collapsed: boolean;
  preview: {
    kind: Exclude<NodeMediaType, 'any'> | 'none';
    source?: string;
    available: boolean;
  };
  error: {
    visible: boolean;
    code?: string;
    message?: string;
    retryable: boolean;
  };
}

export interface NodeGenerationUpdate {
  generationId: string;
  status: Exclude<NodeLifecycleStatus, 'idle' | 'queued'>;
  startedAt?: number;
  completedAt?: number;
  result?: NodeResult;
  error?: { code: string; message: string; retryable: boolean };
}

export interface NodeFrameworkAdapter {
  getDefinition(type: string): NodeDefinition | undefined;
  listDefinitions(): NodeDefinition[];
  register(definition: NodeDefinition): void;
  create(candidate: Record<string, unknown>): StableNodeRecord;
  createFresh(candidate: Record<string, unknown>): StableNodeRecord;
  validate(node: Record<string, unknown>): string[];
  buildParameterForm(options: {
    models: NodeModelCapability[];
    selectedModel?: string;
    values?: Record<string, unknown>;
  }): NodeParameterField[];
  validateInputs(options: {
    ports: PortDefinition[];
    inputs: NodeInputReference[];
    model?: NodeModelCapability;
  }): NodeInputValidation;
  beginGeneration(
    node: NodeState,
    options: {
      generationId: string;
      queuedAt?: number;
    },
  ): NodeState;
  updateGeneration(
    node: NodeState,
    update: NodeGenerationUpdate,
  ): {
    node: NodeState;
    applied: boolean;
  };
  selectResult(node: NodeState, resultId: string): NodeState;
  setCollapsed(node: NodeState, collapsed: boolean): NodeState;
  getPresentation(node: NodeState): NodePresentation;
  getDiagnostics(): { createCalls: number; validationFailures: number; definitionCount: number };
}

declare global {
  interface Window {
    __FISHERAI_NODE_FRAMEWORK__?: NodeFrameworkAdapter;
  }
}

const BASE_DEFINITIONS: readonly NodeDefinition[] = [
  {
    type: 'text',
    category: 'generation',
    inputs: [{ id: 'context', media: ['text', 'image', 'video', 'audio'], multiple: true }],
    outputs: [{ id: 'text', media: ['text'], multiple: true }],
    initialStatus: 'idle',
  },
  {
    type: 'image',
    category: 'generation',
    inputs: [{ id: 'references', media: ['text', 'image'], multiple: true }],
    outputs: [{ id: 'image', media: ['image'], multiple: true }],
    initialStatus: 'idle',
  },
  {
    type: 'video',
    category: 'generation',
    inputs: [{ id: 'references', media: ['text', 'image', 'video', 'audio'], multiple: true }],
    outputs: [{ id: 'video', media: ['video'], multiple: true }],
    initialStatus: 'idle',
  },
  {
    type: 'audio',
    category: 'generation',
    inputs: [{ id: 'references', media: ['text', 'audio'], multiple: true }],
    outputs: [{ id: 'audio', media: ['audio'], multiple: true }],
    initialStatus: 'idle',
  },
  ...(['upload-image', 'upload-video', 'upload-audio'] as const).map((type) => ({
    type,
    category: 'asset' as const,
    inputs: [],
    outputs: [
      {
        id: type.replace('upload-', ''),
        media: [type.replace('upload-', '') as NodeMediaType],
        multiple: true,
      },
    ],
    initialStatus: 'success' as const,
  })),
  {
    type: 'image-compare',
    category: 'tool',
    inputs: [{ id: 'images', media: ['image'], required: true, multiple: true, maximum: 2 }],
    outputs: [{ id: 'image', media: ['image'], multiple: true }],
    initialStatus: 'idle',
  },
  {
    type: 'image-composite',
    category: 'tool',
    inputs: [{ id: 'images', media: ['image'], required: true, multiple: true, maximum: 10 }],
    outputs: [{ id: 'image', media: ['image'], multiple: true }],
    initialStatus: 'idle',
  },
  {
    type: 'comfyui',
    category: 'workflow',
    inputs: [{ id: 'dynamic', media: ['any'], multiple: true }],
    outputs: [{ id: 'dynamic', media: ['any'], multiple: true }],
    initialStatus: 'idle',
  },
];

const STABLE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  Text: 'text',
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
  'Upload Image': 'upload-image',
  'Upload Video': 'upload-video',
  'Upload Audio': 'upload-audio',
  'Image Compare': 'image-compare',
  'Image Composite': 'image-composite',
  ComfyUI: 'comfyui',
};

const NATIVE_DEFAULT_IMAGE_MODEL = 'GPT Image 2';
const DEFAULT_CANVAS_IMAGE_MODEL = 'GPT Image 2 · API';
const DEFAULT_CANVAS_VIDEO_MODEL = 'Seedance 2.5 Standard · API';

function canonicalType(type: string): string {
  return STABLE_TYPE_ALIASES[type] ?? type;
}

function applyCanvasNodeDefaults(candidate: Record<string, unknown>): Record<string, unknown> {
  if (canonicalType(String(candidate.type ?? '')) !== 'image') return candidate;
  if (
    candidate.model !== NATIVE_DEFAULT_IMAGE_MODEL ||
    candidate.imageModel !== NATIVE_DEFAULT_IMAGE_MODEL
  ) {
    return candidate;
  }
  return {
    ...candidate,
    model: DEFAULT_CANVAS_IMAGE_MODEL,
    imageModel: DEFAULT_CANVAS_IMAGE_MODEL,
    resolution: candidate.resolution || '1K',
  };
}

function applyFreshCanvasNodeDefaults(candidate: Record<string, unknown>): Record<string, unknown> {
  const type = canonicalType(String(candidate.type ?? ''));
  if (type === 'image') {
    return {
      ...candidate,
      model: DEFAULT_CANVAS_IMAGE_MODEL,
      imageModel: DEFAULT_CANVAS_IMAGE_MODEL,
      resolution: '1K',
    };
  }
  if (type === 'video') {
    return {
      ...candidate,
      model: DEFAULT_CANVAS_VIDEO_MODEL,
      videoModel: DEFAULT_CANVAS_VIDEO_MODEL,
      resolution: '720p',
    };
  }
  return candidate;
}

function cloneDefinition(definition: NodeDefinition): NodeDefinition {
  return {
    ...definition,
    inputs: definition.inputs.map((port) => ({ ...port, media: [...port.media] })),
    outputs: definition.outputs.map((port) => ({ ...port, media: [...port.media] })),
  };
}

function cloneResult(result: NodeResult): NodeResult {
  return {
    mediaType: result.mediaType,
    url: result.url,
    urls: result.urls ? [...result.urls] : undefined,
    text: result.text,
    completedAt: result.completedAt,
    metadata: result.metadata ? { ...result.metadata } : undefined,
  };
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

const DEFAULT_NODE_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  text: [360, 300],
  image: [360, 420],
  video: [420, 360],
  audio: [360, 220],
};

export function createNodeFramework(): NodeFrameworkAdapter {
  const definitions = new Map(
    BASE_DEFINITIONS.map((definition) => [definition.type, cloneDefinition(definition)]),
  );
  let createCalls = 0;
  let validationFailures = 0;

  const adapter: NodeFrameworkAdapter = {
    getDefinition(type) {
      const definition = definitions.get(canonicalType(type));
      return definition ? cloneDefinition(definition) : undefined;
    },
    listDefinitions() {
      return [...definitions.values()].map(cloneDefinition);
    },
    register(definition) {
      definitions.set(definition.type, cloneDefinition(definition));
    },
    create(candidate) {
      createCalls += 1;
      const defaultedCandidate = applyCanvasNodeDefaults(candidate);
      const rawParentIds = Array.isArray(defaultedCandidate.parentIds)
        ? defaultedCandidate.parentIds
        : [];
      const indexed = defaultedCandidate.type === 'ComfyUI';
      const retainedIndices = rawParentIds.map((_, index) => index).filter((index) =>
        indexed || (typeof rawParentIds[index] === 'string' && rawParentIds[index].length > 0
          && rawParentIds.indexOf(rawParentIds[index]) === index));
      const parentIds = retainedIndices.map((index) =>
        typeof rawParentIds[index] === 'string' ? rawParentIds[index] : '');
      const rawSourcePorts = defaultedCandidate.sourcePortIndices;
      const sourcePortIndices = Array.isArray(rawSourcePorts)
        ? retainedIndices.map((index, position) => parentIds[position]
          ? Math.max(0, Math.trunc(Number(rawSourcePorts[index]) || 0)) : 0)
        : undefined;
      const node = {
        ...defaultedCandidate,
        id: typeof defaultedCandidate.id === 'string' ? defaultedCandidate.id : '',
        type: typeof defaultedCandidate.type === 'string' ? defaultedCandidate.type : '',
        x:
          typeof defaultedCandidate.x === 'number' && Number.isFinite(defaultedCandidate.x)
            ? defaultedCandidate.x
            : 0,
        y:
          typeof defaultedCandidate.y === 'number' && Number.isFinite(defaultedCandidate.y)
            ? defaultedCandidate.y
            : 0,
        ...(defaultedCandidate.parentIds === undefined ? {} : { parentIds }),
        ...(sourcePortIndices === undefined ? {} : { sourcePortIndices }),
      } as StableNodeRecord;
      if (adapter.validate(node).length > 0) validationFailures += 1;
      return node;
    },
    createFresh(candidate) {
      return adapter.create(applyFreshCanvasNodeDefaults(candidate));
    },
    validate(node) {
      const errors: string[] = [];
      if (typeof node.id !== 'string' || node.id.length === 0) errors.push('node id is required');
      if (typeof node.type !== 'string' || node.type.length === 0)
        errors.push('node type is required');
      else if (!definitions.has(canonicalType(node.type)))
        errors.push(`unknown node type: ${node.type}`);
      if (typeof node.x !== 'number' || !Number.isFinite(node.x))
        errors.push('node x must be finite');
      if (typeof node.y !== 'number' || !Number.isFinite(node.y))
        errors.push('node y must be finite');
      if (node.parentIds !== undefined && !Array.isArray(node.parentIds)) {
        errors.push('node parentIds must be an array');
      }
      return errors;
    },
    buildParameterForm({ models, selectedModel, values = {} }) {
      const selected = models.find((model) => model.name === selectedModel) ?? models[0];
      if (!selected) return [];
      const fields: NodeParameterField[] = [
        {
          key: 'model',
          label: '模型',
          kind: 'model',
          value: selected.name,
          options: models.map((model) => ({ label: model.name, value: model.name })),
        },
      ];
      if (selected.resolutions?.length) {
        fields.push({
          key: 'resolution',
          label: '尺寸',
          kind: 'select',
          value: selected.resolutions.includes(String(values.resolution))
            ? values.resolution
            : selected.resolutions[0],
          options: selected.resolutions.map((value) => ({ label: value, value })),
        });
      }
      if (selected.aspectRatios?.length) {
        fields.push({
          key: 'aspectRatio',
          label: '比例',
          kind: 'ratio',
          value: selected.aspectRatios.includes(String(values.aspectRatio))
            ? values.aspectRatio
            : selected.aspectRatios[0],
          options: selected.aspectRatios.map((value) => ({ label: value, value })),
        });
      }
      for (const parameter of selected.advancedParams ?? []) {
        const optionValues = parameter.options?.map((option) => option.value);
        const suppliedValue = values[parameter.key];
        const value =
          suppliedValue !== undefined &&
          (!optionValues || optionValues.includes(suppliedValue as never))
            ? suppliedValue
            : parameter.default;
        fields.push({
          key: parameter.key,
          label: parameter.label,
          kind: parameter.type,
          value,
          options: parameter.options?.map((option) => ({ ...option })),
          min: parameter.min,
          max: parameter.max,
          step: parameter.step,
          advanced: true,
        });
      }
      return fields;
    },
    validateInputs({ ports, inputs, model }) {
      const issues: NodeInputIssue[] = [];
      const portsById = new Map(ports.map((port) => [port.id, port]));
      const bySlot = new Map<string, NodeInputReference[]>();
      const counts: NodeInputValidation['counts'] = {};
      for (const input of inputs) {
        bySlot.set(input.slotId, [...(bySlot.get(input.slotId) ?? []), input]);
        counts[input.media] = (counts[input.media] ?? 0) + 1;
      }
      for (const port of ports) {
        const connected = bySlot.get(port.id) ?? [];
        if (port.required && connected.length === 0) {
          issues.push({
            code: 'REQUIRED_INPUT_MISSING',
            message: `必填输入 ${port.id} 尚未连接`,
            slotId: port.id,
          });
        }
        const maximum = port.multiple ? port.maximum : 1;
        if (maximum !== undefined && connected.length > maximum) {
          issues.push({
            code: 'SLOT_CAPACITY_EXCEEDED',
            message: `输入 ${port.id} 最多允许 ${maximum} 个连接`,
            slotId: port.id,
          });
        }
        for (const input of connected) {
          if (!port.media.includes('any') && !port.media.includes(input.media)) {
            issues.push({
              code: 'SLOT_MEDIA_UNSUPPORTED',
              message: `输入 ${port.id} 不接受 ${input.media}`,
              slotId: port.id,
              inputId: input.id,
            });
          }
        }
      }
      for (const input of inputs) {
        if (!portsById.has(input.slotId)) {
          issues.push({
            code: 'UNKNOWN_INPUT_SLOT',
            message: `输入槽 ${input.slotId} 不存在`,
            slotId: input.slotId,
            inputId: input.id,
          });
        }
      }
      if (model?.maxInputs !== undefined && inputs.length > model.maxInputs) {
        issues.push({
          code: 'MODEL_INPUT_LIMIT_EXCEEDED',
          message: `模型 ${model.name} 最多接受 ${model.maxInputs} 个输入`,
        });
      }
      if (model?.supportedReferenceTypes?.length) {
        for (const input of inputs) {
          if (!model.supportedReferenceTypes.includes(input.media)) {
            issues.push({
              code: 'MODEL_MEDIA_UNSUPPORTED',
              message: `模型 ${model.name} 不支持 ${input.media} 参考输入`,
              inputId: input.id,
              slotId: input.slotId,
            });
          }
        }
      }
      return { valid: issues.length === 0, counts, issues };
    },
    beginGeneration(node, { generationId, queuedAt = Date.now() }) {
      const next = { ...node };
      delete next.errorMessage;
      delete next.errorDetails;
      return {
        ...next,
        status: 'queued',
        generationId,
        generationQueuedAt: queuedAt,
        generationStartedAt: undefined,
        generationCompletedAt: undefined,
      };
    },
    updateGeneration(node, update) {
      if (!node.generationId || node.generationId !== update.generationId) {
        return { node, applied: false };
      }
      const next: NodeState = {
        ...node,
        status: update.status,
        generationStartedAt: update.startedAt ?? node.generationStartedAt,
        generationCompletedAt: update.completedAt ?? node.generationCompletedAt,
      };
      if (update.result) {
        next.result = cloneResult(update.result);
        if (update.status === 'success') {
          const record: NodeResultRecord = {
            ...update.result,
            id: update.generationId,
            generationId: update.generationId,
          };
          next.resultHistory = [
            ...(node.resultHistory ?? []).filter((result) => result.id !== record.id),
            record,
          ].slice(-20);
          next.activeResultId = record.id;
        }
      }
      if (update.error) {
        next.errorMessage = update.error.message;
        next.errorDetails = { ...update.error };
      } else if (update.status === 'loading' || update.status === 'success') {
        delete next.errorMessage;
        delete next.errorDetails;
      }
      return { node: next, applied: true };
    },
    selectResult(node, resultId) {
      const selected = node.resultHistory?.find((result) => result.id === resultId);
      if (!selected) return node;
      return { ...node, activeResultId: selected.id, result: cloneResult(selected) };
    },
    setCollapsed(node, collapsed) {
      return { ...node, collapsed };
    },
    getPresentation(node) {
      const canonical = canonicalType(node.type);
      const [defaultWidth, defaultHeight] = DEFAULT_NODE_SIZES[canonical] ?? [360, 320];
      const width = boundedNumber(node.width, defaultWidth, 240, 960);
      const expandedHeight = boundedNumber(node.height, defaultHeight, 120, 1200);
      const collapsed = node.collapsed === true;
      const result = node.result;
      const kind = result?.mediaType ?? (result?.text ? 'text' : 'none');
      const source = result?.url ?? result?.urls?.[0] ?? result?.text;
      const errorVisible =
        Boolean(node.errorDetails || node.errorMessage) &&
        ['error', 'cancelled', 'timed-out', 'stale'].includes(String(node.status));
      return {
        width,
        height: collapsed ? 48 : expandedHeight,
        expandedHeight,
        collapsed,
        preview: {
          kind,
          ...(source ? { source } : {}),
          available: Boolean(source),
        },
        error: {
          visible: errorVisible,
          ...(node.errorDetails?.code ? { code: node.errorDetails.code } : {}),
          ...(node.errorDetails?.message || node.errorMessage
            ? { message: node.errorDetails?.message ?? node.errorMessage }
            : {}),
          retryable: node.errorDetails?.retryable ?? false,
        },
      };
    },
    getDiagnostics() {
      return { createCalls, validationFailures, definitionCount: definitions.size };
    },
  };
  return adapter;
}

export function installNodeFramework(): NodeFrameworkAdapter {
  if (window.__FISHERAI_NODE_FRAMEWORK__) return window.__FISHERAI_NODE_FRAMEWORK__;
  const adapter = Object.freeze(createNodeFramework());
  window.__FISHERAI_NODE_FRAMEWORK__ = adapter;
  return adapter;
}
