import type {
  WorkflowCanvasBlueprint,
  WorkflowCanvasMediaKind,
  WorkflowCanvasClient,
  WorkflowRun,
  WorkflowSeedAdvancement,
  RunningHubInstanceType,
} from './workflowManagerClient';
import {
  createWorkflowRunObserver,
  requireWorkflowScope,
  type WorkflowRunScope,
} from './workflowRunObserver';
import { registerWorkflowRecoveryOwner } from '../generation/workflowRecoveryBoundary';
import { fileUploadBody, localFilePath } from '../desktop/localFileUpload';
import {
  RUNNINGHUB_PAID_CONFIRMATION_KEY,
  requestAnchoredConfirmation,
} from '../design/designSystem';
import { preferenceStorage } from '../persistence/preferenceStore';

const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled', 'unknown']);
const WORKFLOW_CANVAS_INSERT_REQUEST_EVENT = 'fisherai:add-workflow-node';
export const WORKFLOW_CANVAS_INSERTED_EVENT = 'fisherai:workflow-canvas-inserted';
export const WORKFLOW_CANVAS_INPUT_NODE_EVENT = 'fisherai:add-workflow-input-node';
const TYPE_MEDIA: Readonly<Record<string, WorkflowCanvasMediaKind>> = {
  Text: 'text',
  Image: 'image',
  Mask: 'mask',
  Video: 'video',
  Audio: 'audio',
  'Upload Image': 'image',
  'Upload Video': 'video',
  'Upload Audio': 'audio',
};

const WORKFLOW_MEDIA_KIND_LABELS: Readonly<Record<WorkflowCanvasMediaKind, string>> = {
  image: '图像',
  mask: '遮罩',
  video: '视频',
  audio: '音频',
  text: '文字',
  json: '数据',
};

export function workflowMediaKindLabel(mediaKind: WorkflowCanvasMediaKind): string {
  return WORKFLOW_MEDIA_KIND_LABELS[mediaKind];
}

