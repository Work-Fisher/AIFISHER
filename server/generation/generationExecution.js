import { annotateProviderError } from '../telemetry/providerDiagnostics.js';
import { classifyGenerationError, confirmedGenerationFailure, getUpstreamStatus } from './generationErrors.js';
import { isRecoverableProvider, sanitizeRemoteTaskReference } from './generationTaskRecovery.js';

const PROVIDER_METHODS = Object.freeze({
  image: 'generateImage',
  video: 'generateVideo',
  audio: 'generateAudio',
  text: 'generateText',
});

const RELAY_VISUAL_PROVIDERS = new Set([
  'RelayImageProvider',
  'RelayMidjourneyProvider',
  'RelayVideoProvider',
]);
const MINIMUM_RELAY_VISUAL_PROMPT_LENGTH = 5;

export class GenerationTaskError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'GenerationTaskError';
    Object.assign(this, details);
  }
}

function createCancelledError() {
  return Object.assign(new Error('Generation cancelled'), {
    name: 'AbortError',
    code: 'GENERATION_CANCELLED',
  });
}

function waitForProvider(providerPromise, signal) {
  if (signal.aborted) return Promise.reject(createCancelledError());
  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(createCancelledError());
    signal.addEventListener('abort', handleAbort, { once: true });
    Promise.resolve(providerPromise).then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

function normalizeEstimatedCost(value) {
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 && cost <= 1_000_000 ? cost : undefined;
}

export async function executeGenerationTask({
  kind,
  nodeId,
  modelName,
  providerName,
  executionContext,
  request,
  appContext,
  provider,
  coordinator,
  saveResult,
}) {
  const method = PROVIDER_METHODS[kind];
  if (!method || typeof provider?.[method] !== 'function') {
    throw new GenerationTaskError({
      code: 'UNSUPPORTED_GENERATION_PROVIDER',
      status: 400,
      retryable: false,
      message: `当前模型不支持${kind || '此类'}生成。`,
    });
  }
  const promptLength = [...String(request?.prompt || '').trim()].length;
  if (
    RELAY_VISUAL_PROVIDERS.has(providerName)
    && promptLength < MINIMUM_RELAY_VISUAL_PROMPT_LENGTH
  ) {
    throw new GenerationTaskError({
      code: 'PROMPT_TOO_SHORT',
      status: 400,
      retryable: false,
      message: `字数不够，请至少输入 ${MINIMUM_RELAY_VISUAL_PROMPT_LENGTH} 个字。`,
    });
  }

  const lease = coordinator.begin({
    nodeId,
    attemptId: request.generationAttemptId,
    kind,
    modelName,
    modelIdKey: executionContext.modelIdKey,
    maxConcurrent: executionContext.maxConcurrent,
    timeEstimate: executionContext.timeEstimate,
    generateCount: request.generateCount || 1,
    metadata: {
      projectId: request.projectId || 'default',
      prompt: request.prompt,
      providerName,
      estimatedCost: normalizeEstimatedCost(request.cost),
      ...(kind === 'image' ? {
        imageMode: request.imageMode, aspectRatio: request.aspectRatio, resolution: request.resolution,
        requestedCount: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(request.generateCount) || 1))),
      } : {}),
      ...(kind === 'video' ? {
        videoMode: request.videoMode, aspectRatio: request.aspectRatio,
        resolution: request.resolution, duration: request.duration,
      } : {}),
    },
  });
  if (!lease.ok) {
    throw new GenerationTaskError({
      ...lease,
      status: 429,
      retryable: true,
      message: '模型当前并发已满，请稍后重试。',
    });
  }

  let remoteSubmitted = false;
  try {
    if (request.agentAuthorizationId !== undefined) {
      if (!appContext?.GENERATION_BUDGETS) throw new GenerationTaskError({ code: 'BUDGET_UNAVAILABLE', status: 503, retryable: false, message: '生成授权服务不可用。' });
      try {
        // Reserve only after admission; a directory/client estimate is not a guaranteed ceiling.
        const ceiling = typeof provider.maximumCharge === 'function' ? await provider.maximumCharge(request, appContext) : null;
        if (lease.signal.aborted) throw createCancelledError();
        await appContext.GENERATION_BUDGETS.reserve({ projectId: request.projectId, authorizationId: request.agentAuthorizationId, request,
          maximumChargeMicros: ceiling?.guaranteed === true && ceiling.currency === 'CNY' ? ceiling.micros : undefined });
      } catch (error) { throw new GenerationTaskError({ code: error.code || 'BUDGET_UNAVAILABLE', status: error.status || 503, retryable: false, message: error.message || '生成授权未确认。' }); }
    }
    if (lease.signal.aborted) throw createCancelledError();
    const { agentAuthorizationId: _authorization, agentPlanId: _plan, ...providerRequest } = request;
    const providerResult = await waitForProvider(
      provider[method](
        { ...providerRequest, signal: lease.signal },
        // Provider secrets and library paths are non-enumerable live getters on app.locals.
        // Inherit them instead of spreading away those properties or copying secrets into records.
        Object.assign(Object.create(appContext || null), {
          signal: lease.signal, generationSignal: lease.signal,
          generationTaskSubmitting(slot = 0) {
            if (!isRecoverableProvider(kind, providerName)) return;
            if (!Number.isInteger(slot) || slot < 0 || slot >= (kind === 'image' ? 10 : 1)) throw createCancelledError();
            if (!coordinator.update(lease.nodeId, {
              remoteSubmissionStarted: true, remoteSubmissionCount: slot + 1,
            }, lease.attemptId)) throw createCancelledError();
          },
          generationTaskSubmitted(reference, slot = 0) {
            remoteSubmitted = true;
            const remoteTask = sanitizeRemoteTaskReference(reference);
            if (!remoteTask || providerName !== remoteTask.providerName || !isRecoverableProvider(kind, providerName)) return;
            if (!coordinator.recordRemoteTask(lease.nodeId, lease.attemptId, remoteTask, slot)) throw createCancelledError();
          },
          generationTaskSubmissionRejected(slot) {
            if (kind !== 'image' || providerName !== 'RelayImageProvider') return;
            coordinator.recordRejectedSubmission(lease.nodeId, lease.attemptId, slot);
          },
        }),
      ),
      lease.signal,
    );
    if (lease.signal.aborted || coordinator.getTask(lease.nodeId)?.attemptId !== lease.attemptId
      || coordinator.getTask(lease.nodeId)?.status !== 'loading') {
      throw createCancelledError();
    }
    let savedResult;
    try { savedResult = await saveResult(providerResult); }
    catch (error) { throw annotateProviderError(error, { stage: 'local' }); }
    coordinator.complete(lease.nodeId, savedResult, lease.attemptId);
    return savedResult;
  } catch (error) {
    const currentTask = coordinator.getTask(lease.nodeId);
    const remoteTask = currentTask?.remoteTask || (currentTask?.remoteTasks?.length === 1 ? currentTask.remoteTasks[0] : null);
    if (error?.diagnostics && remoteTask?.taskId) annotateProviderError(error, { taskId: remoteTask.taskId });
    if (error?.submissionUncertain || (currentTask?.attemptId === lease.attemptId
      && currentTask.status === 'unknown' && currentTask.code === 'GENERATION_SUBMISSION_UNKNOWN')) {
      const details = {
        code: 'GENERATION_SUBMISSION_UNKNOWN', status: 503, retryable: false,
        message: '生成提交响应中断，无法确认服务商是否已接单。请先核对服务商任务记录，避免重复生成。',
      };
      coordinator.finalizeUnknown(lease.nodeId, { ...details, error: details.message }, lease.attemptId);
      throw new GenerationTaskError({ ...details, upstreamStatus: getUpstreamStatus(error), ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}) });
    }
    // Batches still need to recover earlier successful children. A confirmed
    // single-image failure is already final and does not need another query.
    const confirmedImageFailure = kind === 'image' && currentTask?.requestedCount === 1 && error?.providerTaskFailed === true;
    if (remoteSubmitted && (!error?.providerTaskFailed || (kind === 'image' && !confirmedImageFailure))
      && coordinator.getTask(lease.nodeId)?.attemptId === lease.attemptId
      && ['loading', 'unknown'].includes(coordinator.getTask(lease.nodeId)?.status)) {
      const details = {
        code: 'GENERATION_OBSERVATION_INTERRUPTED', status: 503, retryable: false,
        message: '原生成任务已提交，正在核对结果，请勿重复生成。',
      };
      coordinator.finalizeUnknown(lease.nodeId, { ...details, error: details.message }, lease.attemptId);
      throw new GenerationTaskError({ ...details, upstreamStatus: getUpstreamStatus(error), ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}) });
    }
    const classified = confirmedImageFailure ? confirmedGenerationFailure(error)
      : error instanceof GenerationTaskError ? error : classifyGenerationError(error);
    coordinator.fail(lease.nodeId, {
      code: classified.code,
      error: classified.message,
      retryable: classified.retryable,
    }, lease.attemptId);
    throw new GenerationTaskError({ ...classified, message: classified.message, upstreamStatus: getUpstreamStatus(error), ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}) });
  }
}
