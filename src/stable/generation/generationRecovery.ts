import { isWorkflowRecoveryRequest } from './workflowRecoveryBoundary';
import { generateImage, generateVideo } from './generationClient';
import { mergeImageResultHistory, type ImageResultHistoryNode } from './imageResultHistory';

export interface RecoverableNode extends ImageResultHistoryNode {
  id: string;
  type: string;
  status: string;
  generationAttemptId?: string;
  generationStartTime?: number;
  projectId?: string;
  [key: string]: unknown;
}

export interface GenerationRecoveryBinding {
  getNodes(): readonly RecoverableNode[];
  updateNode(nodeId: string, patch: Record<string, unknown>): void;
  extractLastFrame?(url: string): Promise<string | null>;
}

export interface GenerationRecoverySession {
  scan(): void;
  dispose(): void;
}

interface RecoveryResponse {
  status: string;
  recoveryPending?: boolean;
  attemptId?: string;
  type?: string;
  resultUrl?: string;
  resultUrls?: string[];
  text?: string;
  createdAt?: string;
  model?: string;
  error?: string;
  diagnosticCode?: string;
  code?: string;
  durationMs?: number;
  estimatedCost?: number;
  providerName?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
}

const DIRECT_TYPES = new Set(['image', 'video', 'audio', 'text']);
const OBSERVATION_INTERRUPTED = 'GENERATION_OBSERVATION_INTERRUPTED';

export function interruptedGenerationPatch(
  error: string | { code?: string; name?: string },
  attemptId: string,
): Record<string, unknown> {
  const code = typeof error === 'string' ? error : error?.code;
  const transportInterrupted =
    typeof error !== 'string' && ['TypeError', 'AbortError'].includes(error?.name || '');
  return ([OBSERVATION_INTERRUPTED, 'GENERATION_SUBMISSION_UNKNOWN'].includes(code || '') ||
    transportInterrupted) &&
    attemptId
    ? { generationAttemptId: attemptId, generationDiagnosticCode: OBSERVATION_INTERRUPTED }
    : {};
}

function eligible(node: RecoverableNode): boolean {
  return (
    (node.status === 'loading' ||
      (node.status === 'error' &&
        Boolean(node.generationAttemptId) &&
        node.generationDiagnosticCode === OBSERVATION_INTERRUPTED)) &&
    DIRECT_TYPES.has(node.type.toLowerCase()) &&
    !isWorkflowRecoveryRequest(`/api/generation-status/${encodeURIComponent(node.id)}`)
  );
}

function sameAttempt(current: RecoverableNode, expected: RecoverableNode): boolean {
  return (
    current.projectId === expected.projectId &&
    current.type === expected.type &&
    current.generationAttemptId === expected.generationAttemptId &&
    current.generationStartTime === expected.generationStartTime
  );
}

