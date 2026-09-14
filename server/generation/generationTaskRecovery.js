import crypto from 'node:crypto';
import { confirmedGenerationFailure } from './generationErrors.js';

const fingerprint = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const RECOVERABLE_PROVIDERS = {
  LibTvCliImageProvider: 'image',
  LibTvCliVideoProvider: 'video',
  SeedVr2ImageProvider: 'image',
  DreaminaCliImageProvider: 'image',
  DreaminaCliVideoProvider: 'video',
  RelayVideoProvider: 'video',
  RelayImageProvider: 'image',
  RunningHubVideoProvider: 'video',
  RunningHubGlobalVideoProvider: 'video',
  RunningHubImageProvider: 'image',
  RunningHubGlobalImageProvider: 'image',
};

// Persist only an explicit receipt, never a provider config, URL, header or key.
export function remoteTaskReference({ taskId, providerName, modelId, submitUrl, queryUrl, apiKey }) {
  if (!SAFE_ID.test(String(taskId || '')) || !apiKey || !submitUrl || !modelId) return null;
  return {
    version: 1,
    taskId: String(taskId),
    providerName,
    modelFingerprint: fingerprint(modelId),
    endpointFingerprint: fingerprint(new URL(submitUrl).href),
    credentialFingerprint: fingerprint(apiKey),
    ...(queryUrl ? { queryEndpointFingerprint: fingerprint(new URL(queryUrl).href) } : {}),
  };
}

export function sanitizeRemoteTaskReference(reference) {
  if (reference?.version !== 1 || !SAFE_ID.test(reference.taskId || '')
    || !Object.hasOwn(RECOVERABLE_PROVIDERS, reference.providerName)
    || (reference.queryEndpointFingerprint !== undefined
      && (typeof reference.queryEndpointFingerprint !== 'string' || !HASH.test(reference.queryEndpointFingerprint)))
    || ![reference.modelFingerprint, reference.endpointFingerprint, reference.credentialFingerprint]
      .every((value) => typeof value === 'string' && HASH.test(value))) return null;
  const { version, taskId, providerName, modelFingerprint, endpointFingerprint, credentialFingerprint } = reference;
  return { version, taskId, providerName, modelFingerprint, endpointFingerprint, credentialFingerprint,
    ...(reference.queryEndpointFingerprint ? { queryEndpointFingerprint: reference.queryEndpointFingerprint } : {}),
  };
}

export function matchesRemoteTask(reference, context) {
  const expected = sanitizeRemoteTaskReference(reference);
  if (!expected) return false;
  try {
    const current = remoteTaskReference({ ...context, taskId: expected.taskId });
    return current && Object.keys(expected).every((key) => expected[key] === current[key]);
  } catch {
    return false;
  }
}

export function remoteTaskReferences(task) {
  if (task?.kind === 'image') return Array.isArray(task.remoteTasks) ? task.remoteTasks.filter(Boolean) : [];
  return task?.remoteTask ? [task.remoteTask] : [];
}

export function isRecoverableProvider(kind, providerName) {
  return Object.hasOwn(RECOVERABLE_PROVIDERS, providerName) && RECOVERABLE_PROVIDERS[providerName] === kind;
}

export function canRecoverGenerationTask(task) {
  const references = remoteTaskReferences(task);
  return isRecoverableProvider(task?.kind, task?.providerName)
    && task.status === 'unknown'
    && ['GENERATION_INTERRUPTED', 'GENERATION_OBSERVATION_INTERRUPTED', 'GENERATION_SUBMISSION_UNKNOWN'].includes(task.code)
    && Boolean(task.attemptId && references.length && references.every((ref) =>
      sanitizeRemoteTaskReference(ref) && ref.providerName === task.providerName));
}

function submissionUnconfirmed(task) {
  return isRecoverableProvider(task?.kind, task?.providerName) && !remoteTaskReferences(task).length
    && task.status === 'unknown' && task.remoteSubmissionStarted === true
    && ['GENERATION_SUBMISSION_UNKNOWN', 'GENERATION_INTERRUPTED'].includes(task.code);
}