export function workflowErrorSummary(value: unknown): string {
  const message = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!message) return '工作流运行失败';
  if (/(?:显存不足|显存耗尽|out\s*of\s*memory|cuda[^。.!?]{0,40}memory|\bvram\b)/i.test(message)) {
    return '显存不足';
  }
  if (
    /(?:内容[^。.!?]{0,20}(?:审核|验证).*失败|content verification failed|nsfw|safety check)/i.test(
      message,
    )
  ) {
    return '内容未通过审核';
  }
  if (/(?:余额不足|insufficient (?:funds|balance)|not enough wallet)/i.test(message))
    return '余额不足';
  if (/(?:超时|timed? out|timeout)/i.test(message)) return '任务执行超时';
  if (
    /(?:认证失败|api[ _-]?key[^。.!?]{0,24}(?:无效|失效|unauthor)|unauthori[sz]ed)/i.test(message)
  ) {
    return 'RunningHub 认证失败';
  }
  if (/(?:上传[^。.!?]{0,20}失败|upload failed)/i.test(message)) return '素材上传失败';
  if (/(?:网络|连接失败|fetch failed|econn|transport)/i.test(message)) return '网络连接失败';
  if (
    /(?:工作流[^。.!?]{0,20}(?:校验|配置).*失败|node info error|invalid node|参数错误)/i.test(
      message,
    )
  ) {
    return '工作流配置错误';
  }
  const firstClause = message
    .split(/[：:；;。.!?]/, 1)[0]
    .replace(/^RunningHub\s*/i, '')
    .trim();
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}…` : firstClause || '工作流运行失败';
}

function canvasRunningHubInstanceType(value: unknown): RunningHubInstanceType {
  return String(value || '').toLowerCase() === 'default' ? 'default' : 'plus';
}

export interface WorkflowCanvasOutputValue {
  portId: string;
  label: string;
  mediaKind: WorkflowCanvasMediaKind;
  primary: boolean;
  assetId?: string;
  url?: string;
  value?: unknown;
  sha256?: string;
  bytes?: number;
}

export interface WorkflowCanvasNodeRecord {
  coverUrl?: string | null;
  id: string;
  type: 'ComfyUI';
  kind: 'workflow';
  comfyMode: 'fisherai-workflow';
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  executionTarget: 'local' | 'cloud';
  canvasNodeHash: string;
  workflowRef: WorkflowCanvasBlueprint['workflowRef'];
  inputPorts: WorkflowCanvasBlueprint['inputPorts'];
  outputPorts: WorkflowCanvasBlueprint['outputPorts'];
  parameterSchema: WorkflowCanvasBlueprint['parameterSchema'];
  parameterValues: Record<string, unknown>;
  parentIds: string[];
  sourcePortIndices: number[];
  status: string;
  executionState: Record<string, unknown>;
  workflowOutputs: WorkflowCanvasOutputValue[];
  resultUrl?: string;
  resultUrls?: string[];
  resultText?: string;
  resultHistory?: Array<Record<string, unknown>>;
  errorMessage?: string;
  errorSummary?: string;
  isWorkflowErrorDetailsOpen?: boolean;
  runningHubInstanceType?: RunningHubInstanceType;
  [key: string]: unknown;
}

export interface WorkflowCanvasInputSlot {
  id: string;
  bindingKey: string;
  label: string;
  mediaKind: WorkflowCanvasMediaKind;
  required: boolean;
  slotIndex: number;
  itemIndex: number;
  multiple: boolean;
  source: 'input-port' | 'parameter';
  placeholder?: boolean;
}

type CanvasNode = Record<string, unknown> & { id: string; type: string };
type NodePatch = Partial<WorkflowCanvasNodeRecord>;

const WORKFLOW_EXAMPLE_STORAGE_KEY = 'fisherai-workflow-example-bundles-v1';
const WORKFLOW_EXAMPLE_MAX_BYTES = 512 * 1024;
const WORKFLOW_EXAMPLE_MAX_NODES = 24;
const WORKFLOW_EXAMPLE_NODE_TYPES = new Set([
  'Text',
  'Image',
  'Mask',
  'Video',
  'Audio',
  'Upload Image',
  'Upload Video',
  'Upload Audio',
]);

interface WorkflowExampleNodeTemplate {
  templateId: string;
  role: 'input' | 'output';
  type: string;
  relativeX: number;
  relativeY: number;
  outputPortId?: string;
  data: Record<string, unknown>;
}

interface WorkflowExampleInputBinding {
  slotKey: string;
  templateId: string;
  sourcePortIndex: number;
}

interface WorkflowExampleBundle {
  schemaVersion: 1;
  definitionId: string;
  capturedAt: number;
  nodes: WorkflowExampleNodeTemplate[];
  inputBindings: WorkflowExampleInputBinding[];
}

export interface WorkflowCanvasExampleInsertion {
  nodes: CanvasNode[];
  selectedNodeIds: string[];
  restoredExample: boolean;
}

export interface WorkflowVerifiedCanvasInsertion {
  run: WorkflowRun;
  projectId: string;
  values: Record<string, unknown>;
}

export interface WorkflowCanvasInsertionResult {
  requestId: string;
  nodeIds: string[];
  workflowNodeId: string;
}

export interface WorkflowCanvasUploadedInputNode {
  id: string;
  type: 'Upload Image' | 'Upload Video' | 'Upload Audio';
  x: number;
  y: number;
  title: string;
  prompt: string;
  status: 'success';
  progress: 100;
  resultUrl: string;
  assetId: string;
  projectId: string;
  model: 'Upload';
  aspectRatio: string;
  resolution: string;
}

export interface WorkflowCanvasNodesAdapter {
  applySeedAdvancements(
    values: Record<string, unknown>,
    advancements: readonly WorkflowSeedAdvancement[] | undefined,
  ): Record<string, unknown>;
  createNode(
    blueprint: WorkflowCanvasBlueprint,
    position?: { x?: number; y?: number },
  ): WorkflowCanvasNodeRecord;
  updateNode(
    node: WorkflowCanvasNodeRecord,
    blueprint: WorkflowCanvasBlueprint,
  ): WorkflowCanvasNodeRecord;
  reconcileNode(node: WorkflowCanvasNodeRecord): Promise<WorkflowCanvasNodeRecord | null>;
  addToCanvas(
    blueprint: WorkflowCanvasBlueprint,
    verified?: WorkflowVerifiedCanvasInsertion,
  ): Promise<WorkflowCanvasInsertionResult>;
  captureExample(nodes: readonly CanvasNode[], workflowNodeId: string): boolean;
  hasExample(definitionId: string): boolean;
  instantiateExample(
    blueprint: WorkflowCanvasBlueprint,
    position?: { x?: number; y?: number },
    sourceNodes?: readonly CanvasNode[],
  ): WorkflowCanvasExampleInsertion;
  instantiateVerifiedRun(
    blueprint: WorkflowCanvasBlueprint,
    verified: WorkflowVerifiedCanvasInsertion,
    position?: { x?: number; y?: number },
  ): WorkflowCanvasExampleInsertion;
  uploadInputAsset(
    node: WorkflowCanvasNodeRecord,
    slotIndex: number,
    file: File,
    projectId: string,
  ): Promise<WorkflowCanvasUploadedInputNode>;
  getInputSlots(node: CanvasNode): WorkflowCanvasInputSlot[];
  getInputCapacity(node: CanvasNode): number;
  getInputLimitNotice(node: CanvasNode): string | undefined;
  getErrorSummary(node: CanvasNode): string;
  getInputPortY(node: CanvasNode, portIndex: number): number;
  getOutputPortY(node: CanvasNode, portIndex: number): number;
  getMediaKindLabel(mediaKind: WorkflowCanvasMediaKind): string;
  resolveAvailableInputSlot(
    target: CanvasNode,
    source: CanvasNode,
    sourcePortIndex?: number,
  ): number;
  getConnectionLimitNotice(
    target: CanvasNode,
    source: CanvasNode,
    sourcePortIndex?: number,
  ): string | undefined;
  resolvePortIndex(node: CanvasNode, side: 'left' | 'right', localY: number): number;
  getNodeSize(node: CanvasNode): { width: number; height: number };
  getOutputMediaKind(node: CanvasNode, portIndex?: number): WorkflowCanvasMediaKind | undefined;
  getPrimaryMediaKind(node: CanvasNode): WorkflowCanvasMediaKind | undefined;
  canConnect(
    target: CanvasNode,
    source: CanvasNode,
    targetPortIndex: number,
    sourcePortIndex?: number,
  ): boolean;
  run(
    node: WorkflowCanvasNodeRecord,
    connectedNodes: readonly CanvasNode[],
    projectId: string,
    onPatch: (patch: NodePatch) => void,
    scope?: WorkflowRunScope,
  ): Promise<WorkflowRun>;
  resume(
    node: WorkflowCanvasNodeRecord,
    onPatch: (patch: NodePatch) => void,
    scope?: WorkflowRunScope,
    continuePaused?: boolean,
  ): Promise<WorkflowRun | null>;
  cancel(
    node: WorkflowCanvasNodeRecord,
    onPatch: (patch: NodePatch) => void,
    scope?: WorkflowRunScope,
  ): Promise<WorkflowRun | null>;
}

declare global {
  interface Window {
    __FISHERAI_WORKFLOW_NODES__?: WorkflowCanvasNodesAdapter;
  }
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function workflowInputSlotKey(slot: WorkflowCanvasInputSlot): string {
  return `${slot.source}:${slot.bindingKey}:${slot.itemIndex}`;
}

function safeExampleString(value: unknown, maximum = 200_000): string | undefined {
  if (typeof value !== 'string' || value.length > maximum || /[\0\r]/.test(value)) return undefined;
  return value;
}

function safeExampleNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(minimum, value));
}

function exampleNodeData(node: CanvasNode): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of [
    'title',
    'prompt',
    'textContent',
    'resultText',
    'resultUrl',
    'url',
    'filename',
    'fileName',
    'mimeType',
    'aspectRatio',
    'mediaType',
    'model',
    'assetId',
    'projectId',
  ]) {
    const value = safeExampleString(node[key]);
    const isUrl = key === 'url' || key === 'resultUrl';
    if (value !== undefined && (!isUrl || !value.startsWith('data:'))) {
      data[key] = value;
    }
  }
  for (const key of ['width', 'height', 'duration', 'naturalWidth', 'naturalHeight']) {
    const value = safeExampleNumber(node[key], 0, 100_000);
    if (value !== undefined) data[key] = value;
  }
  if (Array.isArray(node.resultUrls)) {
    const resultUrls = node.resultUrls
      .map((value) => safeExampleString(value, 4_096))
      .filter((value): value is string => typeof value === 'string' && !value.startsWith('data:'))
      .slice(0, 20);
    if (resultUrls.length) data.resultUrls = resultUrls;
  }
  if (node.type === 'Text') {
    data.status = 'success';
  } else if (typeof data.resultUrl === 'string' || typeof data.url === 'string') {
    data.status = 'success';
    data.progress = 100;
  }
  return data;
}

function loadWorkflowExampleBundles(): Map<string, WorkflowExampleBundle> {
  try {
    const raw = preferenceStorage().getItem(WORKFLOW_EXAMPLE_STORAGE_KEY);
    if (!raw || raw.length > WORKFLOW_EXAMPLE_MAX_BYTES) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed
        .filter(
          (bundle): bundle is WorkflowExampleBundle =>
            Boolean(bundle) &&
            typeof bundle === 'object' &&
            (bundle as WorkflowExampleBundle).schemaVersion === 1 &&
            typeof (bundle as WorkflowExampleBundle).definitionId === 'string' &&
            Array.isArray((bundle as WorkflowExampleBundle).nodes) &&
            Array.isArray((bundle as WorkflowExampleBundle).inputBindings),
        )
        .map((bundle) => [bundle.definitionId, bundle]),
    );
  } catch {
    return new Map();
  }
}

function saveWorkflowExampleBundles(bundles: ReadonlyMap<string, WorkflowExampleBundle>): boolean {
  try {
    const serialized = JSON.stringify([...bundles.values()]);
    if (new TextEncoder().encode(serialized).byteLength > WORKFLOW_EXAMPLE_MAX_BYTES) return false;
    preferenceStorage().setItem(WORKFLOW_EXAMPLE_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

function inputPorts(node: CanvasNode): WorkflowCanvasBlueprint['inputPorts'] {
  return Array.isArray(node.inputPorts)
    ? node.inputPorts.filter(
        (port): port is WorkflowCanvasBlueprint['inputPorts'][number] =>
          Boolean(port) &&
          typeof port === 'object' &&
          typeof (port as { id?: unknown }).id === 'string',
      )
    : [];
}

function outputPorts(node: CanvasNode): WorkflowCanvasBlueprint['outputPorts'] {
  return Array.isArray(node.outputPorts)
    ? node.outputPorts.filter(
        (port): port is WorkflowCanvasBlueprint['outputPorts'][number] =>
          Boolean(port) &&
          typeof port === 'object' &&
          typeof (port as { id?: unknown }).id === 'string',
      )
    : [];
}

function parameterSchema(node: CanvasNode): WorkflowCanvasBlueprint['parameterSchema'] {
  return Array.isArray(node.parameterSchema)
    ? node.parameterSchema.filter(
        (parameter): parameter is WorkflowCanvasBlueprint['parameterSchema'][number] =>
          Boolean(parameter) &&
          typeof parameter === 'object' &&
          typeof (parameter as { key?: unknown }).key === 'string',
      )
    : [];
}

function normalizeSelectParameterValues(
  schema: WorkflowCanvasBlueprint['parameterSchema'],
  values: Record<string, unknown>,
): Record<string, unknown> {
  for (const parameter of schema) {
    if (String(parameter.control?.kind || '').toLowerCase() !== 'select') continue;
    const currentValue = values[parameter.key];
    const options = Array.isArray(parameter.control?.options) ? parameter.control.options : [];
    if (options.some((option) => option.id === currentValue)) continue;
    const legacyMatches = options.filter((option) => option.label === currentValue);
    if (legacyMatches.length === 1) values[parameter.key] = legacyMatches[0].id;
  }
  return values;
}

function finiteNumericValue(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

export function applyWorkflowSeedAdvancements(
  values: Record<string, unknown>,
  advancements: readonly WorkflowSeedAdvancement[] | undefined,
): Record<string, unknown> {
  if (!Array.isArray(advancements) || advancements.length === 0) return values;
  let nextValues = values;
  for (const advancement of advancements) {
    if (
      !advancement ||
      !['increment', 'decrement'].includes(advancement.mode) ||
      !Number.isSafeInteger(advancement.previousValue) ||
      !Number.isSafeInteger(advancement.nextValue) ||
      !Number.isSafeInteger(advancement.step) ||
      advancement.step <= 0
    )
      continue;
    const current = values[advancement.bindingKey];
    if (!current || typeof current !== 'object' || Array.isArray(current)) continue;
    const policy = current as { mode?: unknown; value?: unknown; step?: unknown };
    if (
      policy.mode !== advancement.mode ||
      Number(policy.value) !== advancement.previousValue ||
      (policy.step !== undefined && Number(policy.step) !== advancement.step)
    )
      continue;
    if (nextValues === values) nextValues = { ...values };
    nextValues[advancement.bindingKey] = {
      mode: advancement.mode,
      value: advancement.nextValue,
      step: advancement.step,
    };
  }
  return nextValues;
}

export function normalizeNumericParameterValues(
  schema: WorkflowCanvasBlueprint['parameterSchema'],
  values: Record<string, unknown>,
): Record<string, unknown> {
  for (const parameter of schema) {
    const kind = String(parameter.control?.kind || '').toLowerCase();
    if (!['number', 'slider', 'seed'].includes(kind)) continue;
    const currentValue = values[parameter.key];
    const seedPolicy =
      kind === 'seed' && currentValue && typeof currentValue === 'object'
        ? String((currentValue as { mode?: unknown }).mode || 'fixed')
        : 'fixed';
    if (kind === 'seed' && seedPolicy === 'random') {
      values[parameter.key] = { mode: 'random' };
      continue;
    }
    if (kind === 'seed' && !['fixed', 'increment', 'decrement'].includes(seedPolicy)) {
      throw new Error(`${parameter.label}种子策略无效`);
    }
    const currentNumeric =
      kind === 'seed' && currentValue && typeof currentValue === 'object'
        ? (currentValue as { value?: unknown }).value
        : currentValue;
    const defaultValue = parameter.control.defaultValue;
    const defaultNumeric =
      kind === 'seed' && defaultValue && typeof defaultValue === 'object'
        ? (defaultValue as { value?: unknown }).value
        : defaultValue;
    const numericValue = finiteNumericValue(currentNumeric) ?? finiteNumericValue(defaultNumeric);
    if (numericValue === undefined) {
      if (!parameter.control.required) {
        delete values[parameter.key];
        continue;
      }
      throw new Error(`${parameter.label}请输入有效数字`);
    }
    if (
      Number.isFinite(parameter.control.minimum) &&
      numericValue < Number(parameter.control.minimum)
    ) {
      throw new Error(`${parameter.label}不能小于 ${parameter.control.minimum}`);
    }
    if (
      Number.isFinite(parameter.control.maximum) &&
      numericValue > Number(parameter.control.maximum)
    ) {
      throw new Error(`${parameter.label}不能大于 ${parameter.control.maximum}`);
    }
    if (kind !== 'seed') {
      values[parameter.key] = numericValue;
      continue;
    }
    if (seedPolicy === 'fixed') {
      values[parameter.key] = { mode: 'fixed', value: numericValue };
      continue;
    }
    const declaredStep =
      Number.isFinite(parameter.control.step) && Number(parameter.control.step) > 0
        ? Number(parameter.control.step)
        : 1;
    const policyStep =
      currentValue && typeof currentValue === 'object'
        ? (finiteNumericValue((currentValue as { step?: unknown }).step) ?? declaredStep)
        : declaredStep;
    if (!Number.isSafeInteger(policyStep) || policyStep <= 0 || policyStep !== declaredStep) {
      throw new Error(`${parameter.label}种子步长无效`);
    }
    values[parameter.key] = { mode: seedPolicy, value: numericValue, step: policyStep };
  }
  return values;
}

function isTextParameter(parameter: WorkflowCanvasBlueprint['parameterSchema'][number]): boolean {
  return ['text', 'textarea', 'string', 'prompt', 'multiline'].includes(
    String(parameter.control?.kind || '').toLowerCase(),
  );
}

const WORKFLOW_MEDIA_ORDER: Readonly<Record<string, number>> = {
  image: 0,
  mask: 1,
  video: 2,
  audio: 3,
  text: 4,
  json: 5,
};

function workflowPortOrdinal(port: { id: string; label: string }): number {
  const values = [port.id, port.label];
  for (const value of values) {
    const match = String(value || '').match(/(?:^|[^0-9])(\d+)\s*$/u);
    if (match) return Number(match[1]);
  }
  return Number.POSITIVE_INFINITY;
}

function orderedWorkflowInputPorts(node: CanvasNode): ReturnType<typeof inputPorts> {
  return inputPorts(node)
    .map((port, sourceIndex) => ({ port, sourceIndex }))
    .sort(
      (first, second) =>
        (WORKFLOW_MEDIA_ORDER[first.port.mediaKind] ?? 99) -
          (WORKFLOW_MEDIA_ORDER[second.port.mediaKind] ?? 99) ||
        workflowPortOrdinal(first.port) - workflowPortOrdinal(second.port) ||
        first.port.label.localeCompare(second.port.label, 'zh-CN', { numeric: true }) ||
        first.sourceIndex - second.sourceIndex,
    )
    .map(({ port }) => port);
}

function compareWorkflowSlots(
  first: WorkflowCanvasInputSlot,
  second: WorkflowCanvasInputSlot,
): number {
  return (
    (WORKFLOW_MEDIA_ORDER[first.mediaKind] ?? 99) -
      (WORKFLOW_MEDIA_ORDER[second.mediaKind] ?? 99) ||
    workflowPortOrdinal({ id: first.bindingKey, label: first.label }) -
      workflowPortOrdinal({ id: second.bindingKey, label: second.label }) ||
    first.itemIndex - second.itemIndex ||
    first.slotIndex - second.slotIndex
  );
}

export function expandWorkflowStorageSlots(node: CanvasNode): WorkflowCanvasInputSlot[] {
  const slots: WorkflowCanvasInputSlot[] = [];
  for (const port of inputPorts(node)) {
    const count = port.multiple
      ? Math.min(20 - slots.length, Math.max(1, Math.trunc(port.maximumItems || 1)))
      : 1;
    for (let itemIndex = 0; itemIndex < count && slots.length < 20; itemIndex += 1) {
      slots.push({
        id: `${port.id}:${itemIndex}`,
        bindingKey: port.id,
        label: port.multiple ? `${port.label} ${itemIndex + 1}` : port.label,
        mediaKind: port.mediaKind,
        required: port.required && itemIndex === 0,
        slotIndex: slots.length,
        itemIndex,
        multiple: port.multiple,
        source: 'input-port',
        placeholder: false,
      });
    }
  }
  for (const parameter of parameterSchema(node)) {
    if (slots.length >= 20 || !isTextParameter(parameter)) continue;
    slots.push({
      id: `parameter:${parameter.key}`,
      bindingKey: parameter.key,
      label: parameter.label || '文字输入',
      mediaKind: 'text',
      required: Boolean(parameter.control?.required),
      slotIndex: slots.length,
      itemIndex: 0,
      multiple: false,
      source: 'parameter',
      placeholder: false,
    });
  }
  return slots;
}

export function expandWorkflowInputSlots(node: CanvasNode): WorkflowCanvasInputSlot[] {
  const storageSlots = expandWorkflowStorageSlots(node);
  const parentIds = Array.isArray(node.parentIds) ? node.parentIds : [];
  const visible: WorkflowCanvasInputSlot[] = [];
  for (const port of orderedWorkflowInputPorts(node)) {
    const portSlots = storageSlots.filter(
      (slot) => slot.source === 'input-port' && slot.bindingKey === port.id,
    );
    if (!port.multiple) {
      if (portSlots[0]) visible.push(portSlots[0]);
      continue;
    }
    const connected = portSlots.filter((slot) => Boolean(parentIds[slot.slotIndex]));
    connected.forEach((slot, index) => {
      visible.push({
        ...slot,
        label: `${port.label} ${index + 1}`,
        required: port.required && index === 0,
        placeholder: false,
      });
    });
    const next = portSlots.find((slot) => !parentIds[slot.slotIndex]);
    if (next) {
      visible.push({
        ...next,
        label: `添加${port.label}`,
        required: port.required && connected.length === 0,
        placeholder: true,
      });
    }
  }
  visible.push(...storageSlots.filter((slot) => slot.source === 'parameter'));
  return visible;
}

function workflowInputLimitNotice(node: CanvasNode): string | undefined {
  const storageSlots = expandWorkflowStorageSlots(node);
  const parentIds = Array.isArray(node.parentIds) ? node.parentIds : [];
  for (const port of inputPorts(node)) {
    if (!port.multiple) continue;
    const portSlots = storageSlots.filter(
      (slot) => slot.source === 'input-port' && slot.bindingKey === port.id,
    );
    const connectedCount = portSlots.filter((slot) => Boolean(parentIds[slot.slotIndex])).length;
    if (portSlots.length === 0 || connectedCount < portSlots.length) continue;
    const unit =
      port.mediaKind === 'audio' ? '段音频' : port.mediaKind === 'video' ? '段视频' : '张图片';
    return `${port.label}已达上限：最多 ${portSlots.length} ${unit}`;
  }
  return undefined;
}

function expandedWorkflowHeight(node: CanvasNode): number {
  const parentIds = Array.isArray(node.parentIds) ? node.parentIds : [];
  const slots = expandWorkflowInputSlots(node).filter(
    (slot) => slot.source === 'input-port' || Boolean(parentIds[slot.slotIndex]),
  );
  const allParameters = parameterSchema(node);
  const primaryCloudTextParameter = isCloudWorkflowNode(node)
    ? allParameters.find((parameter) => /^prompt$/i.test(String(parameter.key || ''))) ||
      allParameters.find((parameter) => /提示词/.test(String(parameter.label || ''))) ||
      allParameters.find((parameter) =>
        /^(text|description)$/i.test(String(parameter.key || '')),
      ) ||
      allParameters.find(isTextParameter)
    : undefined;
  const parameters = primaryCloudTextParameter
    ? allParameters.filter((parameter) => parameter !== primaryCloudTextParameter)
    : allParameters;
  const slotRows = Math.ceil(slots.length / 2);
  const slotsHeight = 26 + (slots.length ? slotRows * 62 + Math.max(0, slotRows - 1) * 8 : 38);
  const parameterFieldsHeight = parameters.reduce(
    (total, parameter) => total + (isTextParameter(parameter) ? 62 : 44),
    0,
  );
  const parametersHeight = parameters.length
    ? 26 + parameterFieldsHeight + Math.max(0, parameters.length - 1) * 9
    : 48;
  const settingsSections = 3;
  const settingsHeight =
    32 + 57 + slotsHeight + parametersHeight + Math.max(0, settingsSections - 1) * 16 + 106;
  const errorHeight = workflowErrorHeight(node);
  const promptHeight = isCloudWorkflowNode(node) ? 166 : 0;
  return Math.max(520, Math.min(100_000, 64 + promptHeight + settingsHeight + errorHeight + 66));
}

function workflowErrorHeight(node: CanvasNode): number {
  if (typeof node.errorMessage !== 'string' || !node.errorMessage) return 0;
  return node.isWorkflowErrorDetailsOpen ? 194 : 54;
}

function isCloudWorkflowNode(node: CanvasNode): boolean {
  return (
    node.executionTarget === 'cloud' ||
    (!node.executionTarget && /runninghub/i.test(String(node.subtitle || '')))
  );
}

function compactWorkflowPortY(
  node: CanvasNode,
  visibleIndex: number,
  visibleCount: number,
): number {
  const height = 320 + workflowErrorHeight(node);
  const top = 92;
  const bottom = height - 88;
  return Math.round(top + ((visibleIndex + 1) / (visibleCount + 1)) * (bottom - top));
}

function mediaKindForNode(
  node: CanvasNode,
  sourcePortIndex = 0,
): WorkflowCanvasMediaKind | undefined {
  if (node.kind === 'workflow') {
    const ports = outputPorts(node);
    return (
      ports[sourcePortIndex]?.mediaKind ||
      ports.find((port) => port.primary)?.mediaKind ||
      ports[0]?.mediaKind
    );
  }
  return TYPE_MEDIA[node.type];
}

function mediaKindsCompatible(
  source: WorkflowCanvasMediaKind | undefined,
  target: WorkflowCanvasMediaKind,
): boolean {
  return source === target || (source === 'image' && target === 'mask');
}

function compatibleWorkflowInputSlots(
  target: CanvasNode,
  source: CanvasNode,
  sourcePortIndex = 0,
): WorkflowCanvasInputSlot[] {
  const sourceMediaKind = mediaKindForNode(source, sourcePortIndex);
  if (!sourceMediaKind) return [];
  return expandWorkflowStorageSlots(target)
    .filter((slot) => mediaKindsCompatible(sourceMediaKind, slot.mediaKind))
    .sort(compareWorkflowSlots);
}

function resolveAvailableWorkflowInputSlot(
  target: CanvasNode,
  source: CanvasNode,
  sourcePortIndex = 0,
): number {
  const parents = Array.isArray(target.parentIds) ? target.parentIds : [];
  return (
    compatibleWorkflowInputSlots(target, source, sourcePortIndex).find(
      (slot) => !parents[slot.slotIndex],
    )?.slotIndex ?? -1
  );
}

function workflowConnectionLimitNotice(
  target: CanvasNode,
  source: CanvasNode,
  sourcePortIndex = 0,
): string | undefined {
  const sourceMediaKind = mediaKindForNode(source, sourcePortIndex);
  if (!sourceMediaKind) return undefined;
  const compatibleSlots = compatibleWorkflowInputSlots(target, source, sourcePortIndex);
  if (compatibleSlots.length === 0) {
    return `当前工作流不接受${workflowMediaKindLabel(sourceMediaKind)}输入`;
  }
  const parents = Array.isArray(target.parentIds) ? target.parentIds : [];
  if (compatibleSlots.some((slot) => !parents[slot.slotIndex])) return undefined;
  const unit =
    sourceMediaKind === 'image' || sourceMediaKind === 'mask'
      ? '张图片'
      : sourceMediaKind === 'video'
        ? '段视频'
        : sourceMediaKind === 'audio'
          ? '段音频'
          : sourceMediaKind === 'text'
            ? '个文字输入'
            : '个输入';
  return `${workflowMediaKindLabel(sourceMediaKind)}输入已达上限：当前工作流最多可连接 ${compatibleSlots.length} ${unit}`;
}

function localAssetReference(
  urlValue: unknown,
  expectedProjectId: string,
  mediaKind: WorkflowCanvasMediaKind,
) {
  if (typeof urlValue !== 'string') return null;
  const pathOnly = urlValue.split(/[?#]/, 1)[0];
  const match = /^\/library\/media\/([^/]+)\/(images|videos|audios)\/([^/]+)$/i.exec(pathOnly);
  if (!match) return null;
  const projectId = decodeURIComponent(match[1]);
  const directoryType = match[2].toLowerCase();
  const storedType =
    directoryType === 'images' ? 'image' : directoryType === 'videos' ? 'video' : 'audio';
  if (projectId !== expectedProjectId || !mediaKindsCompatible(storedType, mediaKind)) return null;
  const filename = decodeURIComponent(match[3]);
  const assetId = filename.replace(/\.[^.]+$/, '');
  if (!assetId || assetId === '.' || assetId === '..' || /[\\/\0\r\n]/.test(assetId)) return null;
  return { assetId, projectId, type: mediaKind };
}

function outputValue(
  node: CanvasNode,
  sourcePortIndex: number,
): WorkflowCanvasOutputValue | undefined {
  if (!Array.isArray(node.workflowOutputs)) return undefined;
  const outputs = node.workflowOutputs as WorkflowCanvasOutputValue[];
  const port = outputPorts(node)[sourcePortIndex];
  return port ? outputs.find((output) => output.portId === port.id) : undefined;
}

function assetFromNode(
  node: CanvasNode,
  sourcePortIndex: number,
  projectId: string,
  mediaKind: WorkflowCanvasMediaKind,
) {
  if (node.kind === 'workflow') {
    const output = outputValue(node, sourcePortIndex);
    if (!output || !mediaKindsCompatible(output.mediaKind, mediaKind)) return null;
    if (output.assetId) return { assetId: output.assetId, projectId, type: mediaKind };
    return localAssetReference(output.url, projectId, mediaKind);
  }
  // Replacing an image or selecting a generation candidate changes resultUrl;
  // legacy assetId metadata can still name the previous character.
  const currentUrl = node.resultUrl || node.url || node.dataUrl;
  if (currentUrl) return localAssetReference(currentUrl, projectId, mediaKind);
  if (
    typeof node.assetId === 'string' &&
    typeof node.projectId === 'string' &&
    node.projectId === projectId &&
    node.assetId.length > 0 &&
    node.assetId.length <= 200 &&
    !/[\\/\0\r\n]/.test(node.assetId) &&
    mediaKindsCompatible(mediaKindForNode(node, sourcePortIndex), mediaKind)
  ) {
    return { assetId: node.assetId, projectId, type: mediaKind };
  }
  return null;
}

function textFromNode(node: CanvasNode, sourcePortIndex: number): string | null {
  if (node.kind === 'workflow') {
    const output = outputValue(node, sourcePortIndex);
    if (!output || output.mediaKind !== 'text') return null;
    if (typeof output.value === 'string') return output.value;
    if (output.value !== undefined) return JSON.stringify(output.value);
  }
  for (const value of [node.textContent, node.resultText, node.prompt, node.text]) {
    if (typeof value === 'string') return value;
  }
  return null;
}

export function buildWorkflowCanvasValues(
  node: WorkflowCanvasNodeRecord,
  connectedNodes: readonly CanvasNode[],
  projectId: string,
): Record<string, unknown> {
  if (!projectId) throw new Error('当前画布没有有效的项目标识');
  const values = { ...(node.parameterValues || {}) };
  const parents = Array.isArray(node.parentIds) ? node.parentIds : [];
  const sourcePortIndices = Array.isArray(node.sourcePortIndices) ? node.sourcePortIndices : [];
  const byId = new Map(connectedNodes.map((candidate) => [candidate.id, candidate]));
  const grouped = new Map<string, Array<Record<string, string>>>();
  for (const slot of expandWorkflowStorageSlots(node)) {
    const parentId = parents[slot.slotIndex];
    if (!parentId) {
      if (
        slot.source === 'parameter' &&
        slot.required &&
        (values[slot.bindingKey] === undefined ||
          values[slot.bindingKey] === null ||
          values[slot.bindingKey] === '')
      ) {
        throw new Error(`${slot.label}尚未填写或连接文本节点`);
      }
      if (slot.source === 'input-port' && slot.required) {
        throw new Error(`${slot.label}尚未连接素材`);
      }
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) throw new Error(`${slot.label}连接的素材节点已经不存在`);
    const sourcePortIndex = Math.max(0, Math.trunc(sourcePortIndices[slot.slotIndex] || 0));
    if (parent.kind === 'workflow' && !outputValue(parent, sourcePortIndex))
      throw new Error(`${slot.label}连接的工作流输出尚无结果，请检查所选输出端口`);
    if (slot.source === 'parameter') {
      const text = textFromNode(parent, sourcePortIndex);
      if (text === null) throw new Error(`${slot.label}需要连接文本节点`);
      if (slot.required && text.trim() === '') throw new Error(`${slot.label}连接的文本为空`);
      values[slot.bindingKey] = text;
      continue;
    }
    const asset = assetFromNode(parent, sourcePortIndex, projectId, slot.mediaKind);
    if (!asset) throw new Error(`${slot.label}需要当前项目内的${slot.mediaKind}素材`);
    grouped.set(slot.bindingKey, [...(grouped.get(slot.bindingKey) || []), asset]);
  }
  for (const port of inputPorts(node)) {
    const assets = grouped.get(port.id) || [];
    if (port.required && assets.length === 0) throw new Error(`${port.label}尚未连接素材`);
    if (assets.length > 0) values[port.id] = port.multiple ? assets : assets[0];
    else delete values[port.id];
  }
  const schema = parameterSchema(node);
  normalizeSelectParameterValues(schema, values);
  return normalizeNumericParameterValues(schema, values);
}

function publishExternalOutputs(node: WorkflowCanvasNodeRecord, run: WorkflowRun): void {
  if (run.status !== 'success') return;
  const outputs = receiptOutputs(node, run);
  if (outputs.length === 0) return;
  const ports =
    node.workflowRef?.verificationStatus === 'draft' ? draftOutputPorts(run) : outputPorts(node);
  window.dispatchEvent(
    new CustomEvent('fisherai:add-workflow-output-nodes', {
      detail: {
        sourceNodeId: node.id,
        sourceTitle: node.title,
        sourceX: node.x,
        sourceY: node.y,
        sourceWidth: node.width,
        runId: run.runId,
        outputs: outputs.map((output) => ({
          ...output,
          portIndex: Math.max(
            0,
            ports.findIndex((port) => port.id === output.portId),
          ),
        })),
      },
    }),
  );
}

function publishRunProgress(node: WorkflowCanvasNodeRecord, run: WorkflowRun): void {
  window.dispatchEvent(
    new CustomEvent('fisherai:workflow-run-progress', {
      detail: {
        runId: run.runId,
        title: node.title,
        status: run.status,
        phase: run.phase,
        currentNodeId: run.currentNodeId,
        progress: run.progress,
        realtimeChannel: run.realtimeChannel,
      },
    }),
  );
}

function receiptOutputs(
  node: WorkflowCanvasNodeRecord,
  run: WorkflowRun,
): WorkflowCanvasOutputValue[] {
  const candidates = Array.isArray(run.receipt?.outputs) ? run.receipt.outputs : [];
  const ports =
    node.workflowRef?.verificationStatus === 'draft' ? draftOutputPorts(run) : outputPorts(node);
  return ports.flatMap((port) => {
    const candidate =
      candidates.find((raw) => String(raw.portId) === port.id) ||
      candidates.find(
        (raw) =>
          String(raw.nodeId) === String(port.selector.nodeId) &&
          String(raw.outputKey) === String(port.selector.outputKey) &&
          Number(raw.outputIndex) === Number(port.selector.outputIndex) &&
          String(raw.mediaKind) === port.mediaKind,
      );
    if (!candidate) return [];
    return [
      {
        portId: port.id,
        label: port.label,
        mediaKind: port.mediaKind,
        primary: port.primary,
        ...(typeof candidate.assetId === 'string' ? { assetId: candidate.assetId } : {}),
        ...(typeof candidate.url === 'string' ? { url: candidate.url } : {}),
        ...(Object.hasOwn(candidate, 'value') ? { value: candidate.value } : {}),
        ...(typeof candidate.sha256 === 'string' ? { sha256: candidate.sha256 } : {}),
        ...(typeof candidate.bytes === 'number' ? { bytes: candidate.bytes } : {}),
      },
    ];
  });
}

function draftOutputPorts(run: WorkflowRun): WorkflowCanvasBlueprint['outputPorts'] {
  const candidates = Array.isArray(run.receipt?.outputs) ? run.receipt.outputs : [];
  const labels: Record<WorkflowCanvasMediaKind, string> = {
    image: '图片结果',
    mask: '遮罩结果',
    video: '视频结果',
    audio: '音频结果',
    text: '文字结果',
    json: '数据结果',
  };
  return candidates
    .flatMap((candidate, index) => {
      const mediaKind = String(candidate.mediaKind || '') as WorkflowCanvasMediaKind;
      if (!['image', 'mask', 'video', 'audio', 'text', 'json'].includes(mediaKind)) return [];
      const outputKey = String(candidate.outputKey || 'output');
      return [
        {
          id: `draft_output_${index + 1}`,
          label: labels[mediaKind],
          mediaKind,
          primary: index === 0,
          portIndex: index,
          selector: {
            nodeId: String(candidate.nodeId || ''),
            outputKey,
            outputIndex: Number(candidate.outputIndex || 0),
          },
        },
      ];
    })
    .map((port, index) => ({ ...port, primary: index === 0, portIndex: index }));
}

function runPatch(node: WorkflowCanvasNodeRecord, run: WorkflowRun): NodePatch {
  const executionState = {
    status: run.phase === 'observation-paused' ? 'observing-paused' : run.status,
    runId: run.runId,
    phase: run.phase,
    code: run.code,
    remoteMayContinue: Boolean(run.remoteMayContinue),
    currentNodeId: run.currentNodeId,
    progress: run.progress,
    realtimeChannel: run.realtimeChannel,
    cachedNodeIds: run.cachedNodeIds,
    inputCleanup: run.inputCleanup,
    resolvedSeeds: run.resolvedSeeds,
    seedAdvancements: run.seedAdvancements,
    updatedAt: Date.now(),
  };
  if (run.status === 'loading') {
    return {
      status: 'loading',
      executionState,
      errorMessage:
        run.phase === 'observation-paused'
          ? '观察窗口已结束，任务仍可能在运行。可继续查询原任务。'
          : undefined,
      errorSummary: run.phase === 'observation-paused' ? '任务查询已暂停' : undefined,
      isWorkflowErrorDetailsOpen: false,
    };
  }
  if (run.status === 'success') {
    const discoveredPorts =
      node.workflowRef?.verificationStatus === 'draft' ? draftOutputPorts(run) : undefined;
    const outputs = receiptOutputs(node, run);
    const primary = outputs.find((output) => output.primary) || outputs[0];
    const urls = outputs.flatMap((output) => (output.url ? [output.url] : []));
    const text = typeof primary?.value === 'string' ? primary.value : undefined;
    const previous = Array.isArray(node.resultHistory) ? node.resultHistory : [];
    const belongsToRun = (entry: Record<string, unknown>) =>
      entry.id === run.runId || entry.generationId === run.runId;
    const existing = previous.find(belongsToRun);
    const entry = {
      ...existing,
      id: run.runId,
      generationId: run.runId,
      mediaType: primary?.mediaKind,
      url: primary?.url,
      urls,
      text,
      completedAt: existing?.completedAt ?? Date.now(),
      outputs,
    };
    let written = false;
    const history = previous.flatMap((candidate) => {
      if (!belongsToRun(candidate)) return [candidate];
      if (written) return [];
      written = true;
      return [entry];
    });
    if (!written) history.push(entry);
    return {
      status: 'success',
      executionState,
      ...(discoveredPorts ? { outputPorts: discoveredPorts } : {}),
      workflowOutputs: outputs,
      resultUrl: primary?.url,
      resultUrls: urls,
      resultText: text,
      resultHistory: history.slice(-20),
      errorMessage: undefined,
      errorSummary: undefined,
      isWorkflowErrorDetailsOpen: false,
    };
  }
  const errorMessage =
    run.error ||
    (run.status === 'unknown'
      ? '工作流运行结果暂时无法确认，请检查远端任务状态。'
      : '工作流运行失败。');
  return {
    status: run.status === 'cancelled' ? 'cancelled' : 'error',
    executionState,
    errorMessage,
    errorSummary: workflowErrorSummary(errorMessage),
    isWorkflowErrorDetailsOpen: false,
  };
}

interface VerifiedAssetReference {
  assetId: string;
  projectId: string;
  type: WorkflowCanvasMediaKind;
  url?: string;
  filename?: string;
}

function verifiedAssetReference(value: unknown): VerifiedAssetReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const assetId = safeExampleString(candidate.assetId, 200);
  const projectId = safeExampleString(candidate.projectId, 200);
  const type = safeExampleString(candidate.type, 20) as WorkflowCanvasMediaKind | undefined;
  if (
    !assetId ||
    !projectId ||
    !type ||
    !['image', 'mask', 'video', 'audio'].includes(type) ||
    /[\\/]/.test(assetId) ||
    /[\\/]/.test(projectId)
  )
    return undefined;
  const url = safeExampleString(candidate.url, 4_096);
  const filename = safeExampleString(candidate.filename, 500);
  return {
    assetId,
    projectId,
    type,
    ...(url && !url.startsWith('data:') ? { url } : {}),
    ...(filename ? { filename } : {}),
  };
}

function verifiedAssetForSlot(
  value: unknown,
  itemIndex: number,
): VerifiedAssetReference | undefined {
  if (Array.isArray(value)) return verifiedAssetReference(value[itemIndex]);
  return itemIndex === 0 ? verifiedAssetReference(value) : undefined;
}

function canvasNodeTypeForMedia(mediaKind: WorkflowCanvasMediaKind): string {
  if (mediaKind === 'video') return 'Upload Video';
  if (mediaKind === 'audio') return 'Upload Audio';
  if (mediaKind === 'image' || mediaKind === 'mask') return 'Upload Image';
  return 'Text';
}

interface WorkflowUploadRule {
  directory: 'images' | 'videos' | 'audios';
  label: string;
  extensions: ReadonlySet<string>;
  maximumBytes: number;
  fallbackContentType: string;
}

const WORKFLOW_UPLOAD_RULES: Readonly<Record<'image' | 'video' | 'audio', WorkflowUploadRule>> = {
  image: {
    directory: 'images',
    label: '图像',
    extensions: new Set(['.jpeg', '.jpg', '.png', '.webp', '.bmp']),
    maximumBytes: 50 * 1024 * 1024,
    fallbackContentType: 'image/png',
  },
  video: {
    directory: 'videos',
    label: '视频',
    extensions: new Set(['.m4v', '.mov', '.mp4', '.webm', '.mkv']),
    maximumBytes: 2 * 1024 * 1024 * 1024,
    fallbackContentType: 'video/mp4',
  },
  audio: {
    directory: 'audios',
    label: '音频',
    extensions: new Set(['.mp3', '.m4a', '.wav', '.ogg', '.aac', '.flac']),
    maximumBytes: 500 * 1024 * 1024,
    fallbackContentType: 'audio/mpeg',
  },
};

function workflowUploadRule(mediaKind: WorkflowCanvasMediaKind): WorkflowUploadRule | undefined {
  if (mediaKind === 'image' || mediaKind === 'mask') return WORKFLOW_UPLOAD_RULES.image;
  if (mediaKind === 'video') return WORKFLOW_UPLOAD_RULES.video;
  if (mediaKind === 'audio') return WORKFLOW_UPLOAD_RULES.audio;
  return undefined;
}

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function workflowUploadContentType(file: File, rule: WorkflowUploadRule): string {
  const prefix =
    rule.directory === 'images' ? 'image/' : rule.directory === 'videos' ? 'video/' : 'audio/';
  return file.type.toLowerCase().startsWith(prefix) ? file.type : rule.fallbackContentType;
}

function uploadErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.error === 'string' && candidate.error.trim() ? candidate.error : fallback;
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createWorkflowCanvasNodes(
  client: WorkflowCanvasClient,
): WorkflowCanvasNodesAdapter {
  const observeRun = createWorkflowRunObserver((runId) => client.getRun(runId));
  const reconciliations = new Map<string, Promise<WorkflowCanvasBlueprint | null>>();
  const exampleBundles = loadWorkflowExampleBundles();

  function observe(
    node: WorkflowCanvasNodeRecord,
    runId: string,
    onPatch: (patch: NodePatch) => void,
    scope?: WorkflowRunScope,
  ): Promise<WorkflowRun> {
    return observeRun(runId, {
      scope,
      receive(run, terminal) {
        if (scope && !scope.isCurrent()) return;
        onPatch(runPatch(scope?.getNode?.() ?? node, run));
        publishRunProgress(node, run);
        if (terminal) publishExternalOutputs(node, run);
      },
      pause(error) {
        if (scope && !scope.isCurrent()) return;
        onPatch({
          executionState: {
            ...(scope?.getNode?.() ?? node).executionState,
            status: 'observing-paused',
            runId,
            error: error instanceof Error ? error.message : '查询任务失败',
          },
          errorMessage: '任务仍可能在运行，网络恢复后可继续查询。',
          errorSummary: '网络连接失败',
          isWorkflowErrorDetailsOpen: false,
        });
      },
    });
  }

  const adapter: WorkflowCanvasNodesAdapter = {
    applySeedAdvancements: applyWorkflowSeedAdvancements,
    createNode(blueprint, position = {}) {
      const slotCount = expandWorkflowStorageSlots(blueprint as unknown as CanvasNode).length;
      return {
        id: crypto.randomUUID(),
        type: 'ComfyUI',
        kind: 'workflow',
        comfyMode: 'fisherai-workflow',
        x: finiteNumber(position.x, 160, -1_000_000, 1_000_000),
        y: finiteNumber(position.y, 140, -1_000_000, 1_000_000),
        width: finiteNumber(blueprint.ui.width, 600, 520, 760),
        height: 520,
        title: blueprint.title,
        coverUrl: blueprint.coverUrl,
        subtitle: blueprint.subtitle,
        executionTarget:
          blueprint.executionTarget === 'cloud' ||
          (!blueprint.executionTarget && /runninghub/i.test(blueprint.subtitle))
            ? 'cloud'
            : 'local',
        ...(blueprint.executionTarget === 'cloud' || /runninghub/i.test(blueprint.subtitle)
          ? {
              runningHubInstanceType: canvasRunningHubInstanceType(
                blueprint.runningHubInstanceType,
              ),
            }
          : {}),
        canvasNodeHash: blueprint.canvasNodeHash,
        workflowRef: structuredClone(blueprint.workflowRef),
        inputPorts: structuredClone(blueprint.inputPorts),
        outputPorts: structuredClone(blueprint.outputPorts),
        parameterSchema: structuredClone(blueprint.parameterSchema),
        parameterValues: structuredClone(blueprint.parameterValues),
        parentIds: new Array(slotCount).fill(''),
        sourcePortIndices: new Array(slotCount).fill(0),
        status: 'idle',
        executionState: { status: 'idle' },
        workflowOutputs: [],
      };
    },
    async uploadInputAsset(node, slotIndex, file, projectId) {
      const normalizedSlotIndex = Math.max(0, Math.trunc(slotIndex));
      const slot = expandWorkflowStorageSlots(node).find(
        (candidate) => candidate.slotIndex === normalizedSlotIndex,
      );
      if (!slot || slot.source !== 'input-port') {
        throw new Error('工作流素材入口已经变化，请刷新后重试');
      }
      const rule = workflowUploadRule(slot.mediaKind);
      if (!rule) throw new Error(`${slot.label}不支持文件上传`);
      if (!projectId) throw new Error('请先打开项目，再上传工作流素材');
      if (!file || !rule.extensions.has(fileExtension(file.name))) {
        throw new Error(`${slot.label}需要上传${rule.label}文件`);
      }
      if (file.size <= 0) throw new Error(`${slot.label}选择的文件为空`);
      if (file.size > rule.maximumBytes) {
        const maximum =
          rule.directory === 'videos' ? '2 GB' : rule.directory === 'audios' ? '500 MB' : '50 MB';
        throw new Error(`${slot.label}文件超过 ${maximum} 上限`);
      }

      const sourceNodeId = crypto.randomUUID();
      const path = localFilePath(file);
      const response = await fetch(
        path ? `/api/assets/import/${rule.directory}` : `/api/assets/upload/${rule.directory}`,
        path
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path, projectId, nodeId: sourceNodeId, filename: file.name }),
            }
          : {
              method: 'POST',
              headers: {
                'Content-Type': workflowUploadContentType(file, rule),
                'x-filename': encodeURIComponent(file.name),
                'x-project-id': projectId,
                'x-node-id': sourceNodeId,
              },
              ...fileUploadBody(file),
            },
      );
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(uploadErrorMessage(body, `${slot.label}上传失败`));
      }
      const resultUrl = typeof body.url === 'string' ? body.url : '';
      const reference = localAssetReference(resultUrl, projectId, slot.mediaKind);
      if (!reference) throw new Error(`${slot.label}上传结果不属于当前项目`);

      return {
        id: sourceNodeId,
        type: canvasNodeTypeForMedia(slot.mediaKind) as WorkflowCanvasUploadedInputNode['type'],
        x: 0,
        y: 0,
        title: file.name,
        prompt: file.name,
        status: 'success',
        progress: 100,
        resultUrl,
        assetId: reference.assetId,
        projectId,
        model: 'Upload',
        aspectRatio: rule.directory === 'audios' ? '4:1' : '16:9',
        resolution: rule.directory === 'videos' ? '720p' : '1K',
      };
    },
    addToCanvas(blueprint, verified) {
      const requestId = crypto.randomUUID();
      return new Promise<WorkflowCanvasInsertionResult>((resolve, reject) => {
        const cleanup = () => {
          window.clearTimeout(timeout);
          window.removeEventListener(WORKFLOW_CANVAS_INSERTED_EVENT, onInserted);
        };
        const onInserted = (event: Event) => {
          const detail = (event as CustomEvent<Partial<WorkflowCanvasInsertionResult>>).detail;
          if (detail?.requestId !== requestId) return;
          if (!Array.isArray(detail.nodeIds) || typeof detail.workflowNodeId !== 'string') return;
          cleanup();
          resolve({ requestId, nodeIds: detail.nodeIds, workflowNodeId: detail.workflowNodeId });
        };
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error('画布没有确认节点已插入，请刷新画布后重试。'));
        }, 12_000);
        window.addEventListener(WORKFLOW_CANVAS_INSERTED_EVENT, onInserted);
        window.dispatchEvent(
          new CustomEvent(WORKFLOW_CANVAS_INSERT_REQUEST_EVENT, {
            detail: {
              requestId,
              blueprint: structuredClone(blueprint),
              ...(verified ? { verified: structuredClone(verified) } : {}),
            },
          }),
        );
      });
    },
    captureExample(nodes, workflowNodeId) {
      const workflowNode = nodes.find(
        (node): node is CanvasNode & WorkflowCanvasNodeRecord =>
          node.id === workflowNodeId && node.kind === 'workflow',
      );
      const definitionId = workflowNode?.workflowRef?.definitionId;
      if (!workflowNode || typeof definitionId !== 'string' || !definitionId) return false;

      const templates: WorkflowExampleNodeTemplate[] = [];
      const templateIdsByNodeId = new Map<string, string>();
      const parents = Array.isArray(workflowNode.parentIds) ? workflowNode.parentIds : [];
      const sourcePortIndices = Array.isArray(workflowNode.sourcePortIndices)
        ? workflowNode.sourcePortIndices
        : [];
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const slots = expandWorkflowStorageSlots(workflowNode);
      const inputBindings: WorkflowExampleInputBinding[] = [];

      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const parentId = parents[slotIndex];
        const parent = parentId ? byId.get(parentId) : undefined;
        if (!parent || !WORKFLOW_EXAMPLE_NODE_TYPES.has(parent.type)) continue;
        let templateId = templateIdsByNodeId.get(parent.id);
        if (!templateId) {
          if (templates.length >= WORKFLOW_EXAMPLE_MAX_NODES) break;
          templateId = `input-${templates.filter((item) => item.role === 'input').length}`;
          templateIdsByNodeId.set(parent.id, templateId);
          templates.push({
            templateId,
            role: 'input',
            type: parent.type,
            relativeX: finiteNumber(parent.x, 0, -20_000, 20_000) - workflowNode.x,
            relativeY: finiteNumber(parent.y, 0, -20_000, 20_000) - workflowNode.y,
            data: exampleNodeData(parent),
          });
        }
        inputBindings.push({
          slotKey: workflowInputSlotKey(slots[slotIndex]),
          templateId,
          sourcePortIndex: Math.max(0, Math.trunc(Number(sourcePortIndices[slotIndex]) || 0)),
        });
      }

      for (const child of nodes) {
        if (templates.length >= WORKFLOW_EXAMPLE_MAX_NODES) break;
        if (
          !WORKFLOW_EXAMPLE_NODE_TYPES.has(child.type) ||
          !Array.isArray(child.parentIds) ||
          !child.parentIds.includes(workflowNode.id) ||
          typeof child.workflowSourcePortId !== 'string'
        ) {
          continue;
        }
        templates.push({
          templateId: `output-${templates.filter((item) => item.role === 'output').length}`,
          role: 'output',
          type: child.type,
          relativeX: finiteNumber(child.x, 0, -20_000, 20_000) - workflowNode.x,
          relativeY: finiteNumber(child.y, 0, -20_000, 20_000) - workflowNode.y,
          outputPortId: child.workflowSourcePortId,
          data: exampleNodeData(child),
        });
      }

      if (templates.length === 0) return false;
      const bundle: WorkflowExampleBundle = {
        schemaVersion: 1,
        definitionId,
        capturedAt: Date.now(),
        nodes: templates,
        inputBindings,
      };
      const previous = exampleBundles.get(definitionId);
      exampleBundles.set(definitionId, bundle);
      if (!saveWorkflowExampleBundles(exampleBundles)) {
        if (previous) exampleBundles.set(definitionId, previous);
        else exampleBundles.delete(definitionId);
        return false;
      }
      return true;
    },
    hasExample(definitionId) {
      return exampleBundles.has(definitionId);
    },
    instantiateExample(blueprint, position = {}, sourceNodes = []) {
      const bundle = exampleBundles.get(blueprint.workflowRef.definitionId);
      const anchorX = finiteNumber(position.x, 160, -1_000_000, 1_000_000);
      const anchorY = finiteNumber(position.y, 140, -1_000_000, 1_000_000);
      if (!bundle || bundle.nodes.length === 0) {
        const node = adapter.createNode(blueprint, { x: anchorX, y: anchorY });
        const availableSources = [...sourceNodes]
          .filter((source) => source.id !== node.id && Boolean(mediaKindForNode(source)))
          .sort(
            (left, right) =>
              finiteNumber(left.y, 0, -1_000_000, 1_000_000) -
                finiteNumber(right.y, 0, -1_000_000, 1_000_000) ||
              finiteNumber(left.x, 0, -1_000_000, 1_000_000) -
                finiteNumber(right.x, 0, -1_000_000, 1_000_000),
          );
        const usedSourceIds = new Set<string>();
        for (const slot of expandWorkflowStorageSlots(node)) {
          const source = availableSources.find(
            (candidate) =>
              !usedSourceIds.has(candidate.id) &&
              mediaKindsCompatible(mediaKindForNode(candidate), slot.mediaKind),
          );
          if (!source) continue;
          node.parentIds[slot.slotIndex] = source.id;
          node.sourcePortIndices[slot.slotIndex] = 0;
          usedSourceIds.add(source.id);
        }
        return { nodes: [node], selectedNodeIds: [node.id], restoredExample: false };
      }

      const minimumX = Math.min(0, ...bundle.nodes.map((node) => node.relativeX));
      const minimumY = Math.min(0, ...bundle.nodes.map((node) => node.relativeY));
      const workflowNode = adapter.createNode(blueprint, {
        x: anchorX - minimumX,
        y: anchorY - minimumY,
      });
      const idsByTemplateId = new Map(
        bundle.nodes.map((template) => [template.templateId, crypto.randomUUID()]),
      );
      const inputNodes = bundle.nodes
        .filter((template) => template.role === 'input')
        .map((template) => ({
          ...structuredClone(template.data),
          id: idsByTemplateId.get(template.templateId)!,
          type: template.type,
          x: workflowNode.x + template.relativeX,
          y: workflowNode.y + template.relativeY,
          parentIds: [],
          sourcePortIndices: [],
        })) as CanvasNode[];
      const bindingBySlotKey = new Map(
        bundle.inputBindings.map((binding) => [binding.slotKey, binding]),
      );
      const freshSlots = expandWorkflowStorageSlots(workflowNode);
      workflowNode.parentIds = freshSlots.map((slot) => {
        const binding = bindingBySlotKey.get(workflowInputSlotKey(slot));
        return binding ? idsByTemplateId.get(binding.templateId) || '' : '';
      });
      workflowNode.sourcePortIndices = freshSlots.map((slot) => {
        const binding = bindingBySlotKey.get(workflowInputSlotKey(slot));
        return binding?.sourcePortIndex || 0;
      });

      const freshOutputPorts = new Map(
        workflowNode.outputPorts.map((port, index) => [port.id, index]),
      );
      const outputNodes = bundle.nodes
        .filter((template) => template.role === 'output')
        .flatMap((template) => {
          const portIndex = template.outputPortId
            ? freshOutputPorts.get(template.outputPortId)
            : undefined;
          if (portIndex === undefined) return [];
          return [
            {
              ...structuredClone(template.data),
              id: idsByTemplateId.get(template.templateId)!,
              type: template.type,
              x: workflowNode.x + template.relativeX,
              y: workflowNode.y + template.relativeY,
              parentIds: [workflowNode.id],
              sourcePortIndices: [portIndex],
              workflowSourcePortId: template.outputPortId,
            } as CanvasNode,
          ];
        });
      const restoredNodes: CanvasNode[] = [...inputNodes, workflowNode, ...outputNodes];
      return {
        nodes: restoredNodes,
        selectedNodeIds: restoredNodes.map((node) => node.id),
        restoredExample: true,
      };
    },
    instantiateVerifiedRun(blueprint, verified, position = {}) {
      if (verified.run.status !== 'success' || !verified.run.receipt) {
        throw new Error('只有成功并已保存输出的测试记录才能直接生成完整画布节点。');
      }
      if (!verified.projectId) throw new Error('成功测试记录缺少项目标识。');
      const anchorX = finiteNumber(position.x, 160, -1_000_000, 1_000_000);
      const anchorY = finiteNumber(position.y, 140, -1_000_000, 1_000_000);
      const slots = expandWorkflowStorageSlots(blueprint as unknown as CanvasNode);
      const inputNodes: CanvasNode[] = [];
      const inputNodeBySlot = new Map<number, CanvasNode>();
      let inputY = anchorY;

      for (const slot of slots) {
        if (slot.source === 'parameter') {
          const raw = verified.values[slot.bindingKey];
          if (typeof raw !== 'string') continue;
          const node: CanvasNode = {
            id: crypto.randomUUID(),
            type: 'Text',
            x: anchorX,
            y: inputY,
            width: 520,
            height: 320,
            title: slot.label,
            prompt: raw,
            textContent: raw,
            status: 'success',
            parentIds: [],
            sourcePortIndices: [],
          };
          inputNodes.push(node);
          inputNodeBySlot.set(slot.slotIndex, node);
          inputY += 380;
          continue;
        }
        const reference = verifiedAssetForSlot(verified.values[slot.bindingKey], slot.itemIndex);
        if (!reference || reference.projectId !== verified.projectId) continue;
        const type = canvasNodeTypeForMedia(slot.mediaKind);
        const node: CanvasNode = {
          id: crypto.randomUUID(),
          type,
          x: anchorX,
          y: inputY,
          width: 520,
          height: type === 'Upload Audio' ? 180 : 340,
          title: reference.filename || slot.label,
          prompt: reference.filename || slot.label,
          assetId: reference.assetId,
          projectId: reference.projectId,
          mediaType: slot.mediaKind,
          ...(reference.url ? { resultUrl: reference.url, url: reference.url } : {}),
          status: 'success',
          progress: 100,
          parentIds: [],
          sourcePortIndices: [],
        };
        inputNodes.push(node);
        inputNodeBySlot.set(slot.slotIndex, node);
        inputY += type === 'Upload Audio' ? 240 : 400;
      }

      const workflowX = anchorX + (inputNodes.length ? 680 : 0);
      const workflowNode = adapter.createNode(blueprint, { x: workflowX, y: anchorY });
      workflowNode.parameterValues = {
        ...workflowNode.parameterValues,
        ...structuredClone(verified.values),
      };
      workflowNode.parentIds = slots.map((slot) => inputNodeBySlot.get(slot.slotIndex)?.id || '');
      workflowNode.sourcePortIndices = slots.map(() => 0);
      Object.assign(workflowNode, runPatch(workflowNode, verified.run));

      const outputs = receiptOutputs(workflowNode, verified.run);
      const portIndexById = new Map(
        workflowNode.outputPorts.map((port, index) => [port.id, index]),
      );
      const outputNodes = outputs.map((output, index): CanvasNode => {
        const type = canvasNodeTypeForMedia(output.mediaKind);
        const text = outputText(output.value);
        return {
          id: crypto.randomUUID(),
          type,
          x: workflowNode.x + workflowNode.width + 180,
          y: workflowNode.y + index * (type === 'Upload Audio' ? 240 : 400),
          width: 520,
          height: type === 'Text' ? 320 : type === 'Upload Audio' ? 180 : 340,
          title: output.label || '工作流结果',
          prompt: text || output.label || workflowNode.title,
          ...(type === 'Text' ? { textContent: text, resultText: text } : {}),
          ...(output.url ? { resultUrl: output.url, url: output.url } : {}),
          ...(output.assetId ? { assetId: output.assetId, projectId: verified.projectId } : {}),
          mediaType: output.mediaKind,
          status: 'success',
          progress: 100,
          parentIds: [workflowNode.id],
          sourcePortIndices: [portIndexById.get(output.portId) || 0],
          workflowSourceRunId: verified.run.runId,
          workflowSourcePortId: output.portId,
          model: workflowNode.title,
        };
      });
      const nodes: CanvasNode[] = [...inputNodes, workflowNode, ...outputNodes];
      return {
        nodes,
        selectedNodeIds: nodes.map((node) => node.id),
        restoredExample: true,
      };
    },
    updateNode(node, blueprint) {
      const next = adapter.createNode(blueprint, { x: node.x, y: node.y });
      const previousSlots = expandWorkflowStorageSlots(node as unknown as CanvasNode);
      const nextSlots = expandWorkflowStorageSlots(next as unknown as CanvasNode);
      const previousByKey = new Map(
        previousSlots.map((slot) => [workflowInputSlotKey(slot), slot.slotIndex]),
      );
      const parentIds = nextSlots.map((slot) => {
        const previousIndex = previousByKey.get(workflowInputSlotKey(slot));
        return previousIndex === undefined ? '' : node.parentIds[previousIndex] || '';
      });
      const sourcePortIndices = nextSlots.map((slot) => {
        const previousIndex = previousByKey.get(workflowInputSlotKey(slot));
        return previousIndex === undefined ? 0 : node.sourcePortIndices[previousIndex] || 0;
      });
      const parameterValues = { ...next.parameterValues };
      for (const parameter of next.parameterSchema) {
        if (Object.hasOwn(node.parameterValues || {}, parameter.key)) {
          parameterValues[parameter.key] = node.parameterValues[parameter.key];
        }
      }
      normalizeSelectParameterValues(next.parameterSchema, parameterValues);
      return {
        ...node,
        ...next,
        id: node.id,
        x: node.x,
        y: node.y,
        parentIds,
        sourcePortIndices,
        parameterValues,
        status: 'idle',
        executionState: { status: 'idle' },
        workflowOutputs: [],
        resultUrl: undefined,
        resultUrls: undefined,
        resultText: undefined,
        errorMessage: undefined,
        errorSummary: undefined,
        isWorkflowErrorDetailsOpen: false,
        ...(next.executionTarget === 'cloud'
          ? {
              runningHubInstanceType: canvasRunningHubInstanceType(
                node.runningHubInstanceType || next.runningHubInstanceType,
              ),
            }
          : {}),
        isWorkflowParametersOpen: node.isWorkflowParametersOpen,
      };
    },
    reconcileNode(node) {
      registerWorkflowRecoveryOwner(node.id);
      const definitionId = node.workflowRef?.definitionId;
      const bindingSetId = node.workflowRef?.bindingSetId;
      const attestationId = node.workflowRef?.attestationId;
      const deploymentId = node.workflowRef?.deploymentId;
      if (!definitionId || !bindingSetId || (!attestationId && !deploymentId)) {
        return Promise.resolve(null);
      }
      const reconciliationKey = JSON.stringify([
        definitionId,
        bindingSetId,
        attestationId,
        deploymentId,
        node.canvasNodeHash,
        node.executionTarget,
        node.title,
      ]);
      const existing = reconciliations.get(reconciliationKey);
      if (existing)
        return existing.then((blueprint) =>
          blueprint
            ? blueprint.canvasNodeHash === node.canvasNodeHash
              ? { ...node, coverUrl: blueprint.coverUrl }
              : adapter.updateNode(node, blueprint)
            : null,
        );
      const promise = (async () => {
        const bindingSets = await client.listBindingSets(definitionId);
        const bindingSetsById = new Map(
          bindingSets.map((bindingSet) => [bindingSet.id, bindingSet]),
        );
        if (!bindingSetsById.has(bindingSetId)) return null;
        const isDescendant = (candidateId: string): boolean => {
          const visited = new Set<string>();
          let currentId: string | null | undefined = candidateId;
          while (currentId && !visited.has(currentId)) {
            if (currentId === bindingSetId) return true;
            visited.add(currentId);
            currentId = bindingSetsById.get(currentId)?.previousBindingSetId;
          }
          return false;
        };
        const latest = bindingSets
          .filter((bindingSet) => isDescendant(bindingSet.id))
          .sort((left, right) => right.revision - left.revision)[0];
        if (!latest) return null;
        if (latest.id === bindingSetId && node.executionTarget !== 'cloud') return null;
        const blueprint = await client.createCanvasNode(definitionId, {
          ...(attestationId ? { attestationId } : { deploymentId }),
          bindingSetId: latest.id,
          title: node.title,
        });
        if (
          blueprint.canvasNodeHash === node.canvasNodeHash &&
          blueprint.coverUrl === node.coverUrl
        )
          return null;
        return blueprint;
      })().finally(() => reconciliations.delete(reconciliationKey));
      reconciliations.set(reconciliationKey, promise);
      return promise.then((blueprint) =>
        blueprint
          ? blueprint.canvasNodeHash === node.canvasNodeHash
            ? { ...node, coverUrl: blueprint.coverUrl }
            : adapter.updateNode(node, blueprint)
          : null,
      );
    },
    getInputSlots(node) {
      registerWorkflowRecoveryOwner(node.id);
      return expandWorkflowInputSlots(node);
    },
    getInputCapacity(node) {
      return expandWorkflowStorageSlots(node).length;
    },
    getInputLimitNotice: workflowInputLimitNotice,
    getErrorSummary(node) {
      return workflowErrorSummary(node.errorMessage);
    },
    getInputPortY(_node, portIndex) {
      const slots = expandWorkflowInputSlots(_node);
      const index = slots.findIndex(
        (slot) => slot.slotIndex === Math.max(0, Math.trunc(portIndex)),
      );
      if (index < 0) return 242;
      if (!_node.isWorkflowParametersOpen) {
        return compactWorkflowPortY(_node, index, slots.length);
      }
      const slot = slots[index];
      if (slot?.source === 'parameter') {
        const textIndex = slots
          .slice(0, index)
          .filter((candidate) => candidate.source === 'parameter').length;
        return 126 + textIndex * 38;
      }
      const assetIndex = slots
        .slice(0, index)
        .filter((candidate) => candidate.source === 'input-port').length;
      return 242 + assetIndex * 59;
    },
    getOutputPortY(_node, portIndex) {
      if (!_node.isWorkflowParametersOpen) {
        const outputs = outputPorts(_node);
        const index = Math.min(Math.max(0, Math.trunc(portIndex)), Math.max(0, outputs.length - 1));
        return compactWorkflowPortY(_node, index, Math.max(1, outputs.length));
      }
      return 454 + Math.max(0, Math.trunc(portIndex)) * 34;
    },
    getMediaKindLabel: workflowMediaKindLabel,
    resolveAvailableInputSlot(target, source, sourcePortIndex = 0) {
      return resolveAvailableWorkflowInputSlot(target, source, sourcePortIndex);
    },
    getConnectionLimitNotice(target, source, sourcePortIndex = 0) {
      return workflowConnectionLimitNotice(target, source, sourcePortIndex);
    },
    resolvePortIndex(node, side, localY) {
      const slots = side === 'left' ? expandWorkflowInputSlots(node) : [];
      const count = side === 'left' ? slots.length : outputPorts(node).length;
      if (count === 0) return -1;
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < count; index += 1) {
        const y =
          side === 'left'
            ? adapter.getInputPortY(node, slots[index].slotIndex)
            : adapter.getOutputPortY(node, index);
        const candidateDistance = Math.abs(localY - y);
        if (candidateDistance < distance) {
          nearest = index;
          distance = candidateDistance;
        }
      }
      return side === 'left' ? slots[nearest].slotIndex : nearest;
    },
    getNodeSize(node) {
      const errorHeight = workflowErrorHeight(node);
      const progressHeight = node.status === 'loading' && !node.isWorkflowParametersOpen ? 44 : 0;
      return {
        width: finiteNumber(node.width, 600, 520, 760),
        height: node.isWorkflowParametersOpen
          ? expandedWorkflowHeight(node)
          : 320 + progressHeight + errorHeight,
      };
    },
    getOutputMediaKind: mediaKindForNode,
    getPrimaryMediaKind(node) {
      const ports = outputPorts(node);
      return ports.find((port) => port.primary)?.mediaKind || ports[0]?.mediaKind;
    },
    canConnect(target, source, targetPortIndex, sourcePortIndex = 0) {
      const parents = Array.isArray(target.parentIds) ? target.parentIds : [];
      return compatibleWorkflowInputSlots(target, source, sourcePortIndex).some(
        (slot) =>
          slot.slotIndex === targetPortIndex &&
          (!parents[targetPortIndex] || parents[targetPortIndex] === source.id),
      );
    },
    async run(node, connectedNodes, projectId, writePatch, scope) {
      requireWorkflowScope(scope);
      const onPatch = (patch: NodePatch) => {
        if (!scope || scope.isCurrent()) writePatch(patch);
      };
      registerWorkflowRecoveryOwner(node.id);
      let values: Record<string, unknown>;
      try {
        values = buildWorkflowCanvasValues(node, connectedNodes, projectId);
      } catch (error) {
        onPatch({
          status: 'error',
          executionState: { status: 'validation-error' },
          errorMessage: error instanceof Error ? error.message : '工作流输入校验失败',
          errorSummary: workflowErrorSummary(
            error instanceof Error ? error.message : '工作流输入校验失败',
          ),
          isWorkflowErrorDetailsOpen: false,
        });
        throw error;
      }
      const paid =
        node.executionTarget === 'cloud' || String(node.subtitle || '').startsWith('RunningHub');
      const instanceType = canvasRunningHubInstanceType(node.runningHubInstanceType);
      if (
        paid &&
        !(await requestAnchoredConfirmation({
          intent: 'paid',
          title: '提交 RunningHub 付费任务？',
          description:
            instanceType === 'plus'
              ? '本次使用 PLUS 48GB，大显存档位会产生较高费用；取消后远端任务仍可能继续。'
              : '本次使用 STANDARD 24GB 并会产生费用；取消后远端任务仍可能继续。',
          confirmLabel: '确认并运行',
          rememberKey: RUNNINGHUB_PAID_CONFIRMATION_KEY,
        }))
      ) {
        throw new Error('已取消 RunningHub 付费执行');
      }
      requireWorkflowScope(scope);
      onPatch({
        status: 'loading',
        executionState: { status: 'submitting' },
        errorMessage: undefined,
        errorSummary: undefined,
        isWorkflowErrorDetailsOpen: false,
      });
      try {
        const run = await client.startCanvasRun(node.workflowRef.definitionId, {
          attestationId: node.workflowRef.attestationId,
          ...(node.workflowRef.attestationId
            ? {}
            : { deploymentId: node.workflowRef.deploymentId }),
          bindingSetId: node.workflowRef.bindingSetId,
          canvasNodeHash: node.canvasNodeHash,
          projectId,
          values,
          confirmExecution: true,
          ...(paid ? { confirmPaidExecution: true as const } : {}),
          ...(paid ? { instanceType } : {}),
        });
        requireWorkflowScope(scope);
        onPatch(runPatch(scope?.getNode?.() ?? node, run));
        publishRunProgress(node, run);
        if (TERMINAL_STATUSES.has(run.status)) {
          publishExternalOutputs(node, run);
          return run;
        }
        return observe(node, run.runId, onPatch, scope);
      } catch (error) {
        onPatch({
          status: 'error',
          executionState: { status: 'submission-error' },
          errorMessage: error instanceof Error ? error.message : '工作流提交失败',
          errorSummary: workflowErrorSummary(
            error instanceof Error ? error.message : '工作流提交失败',
          ),
          isWorkflowErrorDetailsOpen: false,
        });
        throw error;
      }
    },
    async resume(node, onPatch, scope, continuePaused = false) {
      requireWorkflowScope(scope);
      registerWorkflowRecoveryOwner(node.id);
      const runId =
        typeof node.executionState?.runId === 'string' ? node.executionState.runId : undefined;
      if (!runId) return null;
      if (continuePaused && node.executionState?.phase === 'observation-paused') {
        const run = await client.continueObservation(runId);
        requireWorkflowScope(scope);
        if (run.runId !== runId) throw new Error('任务回执编号不匹配');
        onPatch(runPatch(scope?.getNode?.() ?? node, run));
        if (TERMINAL_STATUSES.has(run.status)) {
          publishExternalOutputs(node, run);
          return run;
        }
        if (run.phase === 'observation-paused') return run;
      }
      return observe(node, runId, onPatch, scope);
    },
    async cancel(node, onPatch, scope) {
      requireWorkflowScope(scope);
      registerWorkflowRecoveryOwner(node.id);
      const runId =
        typeof node.executionState?.runId === 'string' ? node.executionState.runId : undefined;
      if (!runId) return null;
      const run = await client.cancelRun(runId);
      requireWorkflowScope(scope);
      if (run.runId !== runId) throw new Error('任务回执编号不匹配');
      onPatch(runPatch(scope?.getNode?.() ?? node, run));
      publishRunProgress(node, run);
      return run;
    },
  };
  return adapter;
}

export function installWorkflowCanvasNodes(
  client: WorkflowCanvasClient,
): WorkflowCanvasNodesAdapter {
  const adapter = Object.freeze(createWorkflowCanvasNodes(client));
  window.__FISHERAI_WORKFLOW_NODES__ = adapter;
  return adapter;
}