function terminalPatch(
  result: RecoveryResponse,
  node: RecoverableNode,
): Record<string, unknown> | null {
  if (result.status === 'unknown' && result.recoveryPending && node.generationAttemptId) {
    const errorMessage = result.error || '正在核对原生成任务，请勿重复生成。';
    if (
      node.status === 'error' &&
      node.generationDiagnosticCode === OBSERVATION_INTERRUPTED &&
      node.errorMessage === errorMessage
    )
      return null;
    return {
      status: 'error',
      errorMessage,
      ...interruptedGenerationPatch(OBSERVATION_INTERRUPTED, node.generationAttemptId),
    };
  }
  const diagnostics = {
    generationStartTime: undefined,
    generationAttemptId: undefined,
    generationDiagnosticCode: result.diagnosticCode || result.code,
    generationDurationMs: result.durationMs,
    generationEstimatedCost: result.estimatedCost,
    generationProviderName: result.providerName,
  };
  if (['failed', 'cancelled', 'unknown'].includes(result.status)) {
    return {
      ...diagnostics,
      ...(result.code === 'GENERATION_PARTIAL_RESULTS' &&
      result.type === 'image' &&
      result.resultUrls?.length
        ? {
            ...mergeImageResultHistory(node, result.resultUrls),
          }
        : {}),
      status: 'error',
      errorMessage:
        result.error ||
        (result.status === 'cancelled'
          ? '生成任务已取消。'
          : result.status === 'unknown'
            ? '生成结果尚未确认，请先核对服务商任务记录，避免重复生成。'
            : '生成任务未能完成。'),
    };
  }
  if (result.status !== 'success') return null;
  const resultUrls = result.resultUrls?.filter((url) => typeof url === 'string' && url);
  const resultUrl = result.resultUrl || resultUrls?.[0];
  if (result.type === 'text' ? typeof result.text !== 'string' : !resultUrl) return null;
  // 只有没有 attemptId 的旧项目需要时间兜底；有尝试标识时不依赖浏览器时钟。
  if (!node.generationAttemptId && node.generationStartTime) {
    const createdAt = Date.parse(result.createdAt || '');
    if (!Number.isFinite(createdAt) || createdAt < node.generationStartTime) return null;
  }
  return {
    ...diagnostics,
    status: 'success',
    errorMessage: undefined,
    resultUrl: result.type === 'text' ? undefined : resultUrl,
    ...(result.type === 'image'
      ? mergeImageResultHistory(node, resultUrls?.length ? resultUrls : [resultUrl])
      : {}),
    textContent: result.type === 'text' ? result.text : node.textContent,
    aspectRatio: result.aspectRatio || node.aspectRatio,
    resolution: result.resolution || node.resolution,
    duration: result.duration ?? node.duration,
    imageModel: (result.type === 'image' && result.model) || node.imageModel,
    videoModel: (result.type === 'video' && result.model) || node.videoModel,
    audioModel: (result.type === 'audio' && result.model) || node.audioModel,
    ...(result.type === 'video' ? { lastFrame: undefined } : {}),
  };
}

/** Owns read-only recovery for one mounted canvas. Never submits a generation request. */
export function mountGenerationRecovery(
  binding: GenerationRecoveryBinding,
  { fetchImpl = window.fetch.bind(window), intervalMs = 10_000, requestTimeoutMs = 15_000 } = {},
): GenerationRecoverySession {
  let disposed = false;
  const requests = new Map<string, { expected: RecoverableNode; abort: AbortController }>();
  const missing = new Map<string, { expected: RecoverableNode; since: number }>();

  const recover = async (node: RecoverableNode) => {
    const expected = { ...node };
    const abort = new AbortController();
    const request = { expected, abort };
    requests.set(node.id, request);
    const timeout = setTimeout(() => {
      abort.abort();
      if (requests.get(node.id) === request) requests.delete(node.id);
    }, requestTimeoutMs);
    try {
      const query = expected.generationAttemptId
        ? `?attemptId=${encodeURIComponent(expected.generationAttemptId)}`
        : '';
      const response = await fetchImpl(
        `/api/generation-status/${encodeURIComponent(node.id)}${query}`,
        {
          method: 'GET',
          cache: 'no-store',
          signal: abort.signal,
        },
      );
      if (!response.ok) return;
      let result = (await response.json()) as RecoveryResponse;
      if (disposed || abort.signal.aborted || !result || typeof result.status !== 'string') return;
      const current = binding.getNodes().find((candidate) => candidate.id === node.id);
      if (!current || !eligible(current) || !sameAttempt(current, expected)) return;
      // A terminal result without proof of this attempt cannot overwrite a newer run.
      if (expected.generationAttemptId && result.attemptId !== expected.generationAttemptId) return;
      if (result.status === 'missing') {
        const prior = missing.get(node.id);
        const since = prior && sameAttempt(prior.expected, expected) ? prior.since : Date.now();
        missing.set(node.id, { expected, since });
        // Allow registration to catch up. This is observation time, never the node's creation clock.
        if (Date.now() - since < 30_000) return;
        result = { ...result, status: 'unknown', recoveryPending: Boolean(expected.generationAttemptId),
          code: 'GENERATION_RECORD_MISSING',
          error: '未找到原生成任务记录，结果与费用尚未确认。请先核对服务商任务，勿重复生成。' };
      } else missing.delete(node.id);
      const patch = terminalPatch(result, current);
      if (patch) {
        // React will scan again after committing the terminal node. Release the
        // status request first so that scan does not cancel local frame extraction.
        clearTimeout(timeout);
        if (requests.get(node.id) === request) requests.delete(node.id);
        binding.updateNode(node.id, patch);
      }
      // Pending remains authoritative. Missing records never imply permission to resubmit.
    } catch {
      // A lost connection or expired session is not evidence of provider failure.
      // The session layer owns reauthentication; the next scan only queries status.
    } finally {
      clearTimeout(timeout);
      if (requests.get(node.id) === request) requests.delete(node.id);
    }
  };

  const scan = () => {
    if (disposed) return;
    const nodes = binding.getNodes();
    for (const [id, observation] of missing) {
      const current = nodes.find(node => node.id === id);
      if (!current || !eligible(current) || !sameAttempt(current, observation.expected)) missing.delete(id);
    }
    for (const [nodeId, request] of requests) {
      const current = nodes.find((node) => node.id === nodeId);
      if (!current || !eligible(current) || !sameAttempt(current, request.expected)) {
        request.abort.abort();
        requests.delete(nodeId);
      }
    }
    for (const node of nodes) {
      if (eligible(node) && !requests.has(node.id)) void recover(node);
    }
  };
  const interval = setInterval(scan, intervalMs);
  scan();
  return {
    scan,
    dispose() {
      disposed = true;
      clearInterval(interval);
      for (const request of requests.values()) request.abort.abort();
      requests.clear();
      missing.clear();
    },
  };
}