const RECOVERY_MESSAGES = {
  settings_changed: '当前通道或 Key 与原任务不一致，无法核对。请恢复原设置后继续核对，请勿重复生成。',
  pending: '服务商仍在处理原生成任务，正在等待结果，请勿重复生成。',
  query_auth_failed: '原任务查询鉴权失败，暂时无法确认结果。请检查原通道的 Key 或查询权限，请勿重复生成。',
  task_mismatch: '服务商返回的任务编号无法与原任务匹配，暂时无法确认结果，请勿重复生成。',
};
const waiting = (task, reason) => ({
  ...task,
  recoveryPending: true,
  error: reason === 'settings_changed' && task.providerName?.startsWith('DreaminaCli')
    ? '当前即梦账号与原任务不一致或授权暂不可用，请切换回原账号后继续核对，请勿重复生成。'
    : RECOVERY_MESSAGES[reason] || '暂时无法确认原生成任务的完整结果，正在继续核对，请勿重复生成。',
});

/** Demand-driven observation. This module has no submission method or execution lease. */
export function createGenerationTaskRecovery({
  coordinator, resolveProvider, saveResult, now = Date.now, intervalMs = 10_000, timeoutMs = 60_000,
}) {
  const observations = new Map();
  return async (task, appContext) => {
    if (submissionUnconfirmed(task)) return { ...waiting(task), error: task.error };
    if (!canRecoverGenerationTask(task)) return task;
    const key = JSON.stringify([task.nodeId, task.attemptId]);
    const previous = observations.get(key);
    if (previous?.promise) return previous.promise;
    if (previous && now() - previous.checkedAt < intervalMs) return waiting(coordinator.getTask(task.nodeId), previous.reason);
    const observation = { checkedAt: now(), promise: null };
    observations.set(key, observation);
    const abort = new AbortController();
    const isCurrent = () => {
      const current = coordinator.getTask(task.nodeId);
      return !abort.signal.aborted && current?.attemptId === task.attemptId
        && canRecoverGenerationTask(current);
    };
    let timer;
    observation.promise = (async () => {
      await Promise.resolve();
      try {
        const provider = resolveProvider(task);
        if (!provider) return waiting(task);
        if (!(await Promise.all(remoteTaskReferences(task).map((ref) => provider.canRecover(ref, appContext)))).every(Boolean)) {
          observation.reason = 'settings_changed';
          return waiting(task, observation.reason);
        }
        const result = await Promise.race([
          provider.recover(task, appContext, abort.signal),
          new Promise((_, reject) => {
            timer = setTimeout(() => { abort.abort(); reject(new Error('Recovery observation timed out')); }, timeoutMs);
          }),
        ]);
        if (!isCurrent()) return coordinator.getTask(task.nodeId);
        // Settings may have changed while querying/downloading. Re-resolve before writing.
        const currentProvider = resolveProvider(task);
        if (!currentProvider) return waiting(task);
        if (!(await Promise.all(remoteTaskReferences(task).map((ref) => currentProvider.canRecover(ref, appContext)))).every(Boolean)) {
          observation.reason = 'settings_changed';
          return waiting(task, observation.reason);
        }
        observation.reason = result?.status === 'pending' ? 'pending' : result?.reason;
        if (result?.status === 'success' || result?.status === 'partial') {
          const saved = await saveResult(result, task);
          if (isCurrent()) coordinator.reconcileRemoteTask(task.nodeId, task.attemptId, result.status, {
            ...saved,
            ...(result.status === 'partial' ? {
              code: 'GENERATION_PARTIAL_RESULTS',
              error: `已找回 ${result.results.length}/${task.requestedCount} 张图片，其余结果未完成。请核对服务商任务记录，系统不会自动补生成。`,
            } : {}),
          });
        } else if (result?.status === 'failed') {
          const failure = confirmedGenerationFailure(result.error);
          coordinator.reconcileRemoteTask(task.nodeId, task.attemptId, 'failed', {
            code: failure.code, error: failure.message,
          });
        }
        const current = coordinator.getTask(task.nodeId);
        return canRecoverGenerationTask(current) ? waiting(current, observation.reason) : current;
      } catch {
        const current = coordinator.getTask(task.nodeId);
        return canRecoverGenerationTask(current) ? waiting(current) : current;
      } finally {
        clearTimeout(timer);
        abort.abort();
        observation.checkedAt = now();
        observation.promise = null;
        // Bound inactive entries without evicting live observations (which would duplicate queries).
        for (const [id, entry] of observations) {
          if (observations.size <= 1_000) break;
          if (!entry.promise && id !== key) observations.delete(id);
        }
      }
    })();
    return observation.promise;
  };
}
