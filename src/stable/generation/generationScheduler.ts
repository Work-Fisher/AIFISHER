import { composeCreativePrompt } from '../prompt/creativePresets';
import { imageAnglePrompt } from '../prompt/imageAngle';

export type GenerationTaskStatus =
  | 'idle'
  | 'queued'
  | 'loading'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'timed-out';

export interface GenerationTaskState {
  nodeId: string;
  status: GenerationTaskStatus;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  resultUrl?: string;
  error?: string;
  generationDiagnosticCode?: string;
  generationDurationMs?: number;
  generationEstimatedCost?: number;
  generationProviderName?: string;
}

export type GenerationTaskEvent =
  | { type: 'enqueue'; at: number }
  | { type: 'start'; at: number }
  | { type: 'succeed'; at: number; resultUrl?: string }
  | { type: 'fail'; at: number; error: string }
  | { type: 'cancel'; at: number }
  | { type: 'timeout'; at: number };

export interface GenerationPromptNode {
  id: string;
  type: string;
  x?: number;
  y?: number;
  parentIds?: string[];
  prompt?: unknown;
  textContent?: unknown;
  [key: string]: unknown;
}

export interface ConnectedTextBinding {
  nodeId: string;
  value: string;
}

export interface GenerationSchedulerAdapter {
  acquire(nodeId: string): boolean;
  release(nodeId: string, attemptId?: string): void;
  isInFlight(nodeId: string): boolean;
  currentAttempt(nodeId: string): string | null;
  decorateRequest<T extends Record<string, unknown>>(request: T): T & {
    generationAttemptId?: string;
  };
  subscribe(listener: () => void): () => void;
  version(): number;
  buildPrompt(nodes: readonly GenerationPromptNode[], node: GenerationPromptNode): string;
  legacyTextPatch(
    node: GenerationPromptNode,
    fallbackTextModel: string,
  ): Partial<GenerationPromptNode> | null;
  resolveConnectedText(
    connectedNodes: readonly GenerationPromptNode[],
  ): ConnectedTextBinding | null;
  transition(task: GenerationTaskState, event: GenerationTaskEvent): GenerationTaskState;
  getDiagnostics(): { acquired: number; rejected: number; active: number; promptBuilds: number };
}

declare global {
  interface Window {
    __FISHERAI_GENERATION_SCHEDULER__?: GenerationSchedulerAdapter;
  }
}