/** One owner for video frames, including uploads and recovered/regenerated videos. */
export function mountVideoFrameRecovery(
  binding: GenerationRecoveryBinding,
): GenerationRecoverySession {
  let disposed = false;
  const jobs = new Map<string, RecoverableNode>();
  const isVideo = (node: RecoverableNode) =>
    ['video', 'uploadvideo'].includes(node.type.toLowerCase().replace(/[\s_-]/g, '')) &&
    node.status === 'success' &&
    typeof node.resultUrl === 'string' &&
    Boolean(node.resultUrl);
  const matches = (node: RecoverableNode, expected: RecoverableNode) =>
    isVideo(node) && sameAttempt(node, expected) && node.resultUrl === expected.resultUrl;
  const scan = () => {
    if (disposed || !binding.extractLastFrame) return;
    const nodes = binding.getNodes();
    for (const [id, expected] of jobs) {
      const current = nodes.find((node) => node.id === id);
      if (!current || !matches(current, expected)) jobs.delete(id);
    }
    for (const node of nodes) {
      if (!isVideo(node) || node.lastFrame || jobs.has(node.id)) continue;
      const expected = { ...node };
      jobs.set(node.id, expected);
      void binding
        .extractLastFrame(String(node.resultUrl))
        .then((lastFrame) => {
          const current = binding.getNodes().find((candidate) => candidate.id === node.id);
          if (
            !disposed &&
            jobs.get(node.id) === expected &&
            lastFrame &&
            current &&
            !current.lastFrame &&
            matches(current, expected)
          ) {
            binding.updateNode(node.id, { lastFrame });
          }
        })
        .catch(() => {
          // One extraction attempt per result; rerenders must not cause a retry storm.
        });
    }
  };
  scan();
  return {
    scan,
    dispose() {
      disposed = true;
      jobs.clear();
    },
  };
}

declare global {
  interface Window {
    __FISHERAI_GENERATION_RECOVERY__?: {
      mount: typeof mountGenerationRecovery;
      mountFrames: typeof mountVideoFrameRecovery;
      interruptedPatch: typeof interruptedGenerationPatch;
      generateVideo: typeof generateVideo;
      generateImage: typeof generateImage;
    };
  }
}

export function installGenerationRecovery(): void {
  window.__FISHERAI_GENERATION_RECOVERY__ = Object.freeze({
    mount: mountGenerationRecovery,
    mountFrames: mountVideoFrameRecovery,
    interruptedPatch: interruptedGenerationPatch,
    generateVideo,
    generateImage,
  });
  window.dispatchEvent(new Event('fisherai:generation-recovery-ready'));
}
