import crypto from 'node:crypto';
import { canRecoverGenerationTask, isRecoverableProvider, sanitizeRemoteTaskReference } from './generationTaskRecovery.js';

const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled', 'unknown']);

function cloneTask(task) {
  return task ? { ...task } : null;
}

function normalizeLimit(value) {
  if (value === 0) return 0; // Explicitly unlimited local admission; provider limits still apply.
  return Math.max(1, Number(value) || 1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createSchedulerCommitProof({ runId, receiptPayloadHash, finishedAt }) {
  const payload = {
    runId,
    status: 'success',
    receiptPayloadHash,
    finishedAt,
  };
  return {
    ...payload,
    commitHash: sha256(JSON.stringify(payload)),
  };
}

export function createGenerationCoordinator({
  parseTimeToMs = () => 15 * 60 * 1_000,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  minimumLeaseTtlMs = 180_000,
  leaseSafetyMarginMs = 120_000,
  taskStore = null,
} = {}) {
  const inFlightByModelId = new Map();
  const leases = new Map();
  const tasks = new Map();
  const controllers = new Map();
  let leaseSeed = 0;

  function persist(task) {
    taskStore?.upsert?.(cloneTask(task));
  }

  function getConcurrency(modelIdKey, maxConcurrent = 1) {
    const limit = normalizeLimit(maxConcurrent);
    const inFlight = Number(inFlightByModelId.get(modelIdKey) || 0);
    return {
      inFlight,
      maxConcurrent: limit,
      available: limit === 0 ? null : Math.max(0, limit - inFlight),
      blocked: limit > 0 && inFlight >= limit,
    };
  }

  function release(leaseId) {
    if (!leaseId) return false;
    const lease = leases.get(leaseId);
    if (!lease || lease.released) return false;

    lease.released = true;
    clearTimer(lease.timer);
    const current = Number(inFlightByModelId.get(lease.modelIdKey) || 0);
    const next = Math.max(0, current - 1);
    if (next === 0) inFlightByModelId.delete(lease.modelIdKey);
    else inFlightByModelId.set(lease.modelIdKey, next);
    leases.delete(leaseId);
    return true;
  }

  function transition(nodeId, status, details = {}, timestampMs = now(), expectedAttemptId) {
    const task = tasks.get(nodeId);
    if (
      !task
      || TERMINAL_STATUSES.has(task.status)
      || (expectedAttemptId && task.attemptId !== expectedAttemptId)
    ) return false;

    Object.assign(task, details, {
      status,
      updatedAt: new Date(timestampMs).toISOString(),
    });
    if (TERMINAL_STATUSES.has(status)) {
      task.finishedAt = task.updatedAt;
      const startedAtMs = Date.parse(task.createdAt);
      task.durationMs = Number.isFinite(startedAtMs) ? Math.max(0, timestampMs - startedAtMs) : 0;
      task.diagnosticCode =
        details.code ||
        (status === 'success'
          ? 'GENERATION_SUCCEEDED'
          : status === 'cancelled'
            ? 'GENERATION_CANCELLED'
            : status === 'unknown'
              ? 'WORKFLOW_RUN_UNKNOWN'
              : 'GENERATION_FAILED');
      release(task.leaseId);
      controllers.delete(nodeId);
    }
    persist(task);
    return cloneTask(task);
  }

  function expire(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease) return;
    const task = tasks.get(lease.nodeId);
    if (task && !TERMINAL_STATUSES.has(task.status)) {
      if (task.remoteTask || task.remoteSubmissionStarted) {
        controllers.get(task.nodeId)?.abort();
        finalizeUnknown(task.nodeId, {
          code: task.remoteTask ? 'GENERATION_OBSERVATION_INTERRUPTED' : 'GENERATION_SUBMISSION_UNKNOWN',
          error: '原任务仍可能在服务商运行，请先核对任务记录，避免重复生成。',
        }, task.attemptId);
        return;
      }
      transition(lease.nodeId, 'failed', {
        code: 'GENERATION_LEASE_EXPIRED',
        error: '生成任务超过最长执行时间，可重试。',
        retryable: true,
      });
      return;
    }
    release(leaseId);
  }

  function begin({
    nodeId,
    attemptId,
    kind,
    modelName,
    modelIdKey,
    maxConcurrent = 1,
    timeEstimate = '5min',
    generateCount = 1,
    metadata = {},
    leaseHeartbeatMs,
    absoluteTimeoutMs,
  }) {
    const taskId = String(nodeId || `generation-${now()}-${leaseSeed + 1}`);
    const concurrency = getConcurrency(modelIdKey, maxConcurrent);
    if (tasks.get(taskId)?.status === 'loading') {
      return {
        ok: false,
        code: 'NODE_GENERATION_ACTIVE',
        inFlight: concurrency.inFlight,
        maxConcurrent: concurrency.maxConcurrent,
      };
    }
    if (concurrency.blocked) {
      return {
        ok: false,
        code: 'MODEL_CONCURRENCY_LIMIT',
        inFlight: concurrency.inFlight,
        maxConcurrent: concurrency.maxConcurrent,
      };
    }

    const inFlight = concurrency.inFlight + 1;
    inFlightByModelId.set(modelIdKey, inFlight);
    const leaseId = `lease_${now()}_${++leaseSeed}_${taskId}`;
    const estimatedMs = Math.max(0, Number(parseTimeToMs(timeEstimate)) || 0);
    const ttlMs = Math.max(
      minimumLeaseTtlMs,
      estimatedMs * Math.max(1, Number(generateCount) || 1) + leaseSafetyMarginMs,
    );
    const heartbeatMs = Number.isFinite(Number(leaseHeartbeatMs))
      ? Math.max(1_000, Number(leaseHeartbeatMs))
      : ttlMs;
    const absoluteTtlMs = Number.isFinite(Number(absoluteTimeoutMs))
      ? Math.max(ttlMs, Number(absoluteTimeoutMs))
      : ttlMs;
    const controller = new AbortController();
    const startedAtMs = now();
    const timestamp = new Date(startedAtMs).toISOString();
    const task = {
      nodeId: taskId,
      attemptId: String(attemptId || crypto.randomUUID()),
      kind,
      modelName,
      modelIdKey,
      maxConcurrent: concurrency.maxConcurrent,
      leaseId,
      status: 'loading',
      retryable: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      absoluteDeadlineAt: new Date(startedAtMs + absoluteTtlMs).toISOString(),
      ...metadata,
    };
    const timer = setTimer(() => expire(leaseId), Math.min(heartbeatMs, absoluteTtlMs));

    leases.set(leaseId, {
      leaseId,
      attemptId: task.attemptId,
      nodeId: taskId,
      modelIdKey,
      timer,
      released: false,
      heartbeatMs,
      absoluteDeadlineMs: startedAtMs + absoluteTtlMs,
    });
    tasks.set(taskId, task);
    controllers.set(taskId, controller);
    persist(task);

    return {
      ok: true,
      leaseId,
      attemptId: task.attemptId,
      nodeId: taskId,
      signal: controller.signal,
      inFlight,
      maxConcurrent: concurrency.maxConcurrent,
      ttlMs,
      absoluteTtlMs,
    };
  }

  function adopt(taskRecord, {
    leaseHeartbeatMs = 30_000,
    absoluteDeadlineMs,
  } = {}) {
    const nodeId = String(taskRecord?.nodeId || '');
    if (!nodeId || taskRecord?.status !== 'loading' || TERMINAL_STATUSES.has(taskRecord?.status)) {
      return { ok: false, code: 'GENERATION_RECOVERY_NOT_ACTIVE' };
    }
    if (tasks.has(nodeId)) {
      const existing = tasks.get(nodeId);
      return {
        ok: true,
        nodeId,
        leaseId: existing.leaseId,
        signal: controllers.get(nodeId)?.signal,
        recovered: false,
      };
    }
    const modelIdKey = String(taskRecord.modelIdKey || 'comfy:recovered');
    const timestampMs = now();
    const persistedDeadline = Date.parse(taskRecord.absoluteDeadlineAt || '');
    const fallbackDeadline = timestampMs + Math.max(1_000, Number(absoluteDeadlineMs) || 30 * 60_000);
    const absoluteDeadline = Number.isFinite(persistedDeadline) ? persistedDeadline : fallbackDeadline;
    if (absoluteDeadline <= timestampMs) {
      const expired = {
        ...taskRecord,
        status: 'failed',
        phase: 'recovery-expired',
        code: 'WORKFLOW_RUN_TIMEOUT',
        diagnosticCode: 'WORKFLOW_RUN_TIMEOUT',
        error: '工作流测试在服务重启期间超过最长执行时间。',
        retryable: true,
        remoteMayContinue: Boolean(taskRecord.promptId),
        updatedAt: new Date(timestampMs).toISOString(),
        finishedAt: new Date(timestampMs).toISOString(),
      };
      tasks.set(nodeId, expired);
      persist(expired);
      return { ok: false, code: 'GENERATION_RECOVERY_EXPIRED', task: cloneTask(expired) };
    }
    const leaseId = `lease_${timestampMs}_${++leaseSeed}_${nodeId}`;
    const controller = new AbortController();
    const heartbeatMs = Math.max(1_000, Number(leaseHeartbeatMs) || 30_000);
    const task = {
      ...taskRecord,
      leaseId,
      phase: 'recovering',
      updatedAt: new Date(timestampMs).toISOString(),
      absoluteDeadlineAt: new Date(absoluteDeadline).toISOString(),
    };
    const timer = setTimer(
      () => expire(leaseId),
      Math.min(heartbeatMs, absoluteDeadline - timestampMs),
    );
    leases.set(leaseId, {
      leaseId,
      nodeId,
      modelIdKey,
      timer,
      released: false,
      heartbeatMs,
      absoluteDeadlineMs: absoluteDeadline,
    });
    tasks.set(nodeId, task);
    controllers.set(nodeId, controller);
    inFlightByModelId.set(modelIdKey, Number(inFlightByModelId.get(modelIdKey) || 0) + 1);
    persist(task);
    return {
      ok: true,
      nodeId,
      leaseId,
      signal: controller.signal,
      recovered: true,
      absoluteDeadlineMs: absoluteDeadline,
    };
  }

  function update(nodeId, details = {}, expectedAttemptId) {
    const task = tasks.get(nodeId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return false;
    return transition(nodeId, task.status, details, now(), expectedAttemptId);
  }

  function pauseObservation(nodeId, details = {}) {
    const task = tasks.get(nodeId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return false;
    const timestamp = new Date(now()).toISOString();
    release(task.leaseId);
    controllers.delete(nodeId);
    delete task.leaseId;
    Object.assign(task, details, {
      status: 'loading',
      phase: 'observation-paused',
      updatedAt: timestamp,
      observationPausedAt: details.observationPausedAt || timestamp,
    });
    persist(task);
    return cloneTask(task);
  }

  function reacquireObservation(nodeId, {
    leaseHeartbeatMs = 30_000,
    absoluteTimeoutMs = 30 * 60_000,
  } = {}) {
    const persisted = tasks.get(nodeId) || taskStore?.get?.(nodeId);
    if (!persisted || persisted.status !== 'loading' || persisted.phase !== 'observation-paused') {
      return { ok: false, code: 'WORKFLOW_OBSERVATION_NOT_PAUSED' };
    }
    if (!tasks.has(nodeId)) tasks.set(nodeId, { ...persisted });
    const task = tasks.get(nodeId);
    const concurrency = getConcurrency(task.modelIdKey, task.maxConcurrent ?? 1);
    if (concurrency.blocked) {
      return { ok: false, code: 'MODEL_CONCURRENCY_LIMIT' };
    }
    const timestampMs = now();
    const heartbeatMs = Math.max(1_000, Number(leaseHeartbeatMs) || 30_000);
    const absoluteTtlMs = Math.max(heartbeatMs, Number(absoluteTimeoutMs) || 30 * 60_000);
    const leaseId = `lease_${timestampMs}_${++leaseSeed}_${nodeId}`;
    const controller = new AbortController();
    const timer = setTimer(() => expire(leaseId), Math.min(heartbeatMs, absoluteTtlMs));
    leases.set(leaseId, {
      leaseId,
      nodeId,
      modelIdKey: task.modelIdKey,
      timer,
      released: false,
      heartbeatMs,
      absoluteDeadlineMs: timestampMs + absoluteTtlMs,
    });
    inFlightByModelId.set(task.modelIdKey, concurrency.inFlight + 1);
    controllers.set(nodeId, controller);
    Object.assign(task, {
      leaseId,
      phase: 'observation-resuming',
      code: undefined,
      error: undefined,
      retryable: false,
      updatedAt: new Date(timestampMs).toISOString(),
      observationResumedAt: new Date(timestampMs).toISOString(),
      absoluteDeadlineAt: new Date(timestampMs + absoluteTtlMs).toISOString(),
    });
    persist(task);
    return {
      ok: true,
      nodeId,
      leaseId,
      signal: controller.signal,
      task: cloneTask(task),
    };
  }

  function heartbeat(nodeId) {
    const task = tasks.get(nodeId);
    const lease = task ? leases.get(task.leaseId) : null;
    if (!task || !lease || TERMINAL_STATUSES.has(task.status)) return false;
    const timestampMs = now();
    const remainingMs = lease.absoluteDeadlineMs - timestampMs;
    if (remainingMs <= 0) {
      expire(lease.leaseId);
      return false;
    }
    clearTimer(lease.timer);
    lease.timer = setTimer(() => expire(lease.leaseId), Math.min(lease.heartbeatMs, remainingMs));
    task.updatedAt = new Date(timestampMs).toISOString();
    task.lastHeartbeatAt = task.updatedAt;
    persist(task);
    return cloneTask(task);
  }

  function complete(nodeId, result = {}, expectedAttemptId) {
    return transition(nodeId, 'success', {
      ...result,
      code: undefined,
      error: undefined,
      retryable: false,
    }, now(), expectedAttemptId);
  }

  function completeIfActive(nodeId, receiptPayloadHash, pendingReceiptId) {
    if (!/^[a-f\d]{64}$/i.test(String(receiptPayloadHash || ''))) return false;
    if (!String(pendingReceiptId || '').trim()) return false;
    const task = tasks.get(nodeId);
    if (!task || TERMINAL_STATUSES.has(task.status) || controllers.get(nodeId)?.signal.aborted) {
      return false;
    }
    const timestampMs = now();
    const finishedAt = new Date(timestampMs).toISOString();
    const schedulerCommitProof = createSchedulerCommitProof({
      runId: nodeId,
      receiptPayloadHash,
      finishedAt,
    });
    return transition(nodeId, 'success', {
      receiptPayloadHash,
      pendingReceiptId,
      schedulerCommitProof,
      code: undefined,
      error: undefined,
      retryable: false,
      remoteMayContinue: false,
      remoteCancelConfirmed: true,
    }, timestampMs);
  }

  function fail(nodeId, details = {}, expectedAttemptId) {
    return transition(nodeId, 'failed', {
      code: details.code || 'GENERATION_FAILED',
      error: details.error || '生成失败，请重试。',
      retryable: Boolean(details.retryable),
      ...details,
    }, now(), expectedAttemptId);
  }

  function cancel(nodeId) {
    const task = tasks.get(nodeId);
    if (!task || TERMINAL_STATUSES.has(task.status)) {
      return { ok: false, code: 'GENERATION_NOT_ACTIVE', task: cloneTask(task) };
    }
    controllers.get(nodeId)?.abort();
    const cancelled = transition(nodeId, 'cancelled', {
      code: 'GENERATION_CANCELLED',
      error: '生成任务已取消。',
      retryable: true,
    });
    return { ok: true, task: cancelled };
  }

  function requestCancel(nodeId, details = {}) {
    const task = tasks.get(nodeId);
    if (!task || TERMINAL_STATUSES.has(task.status)) {
      return { ok: false, code: 'GENERATION_NOT_ACTIVE', task: cloneTask(task) };
    }
    controllers.get(nodeId)?.abort();
    const cancelling = update(nodeId, {
      phase: 'cancelling',
      cancellationRequestedAt: new Date(now()).toISOString(),
      remoteMayContinue: true,
      ...details,
    });
    return { ok: true, task: cancelling };
  }

  function finalizeCancel(nodeId, details = {}) {
    const cancelled = transition(nodeId, 'cancelled', {
      code: 'WORKFLOW_RUN_CANCELLED',
      error: '工作流测试已取消。',
      retryable: false,
      ...details,
    });
    return cancelled
      ? { ok: true, task: cancelled }
      : { ok: false, code: 'GENERATION_NOT_ACTIVE', task: getTask(nodeId) };
  }

  function finalizeUnknown(nodeId, details = {}, expectedAttemptId) {
    return transition(nodeId, 'unknown', {
      code: 'COMFYUI_SUBMISSION_UNKNOWN',
      error: '无法确认工作流是否已提交，系统不会自动重提。',
      retryable: false,
      remoteMayContinue: true,
      ...details,
    }, now(), expectedAttemptId);
  }

  function reconcileRemoteTask(nodeId, expectedAttemptId, status, details = {}) {
    const task = getTask(nodeId);
    if (!expectedAttemptId || task?.attemptId !== expectedAttemptId
      || !canRecoverGenerationTask(task) || !['success', 'failed', 'partial'].includes(status)) return false;
    const timestamp = new Date(now()).toISOString();
    const reconciled = {
      ...task, ...details, status: status === 'partial' ? 'unknown' : status, retryable: false, remoteMayContinue: false,
      code: status === 'success' ? undefined : details.code,
      error: status === 'success' ? undefined : details.error,
      diagnosticCode: status === 'success' ? 'GENERATION_RECOVERED' : details.code,
      updatedAt: timestamp, finishedAt: timestamp,
      durationMs: Math.max(0, now() - Date.parse(task.createdAt)),
    };
    persist(reconciled);
    tasks.set(nodeId, reconciled);
    return cloneTask(reconciled);
  }

  function recordRemoteTask(nodeId, expectedAttemptId, reference, slot = 0) {
    const task = getTask(nodeId);
    const remoteTask = sanitizeRemoteTaskReference(reference);
    if (!expectedAttemptId || task?.attemptId !== expectedAttemptId || !remoteTask
      || !isRecoverableProvider(task.kind, task.providerName) || task.providerName !== remoteTask.providerName) return false;
    let recordedReference = { remoteTask };
    if (task.kind === 'image') {
      if (!Number.isInteger(slot) || slot < 0 || slot >= task.requestedCount
        || slot >= task.remoteSubmissionCount) return false;
      const references = [...(task.remoteTasks || [])];
      if (references[slot] && JSON.stringify(references[slot]) !== JSON.stringify(remoteTask)) return false;
      references[slot] = remoteTask;
      recordedReference = { remoteTasks: references };
    }
    if (task.status === 'loading') return update(nodeId, recordedReference, expectedAttemptId);
    if (task.status !== 'unknown'
      || !['GENERATION_SUBMISSION_UNKNOWN', 'GENERATION_OBSERVATION_INTERRUPTED', 'GENERATION_INTERRUPTED'].includes(task.code)) return false;
    const recorded = {
      ...task, ...recordedReference, code: 'GENERATION_OBSERVATION_INTERRUPTED',
      diagnosticCode: 'GENERATION_OBSERVATION_INTERRUPTED', retryable: false,
      updatedAt: new Date(now()).toISOString(),
    };
    persist(recorded);
    tasks.set(nodeId, recorded);
    return cloneTask(recorded);
  }

  function recordRejectedSubmission(nodeId, expectedAttemptId, slot) {
    const task = getTask(nodeId);
    if (!expectedAttemptId || task?.attemptId !== expectedAttemptId
      || task.kind !== 'image' || task.providerName !== 'RelayImageProvider'
      || !Number.isInteger(slot) || slot < 0 || slot >= task.requestedCount
      || task.remoteSubmissionCount !== slot + 1 || task.remoteTasks?.[slot]) return false;
    const details = { remoteSubmissionCount: slot };
    if (task.status === 'loading') return update(nodeId, details, expectedAttemptId);
    if (task.status !== 'unknown'
      || !['GENERATION_SUBMISSION_UNKNOWN', 'GENERATION_OBSERVATION_INTERRUPTED', 'GENERATION_INTERRUPTED'].includes(task.code)) return false;
    const recorded = { ...task, ...details, updatedAt: new Date(now()).toISOString() };
    persist(recorded);
    tasks.set(nodeId, recorded);
    return cloneTask(recorded);
  }

  function getTask(nodeId) {
    return cloneTask(tasks.get(nodeId) || taskStore?.get?.(nodeId));
  }

  function isActive(nodeId) {
    const task = tasks.get(nodeId);
    const controller = task ? controllers.get(nodeId) : null;
    return task?.status === 'loading'
      && Boolean(task.leaseId && leases.has(task.leaseId) && controller && !controller.signal.aborted);
  }

  function dispose() {
    for (const lease of leases.values()) clearTimer(lease.timer);
    leases.clear();
    inFlightByModelId.clear();
    controllers.clear();
  }

  return {
    adopt,
    begin,
    cancel,
    complete,
    completeIfActive,
    dispose,
    fail,
    finalizeCancel,
    finalizeUnknown,
    getConcurrency,
    getTask,
    heartbeat,
    isActive,
    pauseObservation,
    reacquireObservation,
    reconcileRemoteTask,
    recordRemoteTask,
    recordRejectedSubmission,
    release,
    requestCancel,
    update,
  };
}