const ALLOWED_EVENTS: Record<GenerationTaskStatus, readonly GenerationTaskEvent['type'][]> = {
  idle: ['enqueue'],
  queued: ['start', 'cancel'],
  loading: ['succeed', 'fail', 'cancel', 'timeout'],
  success: ['enqueue'],
  error: ['enqueue'],
  cancelled: ['enqueue'],
  'timed-out': ['enqueue'],
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const LEGACY_TEXT_PASSTHROUGH_MODEL = '无（仅输入文字）';

function independentTemplate(node: GenerationPromptNode): string {
  const prompt = text(node.prompt);
  const body = text(node.textContent);
  if (
    node.type.toLowerCase() === 'text' &&
    node.textModel === LEGACY_TEXT_PASSTHROUGH_MODEL &&
    prompt &&
    prompt === body
  ) {
    return '';
  }
  return prompt;
}

export function legacyTextPatch(
  node: GenerationPromptNode,
  fallbackTextModel: string,
): Partial<GenerationPromptNode> | null {
  if (
    node.type.toLowerCase() !== 'text' ||
    node.textModel !== LEGACY_TEXT_PASSTHROUGH_MODEL
  ) {
    return null;
  }
  const patch: Partial<GenerationPromptNode> = { textModel: fallbackTextModel };
  if (text(node.prompt) && independentTemplate(node) === '') patch.prompt = '';
  return patch;
}

/**
 * 普通图像/视频/音频节点只把第一个直接连入的 Text 节点作为实时文本源。
 * 新文本节点的正文在 textContent；prompt 是独立的转换模板，不得混入绑定。
 * 只有历史节点缺少 textContent 时，才用 prompt 作兼容回退。
 */
export function resolveConnectedText(
  connectedNodes: readonly GenerationPromptNode[],
): ConnectedTextBinding | null {
  const node = connectedNodes.find(
    (candidate) => candidate.type.toLowerCase() === 'text' && typeof candidate.id === 'string',
  );
  if (!node) return null;
  return {
    nodeId: node.id,
    value:
      typeof node.textContent === 'string'
        ? node.textContent
        : typeof node.prompt === 'string'
          ? node.prompt
          : '',
  };
}

export function createGenerationScheduler(): GenerationSchedulerAdapter {
  const inFlight = new Map<string, string>();
  const listeners = new Set<() => void>();
  let acquired = 0;
  let rejected = 0;
  let promptBuilds = 0;
  let snapshotVersion = 0;

  const notify = () => {
    snapshotVersion += 1;
    for (const listener of listeners) listener();
  };

  return {
    acquire(nodeId) {
      if (inFlight.has(nodeId)) {
        rejected += 1;
        return false;
      }
      inFlight.set(nodeId, crypto.randomUUID());
      acquired += 1;
      notify();
      return true;
    },
    release(nodeId, attemptId) {
      if (attemptId && inFlight.get(nodeId) !== attemptId) return;
      if (inFlight.delete(nodeId)) notify();
    },
    isInFlight(nodeId) {
      return inFlight.has(nodeId);
    },
    currentAttempt(nodeId) {
      return inFlight.get(nodeId) || null;
    },
    decorateRequest(request) {
      if (typeof request.generationAttemptId === 'string' && request.generationAttemptId) return request;
      const nodeId = typeof request.nodeId === 'string' ? request.nodeId : '';
      const generationAttemptId = nodeId ? inFlight.get(nodeId) : undefined;
      return generationAttemptId ? { ...request, generationAttemptId } : request;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version() {
      return snapshotVersion;
    },
    buildPrompt(nodes, node) {
      promptBuilds += 1;
      const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
      const visited = new Set<string>();
      const upstreamTextNodes = new Map<string, GenerationPromptNode>();

      const pending = [...(node.parentIds ?? [])];
      while (pending.length) {
        const nodeId = pending.pop()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        const candidate = nodesById.get(nodeId);
        if (!candidate) continue;
        if (candidate.type.toLowerCase() === 'text' && text(candidate.textContent)) {
          upstreamTextNodes.set(candidate.id, candidate);
        }
        for (const parentId of candidate.parentIds ?? []) pending.push(parentId);
      }

      const upstreamText = [...upstreamTextNodes.values()]
        .sort(
          (first, second) =>
            Number(first.y ?? 0) - Number(second.y ?? 0) ||
            Number(first.x ?? 0) - Number(second.x ?? 0) ||
            first.id.localeCompare(second.id),
        )
        .map((candidate) => text(candidate.textContent));
      // Text 节点的大画布区是「正文」，下方生成面板是「转换模板」。
      // 两者必须分开保存，只在发起大模型请求时组合，否则模板会反向覆盖正文。
      const ownText = node.type.toLowerCase() === 'text' ? text(node.textContent) : '';
      return [composeCreativePrompt([...upstreamText, ownText, independentTemplate(node)].filter(Boolean).join('\n'), node.creativePresets, node.type), node.type === 'Image' ? imageAnglePrompt(node.imageAngle) : ''].filter(Boolean).join('\n');
    },
    legacyTextPatch,
    resolveConnectedText,
    transition(task, event) {
      if (!ALLOWED_EVENTS[task.status].includes(event.type)) {
        throw new Error(`invalid generation transition: ${task.status} -> ${event.type}`);
      }
      switch (event.type) {
        case 'enqueue':
          return {
            nodeId: task.nodeId,
            status: 'queued',
            queuedAt: event.at,
          };
        case 'start':
          return { ...task, status: 'loading', startedAt: event.at, error: undefined };
        case 'succeed':
          return {
            ...task,
            status: 'success',
            finishedAt: event.at,
            resultUrl: event.resultUrl,
            error: undefined,
          };
        case 'fail':
          return { ...task, status: 'error', finishedAt: event.at, error: event.error };
        case 'cancel':
          return { ...task, status: 'cancelled', finishedAt: event.at };
        case 'timeout':
          return { ...task, status: 'timed-out', finishedAt: event.at, error: 'timeout' };
      }
    },
    getDiagnostics() {
      return { acquired, rejected, active: inFlight.size, promptBuilds };
    },
  };
}

export function installGenerationScheduler(): GenerationSchedulerAdapter {
  if (window.__FISHERAI_GENERATION_SCHEDULER__) return window.__FISHERAI_GENERATION_SCHEDULER__;
  const adapter = Object.freeze(createGenerationScheduler());
  window.__FISHERAI_GENERATION_SCHEDULER__ = adapter;
  return adapter;
}
