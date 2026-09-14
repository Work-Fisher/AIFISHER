import crypto from 'node:crypto';
import path from 'node:path';
import { compileWorkflowBindings, resolvePublicBindingValues } from './workflowBindingCompiler.js';
import { LocalComfyClient, LocalComfyClientError } from './localComfyClient.js';
import { localizeWorkflowOutputs } from './workflowOutputLocalizer.js';
import {
  classifyHistoryState,
  normalizeAvailableHistoryOutputs,
  normalizeHistoryOutputs,
  toOutputCandidateDto,
} from './workflowOutputs.js';
import { validateWorkflowRunReceipt } from './workflowRunResult.js';
import { createComfyOutputPlan } from './comfySavedOutputs.js';
import { workflowAssetKey } from './workflowAssetIdentity.js';

const MAX_STAGE_ASSETS = 20;
const MAX_STAGE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_RETAINED_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const SAFE_PROMPT_ID = /^[A-Za-z0-9._-]{1,200}$/;
const SAFE_DOMAIN_CODE = /^(?:WORKFLOW|COMFYUI|OUTPUT|ASSET|BINDING|INVALID|MISSING|CAPABILITY|MODEL|INPUT|GENERATION)_/;

export class LocalComfyExecutorError extends Error {
  constructor(message, code = 'WORKFLOW_EXECUTION_ERROR', status = 500, retryable = false) {
    super(message);
    this.name = 'LocalComfyExecutorError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function stagedHandleValue(handle) {
  return handle.subfolder ? `${handle.subfolder}/${handle.name}` : handle.name;
}

function extensionFor(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!/^\.[a-z\d]{1,10}$/.test(extension)) return '.bin';
  return extension;
}

function sanitizeFailureMessage(value, fallback = '工作流测试失败') {
  const message = String(value || fallback)
    .replace(/[\r\n]+/g, ' ')
    .replace(/file:\/\/\S+/gi, '[本机路径]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,;]+/g, '[本机路径]')
    .replace(/\/(?:Users|home|private|var|opt|mnt)\/[^\s,;]+/gi, '[本机路径]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b(?:api[_ -]?key|authorization|bearer|token|secret|password)\b\s*[:=]?\s*[^\s,;]+/gi, '[敏感信息]')
    .slice(0, 500);
  return message || fallback;
}

function safeFailureNodeErrors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    return [{
      nodeId: sanitizeFailureMessage(entry.nodeId, 'unknown-node').slice(0, 120),
      errorType: sanitizeFailureMessage(entry.errorType, 'validation').slice(0, 120),
      message: sanitizeFailureMessage(entry.message, '节点参数校验失败'),
    }];
  });
}

function assertPromptId(value) {
  const promptId = String(value || '');
  if (!SAFE_PROMPT_ID.test(promptId)) {
    throw new LocalComfyExecutorError(
      'ComfyUI 未返回有效 prompt_id',
      'COMFYUI_PROTOCOL_ERROR',
      502,
    );
  }
  return promptId;
}

function safeFailure(error) {
  if (error instanceof LocalComfyExecutorError) return error;
  if (error instanceof LocalComfyClientError) {
    const failure = new LocalComfyExecutorError(
      sanitizeFailureMessage(error.message),
      error.code,
      error.status,
      ['COMFYUI_UNAVAILABLE', 'COMFYUI_REQUEST_TIMEOUT'].includes(error.code),
    );
    failure.nodeErrors = safeFailureNodeErrors(error.details?.nodeErrors);
    return failure;
  }
  if (typeof error?.code === 'string' && SAFE_DOMAIN_CODE.test(error.code)) {
    return new LocalComfyExecutorError(
      sanitizeFailureMessage(error.message),
      error.code,
      Number(error.status) || 400,
      Boolean(error.retryable),
    );
  }
  return new LocalComfyExecutorError('工作流测试失败', 'WORKFLOW_EXECUTION_ERROR');
}

export class LocalComfyExecutor {
  constructor({
    definitionStore,
    configurationStore,
    deploymentService,
    assetResolver,
    runStore,
    coordinator,
    directoryGrantStore = null,
    libraryDirectory,
    clientFactory = (options) => new LocalComfyClient(options),
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now = () => Date.now(),
    logger = console,
  }) {
    Object.assign(this, {
      definitionStore,
      configurationStore,
      deploymentService,
      assetResolver,
      runStore,
      coordinator,
      directoryGrantStore,
      libraryDirectory,
      clientFactory,
      wait,
      now,
      logger,
    });
  }

  createSnapshotAssetSession(runId) {
    const cache = new Map();
    const snapshots = [];
    let reservedAssets = 0;
    let reservedBytes = 0;
    let budgetLock = Promise.resolve();

    const withBudgetLock = async (operation) => {
      const previous = budgetLock;
      let release;
      budgetLock = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return operation();
      } finally {
        release();
      }
    };

    const resolve = async (reference) => {
      const key = workflowAssetKey(reference);
      if (cache.has(key)) return cache.get(key);
      const pending = (async () => {
        const inspected = await this.assetResolver.resolve(reference);
        await withBudgetLock(() => {
          if (
            reservedAssets + 1 > MAX_STAGE_ASSETS
            || reservedBytes + Number(inspected.bytes || 0) > MAX_STAGE_BYTES
          ) {
            throw new LocalComfyExecutorError(
              '单次工作流最多暂存 20 个素材且总量不超过 4 GiB',
              'WORKFLOW_STAGE_QUOTA_EXCEEDED',
              413,
            );
          }
          reservedAssets += 1;
          reservedBytes += Number(inspected.bytes || 0);
        });
        let snapshot;
        try {
          snapshot = await this.assetResolver.resolve(reference, { snapshotRunId: runId });
          if (
            snapshot.sha256 !== inspected.sha256
            || snapshot.bytes !== inspected.bytes
          ) {
            throw new LocalComfyExecutorError(
              '素材在创建运行快照期间发生变化',
              'WORKFLOW_ASSET_INTEGRITY_ERROR',
              409,
            );
          }
          snapshots.push(snapshot);
          return snapshot;
        } catch (error) {
          await snapshot?.disposeSnapshot?.().catch(() => undefined);
          await withBudgetLock(() => {
            reservedAssets -= 1;
            reservedBytes -= Number(inspected.bytes || 0);
          });
          throw error;
        }
      })();
      cache.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        cache.delete(key);
        throw error;
      }
    };
    return { resolve, snapshots };
  }

  async stageInputs({ runId, deployment, client, assets, stageLedger, signal }) {
    const uniqueAssets = [...new Map(assets.map((asset) => [workflowAssetKey(asset), asset])).values()];
    const totalBytes = uniqueAssets.reduce((total, asset) => total + Number(asset.bytes || 0), 0);
    if (uniqueAssets.length > MAX_STAGE_ASSETS || totalBytes > MAX_STAGE_BYTES) {
      throw new LocalComfyExecutorError(
        '单次工作流最多暂存 20 个素材且总量不超过 4 GiB',
        'WORKFLOW_STAGE_QUOTA_EXCEEDED',
        413,
      );
    }
    const cleanupEnabled = Boolean(deployment.inputCleanupGrantId);
    const stagedByAssetId = new Map();
    const ledgerEntries = [];
    Object.assign(stageLedger, {
      stagedByAssetId,
      ledgerEntries,
      totalBytes: 0,
    });
    const persistLedger = () => this.runStore.saveInputStageLedger(runId, {
      deploymentId: deployment.id,
      cleanupGrantId: deployment.inputCleanupGrantId,
      cleanupState: cleanupEnabled ? 'pending' : 'retained-cache',
      totalBytes: stageLedger.totalBytes,
      entries: ledgerEntries,
    });
    const uploadPlans = uniqueAssets.map((asset) => {
      const extension = extensionFor(asset.filename);
      const subfolder = cleanupEnabled
        ? `fisherai-runs/${runId}`
        : `fisherai-cache/${asset.sha256.slice(0, 2)}`;
      const filename = cleanupEnabled
        ? `${crypto.randomUUID()}${extension}`
        : `${asset.sha256}${extension}`;
      const plannedRelativeHandle = `${subfolder}/${filename}`;
      const ledgerEntry = {
        assetId: asset.assetId,
        sha256: asset.sha256,
        bytes: asset.bytes,
        relativeHandle: plannedRelativeHandle,
        state: 'uploading',
      };
      return { asset, filename, subfolder, ledgerEntry };
    });
    if (cleanupEnabled) {
      await persistLedger();
    } else {
      ledgerEntries.push(...uploadPlans.map((plan) => plan.ledgerEntry));
      stageLedger.totalBytes = totalBytes;
      await this.runStore.reserveRetainedCache({
        runId,
        deploymentId: deployment.id,
        totalBytes,
        entries: ledgerEntries,
        maximumBytes: MAX_RETAINED_CACHE_BYTES,
      });
    }
    for (const { asset, filename, subfolder, ledgerEntry } of uploadPlans) {
      if (cleanupEnabled) {
        ledgerEntries.push(ledgerEntry);
        stageLedger.totalBytes += Number(asset.bytes || 0);
      }
      // Persist the exact random target before the network side effect. If the
      // process exits after ComfyUI accepts the upload, recovery can still
      // verify and delete this precise file (or safely observe it as missing).
      if (cleanupEnabled) await persistLedger();
      const handle = await client.uploadInput({
        filePath: asset.filePath,
        filename,
        subfolder,
        overwrite: !cleanupEnabled,
        signal,
      });
      const staged = {
        ...asset,
        value: stagedHandleValue(handle),
        handle,
      };
      stagedByAssetId.set(workflowAssetKey(asset), staged);
      ledgerEntry.relativeHandle = staged.value;
      ledgerEntry.state = cleanupEnabled ? 'owned' : 'retained-cache';
      await persistLedger();
    }
    return stageLedger;
  }

  async cleanupInputs({ runId, deployment, stageLedger }) {
    if (!deployment.inputCleanupGrantId || !stageLedger || !this.directoryGrantStore) return;
    try {
      const result = await this.directoryGrantStore.deleteOwnedStagedFiles(
        deployment.inputCleanupGrantId,
        runId,
        stageLedger.ledgerEntries || stageLedger.entries || [],
      );
      await this.runStore.saveInputStageLedger(runId, {
        deploymentId: deployment.id,
        cleanupGrantId: deployment.inputCleanupGrantId,
        cleanupState: 'cleaned',
        totalBytes: stageLedger.totalBytes,
        entries: result.results,
      });
    } catch (error) {
      await this.runStore.saveInputStageLedger(runId, {
        deploymentId: deployment.id,
        cleanupGrantId: deployment.inputCleanupGrantId,
        cleanupState: 'orphaned',
        cleanupCode: error?.code || 'INPUT_CLEANUP_FAILED',
        totalBytes: stageLedger.totalBytes,
        entries: stageLedger.ledgerEntries || stageLedger.entries || [],
      }).catch(() => undefined);
      this.logger.error('Local ComfyUI staged input cleanup failed', {
        runId,
        code: error?.code || 'INPUT_CLEANUP_FAILED',
        errorType: error?.name || 'Error',
      });
    }
  }

  async markInputsOrphaned({
    runId,
    deployment,
    stageLedger,
    code = 'INPUT_CLEANUP_REMOTE_MAY_CONTINUE',
  }) {
    if (!stageLedger) return;
    await this.runStore.saveInputStageLedger(runId, {
      deploymentId: deployment?.id || stageLedger.deploymentId,
      cleanupGrantId: deployment?.inputCleanupGrantId || stageLedger.cleanupGrantId,
      cleanupState: 'orphaned',
      cleanupCode: code,
      totalBytes: Number(stageLedger.totalBytes || 0),
      entries: stageLedger.ledgerEntries || stageLedger.entries || [],
    });
  }

  async markRecoveryInputsOrphaned(task, code) {
    const runId = task?.nodeId;
    const [deployment, stageLedger] = await Promise.all([
      task?.deploymentId
        ? this.configurationStore.requireDeployment(task.deploymentId).catch(() => null)
        : null,
      runId
        ? this.runStore.requireInputStageLedger(runId).catch(() => null)
        : null,
    ]);
    if (stageLedger?.cleanupState !== 'pending') return;
    await this.markInputsOrphaned({ runId, deployment, stageLedger, code });
  }

  handleRealtimeEvent({ event, promptId, runId }) {
    const data = event?.data;
    const eventPromptId = String(data?.prompt_id || data?.promptId || '');
    if (!eventPromptId || eventPromptId !== promptId || !this.coordinator.isActive(runId)) return;
    const type = String(event?.type || '');
    if (type === 'execution_start') {
      this.coordinator.update(runId, { phase: 'running' });
      return;
    }
    if (type === 'executing') {
      const currentNodeId = data?.node == null ? null : String(data.node).slice(0, 120);
      this.coordinator.update(runId, {
        phase: currentNodeId ? 'running' : 'confirming-history',
        currentNodeId,
      });
      return;
    }
    if (type === 'progress') {
      const value = Number(data?.value);
      const maximum = Number(data?.max);
      if (Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0) {
        this.coordinator.update(runId, {
          phase: 'running',
          progress: {
            value: Math.max(0, value),
            maximum,
            currentNodeId: data?.node == null ? null : String(data.node).slice(0, 120),
          },
        });
      }
      return;
    }
    if (type === 'execution_cached' && Array.isArray(data?.nodes)) {
      this.coordinator.update(runId, {
        cachedNodeIds: data.nodes.slice(0, 1_000).map((nodeId) => String(nodeId).slice(0, 120)),
      });
      return;
    }
    if (['execution_success', 'execution_error', 'execution_interrupted'].includes(type)) {
      this.coordinator.update(runId, { phase: 'confirming-history' });
    }
  }

  async retryInputCleanup(runId) {
    const ledger = await this.runStore.requireInputStageLedger(runId);
    if (ledger.cleanupState === 'cleaned') {
      return {
        runId,
        state: 'cleaned',
        totalBytes: Number(ledger.totalBytes || 0),
        updatedAt: ledger.updatedAt,
      };
    }
    if (ledger.cleanupState !== 'orphaned') {
      throw new LocalComfyExecutorError(
        '只有已确认遗留的 ComfyUI 暂存输入可以重试清理',
        'INPUT_CLEANUP_NOT_RETRYABLE',
        409,
      );
    }
    const deployment = await this.configurationStore.requireDeployment(ledger.deploymentId);
    if (!deployment.inputCleanupGrantId || ledger.cleanupGrantId !== deployment.inputCleanupGrantId) {
      throw new LocalComfyExecutorError(
        '此运行没有可重试的输入目录清理授权',
        'INPUT_CLEANUP_UNAVAILABLE',
        409,
      );
    }
    const task = this.coordinator.getTask(runId);
    let stopped = task?.status === 'success' || (
      ['failed', 'cancelled'].includes(task?.status) && task.remoteMayContinue === false
    );
    if (!stopped && SAFE_PROMPT_ID.test(String(task?.promptId || ''))) {
      try {
        const client = this.clientFactory({ serverUrl: deployment.connection.serverUrl });
        const history = await client.getHistory(task.promptId);
        stopped = ['success', 'failed'].includes(classifyHistoryState(history, task.promptId).state);
      } catch { /* Unavailable history is not proof that the remote task stopped. */ }
    }
    if (!stopped) {
      throw new LocalComfyExecutorError(
        '原任务仍可能使用这些素材，确认 ComfyUI 任务结束后才能清理。',
        'INPUT_CLEANUP_REMOTE_MAY_CONTINUE', 409,
      );
    }
    await this.cleanupInputs({ runId, deployment, stageLedger: ledger });
    const current = await this.runStore.requireInputStageLedger(runId);
    if (current.cleanupState !== 'cleaned') {
      throw new LocalComfyExecutorError(
        '输入缓存清理仍未完成，请检查目录授权后重试',
        current.cleanupCode || 'INPUT_CLEANUP_FAILED',
        409,
      );
    }
    return {
      runId,
      state: current.cleanupState,
      totalBytes: Number(current.totalBytes || 0),
      updatedAt: current.updatedAt,
    };
  }

  async waitForHistory({ client, promptId, signal, runId, deadlineMs }) {
    let latestHistory = null;
    let absentSince = null;
    while (this.now() < deadlineMs) {
      if (signal.aborted) return { state: 'cancel-requested' };
      try {
        const history = await client.getHistory(promptId, { signal });
        latestHistory = history;
        const classified = classifyHistoryState(history, promptId);
        if (classified.state !== 'pending') return { ...classified, history };
        // A restarted ComfyUI may have lost the original job. Do not occupy a local
        // admission slot for the full observation window, and never resubmit it.
        if (!Object.hasOwn(history || {}, promptId) && typeof client.getQueue === 'function') {
          try {
            const queue = await client.getQueue({ signal });
            const valid = Array.isArray(queue?.queue_running) && Array.isArray(queue?.queue_pending)
              && [...queue.queue_running, ...queue.queue_pending].every(item =>
                Array.isArray(item) && typeof item[1] === 'string');
            const present = valid && [...queue.queue_running, ...queue.queue_pending]
              .some(item => item[1] === promptId);
            if (valid && !present) {
              absentSince ??= this.now();
              if (this.now() - absentSince >= 30_000) {
                this.coordinator.update(runId, { observationReason: 'original-job-not-found' });
                return { state: 'timeout', history };
              }
            } else absentSince = null;
          } catch {
            // A failed queue read is not evidence that the original task disappeared.
            absentSince = null;
          }
        } else absentSince = null;
      } catch (error) {
        // Once a prompt may have been submitted, an untrusted/oversized/malformed
        // history response cannot prove that the remote task stopped. Keep
        // observing until the deadline, then pause observation without changing
        // the remote job. Only an explicit user cancellation may stop it.
        absentSince = null;
        if (!(error instanceof LocalComfyClientError)) throw error;
        this.coordinator.update(runId, {
          historyObservationErrorCode: String(error.code || 'COMFYUI_PROTOCOL_ERROR').slice(0, 120),
        });
      }
      this.coordinator.heartbeat(runId);
      await this.wait(Math.min(1_000, Math.max(1, deadlineMs - this.now())));
    }
    return { state: 'timeout', history: latestHistory };
  }

  pauseObservation({ runId, promptId, deployment, history, executionPlan }) {
    let availableOutputs;
    try {
      availableOutputs = normalizeAvailableHistoryOutputs({
        history,
        promptId,
        executionPlan,
      }).map(toOutputCandidateDto);
    } catch {
      availableOutputs = [];
    }
    const task = this.coordinator.getTask(runId);
    return this.coordinator.pauseObservation(runId, {
      code: 'WORKFLOW_OBSERVATION_PAUSED',
      error: task?.observationReason === 'original-job-not-found'
        ? '在 ComfyUI 队列和历史中持续未找到原任务，已暂停观察并释放本机并发名额。请核对 ComfyUI 任务记录；不会自动重新提交。'
        : '已到当前观察上限，尚未确认工作流结果；任务未取消，可继续观察。',
      retryable: false,
      remoteMayContinue: true,
      promptId,
      observationWindowMs: deployment.timeoutMs,
      observationElapsedMs: Math.max(0, this.now() - Date.parse(task?.createdAt || ''))
        || deployment.timeoutMs,
      availableOutputs,
    });
  }

  async cancelRemote({ client, promptId, deployment }) {
    if (!promptId) {
      return { remoteMayContinue: false, remoteCancelConfirmed: true };
    }
    if (!deployment.runtimeProtocol.supportsAtomicJobCancel) {
      return { remoteMayContinue: true, remoteCancelConfirmed: false };
    }
    try {
      const result = await client.cancelJob(promptId);
      if (result !== null) return { remoteMayContinue: false, remoteCancelConfirmed: true };
      const history = await client.getHistory(promptId);
      const state = classifyHistoryState(history, promptId).state;
      return {
        remoteMayContinue: state === 'pending',
        remoteCancelConfirmed: state !== 'pending',
      };
    } catch {
      return { remoteMayContinue: true, remoteCancelConfirmed: false };
    }
  }

  async resume({ task, signal }) {
    const runId = task.nodeId;
    const rawPromptId = String(task.promptId || '');
    const promptId = rawPromptId ? (() => {
      try {
        return assertPromptId(rawPromptId);
      } catch {
        return '';
      }
    })() : '';
    if (rawPromptId && !promptId) {
      this.coordinator.fail(runId, {
        phase: 'recovery-failed',
        code: 'COMFYUI_PROTOCOL_ERROR',
        error: '恢复任务的 ComfyUI prompt_id 无效。',
        retryable: false,
        remoteMayContinue: true,
      });
      await this.markRecoveryInputsOrphaned(task, 'INPUT_CLEANUP_REMOTE_MAY_CONTINUE');
      return;
    }
    if (promptId && !/^[a-f\d]{64}$/i.test(String(task.compiledPromptHash || ''))) {
      this.coordinator.fail(runId, {
        phase: 'recovery-failed',
        code: 'WORKFLOW_RECOVERY_INSUFFICIENT_METADATA',
        error: '旧任务缺少编译快照，无法签发可信测试凭证。',
        retryable: false,
        remoteMayContinue: true,
      });
      await this.markRecoveryInputsOrphaned(task, 'INPUT_CLEANUP_REMOTE_MAY_CONTINUE');
      return;
    }

    let localized = null;
    let pendingReceipt = null;
    let schedulerCommitted = false;
    let deployment = null;
    let stageLedger;
    let remoteTerminalConfirmed = false;
    let observationPaused = false;
    let eventStream = null;
    let client = null;
    stageLedger = await this.runStore.requireInputStageLedger(runId).catch(() => null);
    if (!promptId) {
      deployment = task.deploymentId
        ? await this.configurationStore.requireDeployment(task.deploymentId).catch(() => null)
        : null;
      this.coordinator.fail(runId, {
        phase: 'recovery-failed',
        code: 'WORKFLOW_INTERRUPTED_BEFORE_SUBMISSION',
        error: '服务在工作流提交前中断；该任务没有发送到 ComfyUI。',
        retryable: true,
        remoteMayContinue: false,
      });
      if (stageLedger && deployment?.inputCleanupGrantId) {
        await this.cleanupInputs({ runId, deployment, stageLedger });
      } else if (stageLedger?.cleanupState === 'pending') {
        await this.markInputsOrphaned({
          runId,
          deployment,
          stageLedger,
          code: 'INPUT_CLEANUP_GRANT_UNAVAILABLE',
        });
      }
      return;
    }
    try {
      this.coordinator.update(runId, { phase: 'recovery-observing' });
      const [plan, loadedDeployment, bindingSet] = await Promise.all([
        this.definitionStore.readExecutionPlan(task.definitionId, {
          executionPlanHash: task.executionPlanHash,
        }),
        this.configurationStore.requireDeployment(task.deploymentId),
        this.configurationStore.requireBindingSet(task.bindingSetId),
      ]);
      deployment = loadedDeployment;
      const { definition, apiJson, executionPlanHash } = plan;
      const outputPlan = task.comfyOutputPlan || createComfyOutputPlan(apiJson);
      const definitionRevision = Number(task.definitionRevision);
      if (
        !Number.isInteger(definitionRevision)
        || definitionRevision < 1
        || deployment.definitionId !== definition.id
        || deployment.definitionRevision !== definitionRevision
        || bindingSet.definitionId !== definition.id
        || bindingSet.definitionRevision !== definitionRevision
        || deployment.executionPlanHash !== executionPlanHash
        || bindingSet.executionPlanHash !== executionPlanHash
      ) {
        throw new LocalComfyExecutorError(
          '恢复任务的工作流、部署与参数配置引用冲突',
          'WORKFLOW_REFERENCE_CONFLICT',
          409,
        );
      }
      client = this.clientFactory({
        serverUrl: deployment.connection.serverUrl,
        timeoutMs: deployment.timeoutMs,
      });
      if (typeof client.openEventStream === 'function') {
        try {
          eventStream = await client.openEventStream({
            clientId: `fisherai-${runId}`,
            signal,
            onEvent: (event) => this.handleRealtimeEvent({ event, promptId, runId }),
            onDisconnect: () => {
              if (this.coordinator.isActive(runId)) {
                this.coordinator.update(runId, { realtimeChannel: 'history-fallback' });
              }
            },
          });
          this.coordinator.update(runId, { realtimeChannel: 'websocket' });
        } catch {
          this.coordinator.update(runId, { realtimeChannel: 'history-fallback' });
        }
      } else {
        this.coordinator.update(runId, { realtimeChannel: 'history-fallback' });
      }
      const continuingObservation = task.phase === 'observation-resuming'
        || task.interruptedPhase === 'observation-paused';
      const persistedDeadline = Date.parse(task.absoluteDeadlineAt || '');
      let deadlineMs = continuingObservation
        ? this.now() + deployment.timeoutMs
        : Number.isFinite(persistedDeadline)
        ? persistedDeadline
        : this.now() + deployment.timeoutMs;
      const submissionWasUnknown = ['submitting', 'submission_unknown']
        .includes(task.interruptedPhase);
      if (submissionWasUnknown) deadlineMs = Math.min(deadlineMs, this.now() + 60_000);
      const terminal = await this.waitForHistory({
        client,
        promptId,
        deployment,
        signal,
        runId,
        deadlineMs,
      });
      if (
        submissionWasUnknown
        && (terminal.state === 'success' || terminal.state === 'failed')
      ) {
        this.coordinator.update(runId, {
          seedAdvancements: Array.isArray(task.pendingSeedAdvancements)
            ? task.pendingSeedAdvancements
            : [],
          seedAcceptedAt: new Date(this.now()).toISOString(),
        });
      }
      if (terminal.state === 'cancel-requested' || signal.aborted) {
        const remote = await this.cancelRemote({ client, promptId, deployment });
        remoteTerminalConfirmed = remote.remoteCancelConfirmed;
        this.coordinator.finalizeCancel(runId, { ...remote, promptId });
        return;
      }
      if (terminal.state === 'timeout') {
        if (submissionWasUnknown) {
          this.coordinator.finalizeUnknown(runId, { promptId });
          return;
        }
        observationPaused = true;
        this.pauseObservation({
          runId,
          promptId,
          deployment,
          history: terminal.history,
          executionPlan: outputPlan,
        });
        return;
      }
      remoteTerminalConfirmed = terminal.state !== 'pending';
      if (terminal.state === 'failed') {
        throw new LocalComfyExecutorError(
          'ComfyUI 执行工作流失败',
          'COMFYUI_EXECUTION_FAILED',
          409,
        );
      }
      if (terminal.state !== 'success') {
        throw new LocalComfyExecutorError(
          'ComfyUI history 终态无效',
          'COMFYUI_HISTORY_INVALID',
          502,
        );
      }

      this.coordinator.update(runId, { phase: 'recovery-localizing-outputs' });
      const candidates = normalizeHistoryOutputs({
        history: terminal.history,
        promptId,
        executionPlan: outputPlan,
      });
      localized = await localizeWorkflowOutputs({
        candidates,
        executionPlan: outputPlan,
        client,
        libraryDirectory: this.libraryDirectory,
        projectId: task.projectId,
        runId,
        stagingDirectory: path.join(this.runStore.rootDirectory, 'output-staging'),
        signal,
      });
      await this.deploymentService.verifyDeployment(deployment, apiJson);
      const receiptPayload = {
        id: runId,
        schemaVersion: 1,
        definitionId: definition.id,
        definitionRevision,
        executionPlanHash,
        bindingSetId: bindingSet.id,
        bindingSetHash: bindingSet.bindingSetHash,
        deploymentId: deployment.id,
        deploymentSnapshotHash: deployment.deploymentSnapshotHash,
        relevantCapabilityHash: deployment.relevantCapabilityHash,
        projectId: task.projectId,
        compiledPromptHash: task.compiledPromptHash,
        promptId,
        seeds: Array.isArray(task.resolvedSeeds) ? task.resolvedSeeds : [],
        outputs: localized.outputs,
        succeededAt: new Date(this.now()).toISOString(),
      };
      await validateWorkflowRunReceipt({
        coordinator: this.coordinator,
        configurationStore: this.configurationStore,
        runId,
        receipt: receiptPayload,
      });
      pendingReceipt = await this.runStore.stagePendingReceipt(runId, receiptPayload);
      const committed = this.coordinator.completeIfActive(
        runId,
        pendingReceipt.receiptPayloadHash,
        pendingReceipt.pendingReceiptId,
      );
      if (!committed) {
        await localized.rollback();
        await this.runStore.discardPendingReceipt(pendingReceipt.pendingReceiptId);
        return;
      }
      schedulerCommitted = true;
      await this.runStore.publishReceipt(
        pendingReceipt.pendingReceiptId,
        committed.schedulerCommitProof,
      );
      await localized.commit();
    } catch (error) {
      if (localized && !schedulerCommitted) {
        await localized.rollback().catch(() => undefined);
        if (pendingReceipt) {
          await this.runStore.discardPendingReceipt(pendingReceipt.pendingReceiptId)
            .catch(() => undefined);
        }
      }
      if (signal.aborted) {
        const remote = remoteTerminalConfirmed
          ? { remoteMayContinue: false, remoteCancelConfirmed: true }
          : client && deployment
            ? await this.cancelRemote({ client, promptId, deployment })
            : { remoteMayContinue: true, remoteCancelConfirmed: false };
        remoteTerminalConfirmed = remote.remoteCancelConfirmed;
        this.coordinator.finalizeCancel(runId, { ...remote, promptId });
        return;
      }
      const failure = safeFailure(error);
      this.coordinator.fail(runId, {
        phase: 'recovery-failed',
        code: failure.code,
        error: failure.message,
        retryable: failure.retryable,
        remoteMayContinue: Boolean(
          error?.remoteMayContinue ?? (promptId && !remoteTerminalConfirmed),
        ),
      });
      this.logger.error('Local ComfyUI workflow recovery failed', {
        runId,
        code: failure.code,
        errorType: error?.name || 'Error',
      });
    } finally {
      eventStream?.close();
      if (!observationPaused && stageLedger?.cleanupState === 'pending') {
        if (deployment?.inputCleanupGrantId && remoteTerminalConfirmed) {
          await this.cleanupInputs({ runId, deployment, stageLedger });
        } else {
          await this.markInputsOrphaned({
            runId,
            deployment,
            stageLedger,
            code: deployment?.inputCleanupGrantId
              ? 'INPUT_CLEANUP_REMOTE_MAY_CONTINUE'
              : 'INPUT_CLEANUP_GRANT_UNAVAILABLE',
          });
        }
      }
    }
  }

  async execute({
    runId,
    definitionId,
    deploymentId,
    bindingSetId,
    projectId,
    values,
    signal,
  }) {
    let localized = null;
    let pendingReceipt = null;
    let promptId = null;
    let schedulerCommitted = false;
    let activeDeployment = null;
    let activeClient = null;
    let stageLedger = null;
    let remoteTerminalConfirmed = false;
    let observationPaused = false;
    let eventStream = null;
    const assetSession = this.createSnapshotAssetSession(runId);
    const resolvedAssets = assetSession.snapshots;
    const seedResolutionCache = new Map();
    try {
      this.coordinator.update(runId, { phase: 'preflight' });
      const [{ definition, apiJson, executionPlanHash }, deployment, bindingSet] = await Promise.all([
        this.definitionStore.readExecutionPlan(definitionId),
        this.configurationStore.requireDeployment(deploymentId),
        this.configurationStore.requireBindingSet(bindingSetId),
      ]);
      activeDeployment = deployment;
      if (
        deployment.definitionId !== definition.id
        || deployment.definitionRevision !== definition.revision
        || bindingSet.definitionId !== definition.id
        || bindingSet.definitionRevision !== definition.revision
        || deployment.executionPlanHash !== executionPlanHash
        || bindingSet.executionPlanHash !== executionPlanHash
      ) {
        throw new LocalComfyExecutorError(
          '工作流、部署与参数配置引用冲突',
          'WORKFLOW_REFERENCE_CONFLICT',
          409,
        );
      }
      await this.deploymentService.verifyDeployment(deployment, apiJson);
      const publicValues = resolvePublicBindingValues(bindingSet, values || {});
      const preflight = await compileWorkflowBindings({
        executionPlan: apiJson,
        bindingSet,
        deployment,
        projectId,
        values: publicValues,
        resolveAsset: assetSession.resolve,
        seedResolutionCache,
      });
      if (signal.aborted) throw new LocalComfyExecutorError('工作流测试已取消', 'WORKFLOW_RUN_CANCELLED');

      const client = this.clientFactory({
        serverUrl: deployment.connection.serverUrl,
        timeoutMs: deployment.timeoutMs,
      });
      activeClient = client;
      this.coordinator.update(runId, { phase: 'staging-inputs' });
      stageLedger = {};
      await this.stageInputs({
        runId,
        deployment,
        client,
        assets: preflight.assets,
        stageLedger,
        signal,
      });
      await this.deploymentService.verifyDeployment(deployment, apiJson);
      const compiled = await compileWorkflowBindings({
        executionPlan: apiJson,
        bindingSet,
        deployment,
        projectId,
        values: publicValues,
        resolveAsset: async (reference) => {
          const staged = stageLedger.stagedByAssetId.get(workflowAssetKey(reference));
          if (!staged) {
            throw new LocalComfyExecutorError('暂存素材映射丢失', 'WORKFLOW_STAGE_INTEGRITY_ERROR');
          }
          return staged;
        },
        seedResolutionCache,
      });

      const outputPlan = createComfyOutputPlan(compiled.apiJson);
      const clientPromptId = crypto.randomUUID();
      let expectedPromptId = clientPromptId;
      if (typeof client.openEventStream === 'function') {
        try {
          eventStream = await client.openEventStream({
            clientId: `fisherai-${runId}`,
            signal,
            onEvent: (event) => this.handleRealtimeEvent({
              event,
              promptId: expectedPromptId,
              runId,
            }),
            onDisconnect: () => {
              if (this.coordinator.isActive(runId)) {
                this.coordinator.update(runId, { realtimeChannel: 'history-fallback' });
              }
            },
          });
          this.coordinator.update(runId, { realtimeChannel: 'websocket' });
        } catch {
          this.coordinator.update(runId, { realtimeChannel: 'history-fallback' });
        }
      } else {
        this.coordinator.update(runId, { realtimeChannel: 'history-fallback' });
      }
      this.coordinator.update(runId, {
        phase: 'submitting',
        compiledPromptHash: compiled.compiledPromptHash,
        comfyOutputPlan: outputPlan,
        promptId: clientPromptId,
        resolvedSeeds: compiled.resolvedSeeds,
        pendingSeedAdvancements: compiled.seedAdvancements,
      });
      let submission;
      try {
        submission = await client.submitPrompt({
          prompt: compiled.apiJson,
          clientId: `fisherai-${runId}`,
          promptId: clientPromptId,
          signal,
        });
        promptId = assertPromptId(submission?.prompt_id);
        expectedPromptId = promptId;
        this.coordinator.update(runId, {
          seedAdvancements: compiled.seedAdvancements,
          seedAcceptedAt: new Date(this.now()).toISOString(),
        });
      } catch (error) {
        const definitelyNotSubmitted = [
          'COMFYUI_PROMPT_REJECTED',
          'COMFYUI_PROMPT_SIZE_LIMIT',
          'INVALID_COMFYUI_CLIENT_ID',
          'COMFYUI_REDIRECT_REJECTED',
        ].includes(error?.code);
        if (definitelyNotSubmitted) throw error;
        // The request may already have reached ComfyUI even when the 200 body
        // is missing, invalid, oversized or carries an invalid prompt_id.
        // Observe the client UUID persisted before POST; never resubmit.
        promptId = clientPromptId;
        this.coordinator.update(runId, {
          phase: 'submission_unknown',
          promptId,
          remoteMayContinue: true,
        });
        const observed = await this.waitForHistory({
          client,
          promptId,
          deployment,
          signal,
          runId,
          deadlineMs: this.now() + Math.min(60_000, deployment.timeoutMs),
        });
        if (observed.state === 'pending' || observed.state === 'timeout') {
          this.coordinator.finalizeUnknown(runId, { promptId });
          return;
        }
        if (observed.state === 'success' || observed.state === 'failed') {
          this.coordinator.update(runId, {
            seedAdvancements: compiled.seedAdvancements,
            seedAcceptedAt: new Date(this.now()).toISOString(),
          });
        }
        submission = { recoveredFromUnknown: true, observed };
      }

      this.coordinator.update(runId, { phase: 'observing', promptId });
      const terminal = submission.observed || await this.waitForHistory({
        client,
        promptId,
        deployment,
        signal,
        runId,
        deadlineMs: this.now() + deployment.timeoutMs,
      });
      if (terminal.state === 'cancel-requested' || signal.aborted) {
        const remote = await this.cancelRemote({ client, promptId, deployment });
        remoteTerminalConfirmed = remote.remoteCancelConfirmed;
        this.coordinator.finalizeCancel(runId, { ...remote, promptId });
        return;
      }
      if (terminal.state === 'timeout') {
        observationPaused = true;
        this.pauseObservation({
          runId,
          promptId,
          deployment,
          history: terminal.history,
          executionPlan: outputPlan,
        });
        return;
      }
      if (terminal.state === 'failed') {
        remoteTerminalConfirmed = true;
        throw new LocalComfyExecutorError(
          'ComfyUI 执行工作流失败',
          'COMFYUI_EXECUTION_FAILED',
          409,
        );
      }
      if (terminal.state !== 'success') {
        remoteTerminalConfirmed = true;
        throw new LocalComfyExecutorError(
          'ComfyUI history 终态无效',
          'COMFYUI_HISTORY_INVALID',
          502,
        );
      }
      remoteTerminalConfirmed = true;

      this.coordinator.update(runId, { phase: 'localizing-outputs' });
      const candidates = normalizeHistoryOutputs({
        history: terminal.history,
        promptId,
        executionPlan: outputPlan,
      });
      localized = await localizeWorkflowOutputs({
        candidates,
        executionPlan: outputPlan,
        client,
        libraryDirectory: this.libraryDirectory,
        projectId,
        runId,
        stagingDirectory: path.join(this.runStore.rootDirectory, 'output-staging'),
        signal,
      });
      await this.deploymentService.verifyDeployment(deployment, apiJson);
      const succeededAt = new Date(this.now()).toISOString();
      const receiptPayload = {
        id: runId,
        schemaVersion: 1,
        definitionId: definition.id,
        definitionRevision: definition.revision,
        executionPlanHash,
        bindingSetId: bindingSet.id,
        bindingSetHash: bindingSet.bindingSetHash,
        deploymentId: deployment.id,
        deploymentSnapshotHash: deployment.deploymentSnapshotHash,
        relevantCapabilityHash: deployment.relevantCapabilityHash,
        projectId,
        compiledPromptHash: compiled.compiledPromptHash,
        promptId,
        seeds: compiled.resolvedSeeds,
        outputs: localized.outputs,
        succeededAt,
      };
      await validateWorkflowRunReceipt({
        coordinator: this.coordinator,
        configurationStore: this.configurationStore,
        runId,
        receipt: receiptPayload,
      });
      pendingReceipt = await this.runStore.stagePendingReceipt(runId, receiptPayload);
      const committed = this.coordinator.completeIfActive(
        runId,
        pendingReceipt.receiptPayloadHash,
        pendingReceipt.pendingReceiptId,
      );
      if (!committed) {
        await localized.rollback();
        await this.runStore.discardPendingReceipt(pendingReceipt.pendingReceiptId);
        return;
      }
      schedulerCommitted = true;
      await this.runStore.publishReceipt(
        pendingReceipt.pendingReceiptId,
        committed.schedulerCommitProof,
      );
      await localized.commit();
    } catch (error) {
      if (localized && !schedulerCommitted) {
        await localized.rollback().catch(() => undefined);
        if (pendingReceipt) {
          await this.runStore.discardPendingReceipt(pendingReceipt.pendingReceiptId)
            .catch(() => undefined);
        }
      }
      if (signal.aborted && this.coordinator.isActive(runId)) {
        const task = this.coordinator.getTask(runId);
        const deployment = task?.deploymentId
          ? await this.configurationStore.requireDeployment(task.deploymentId).catch(() => null)
          : null;
        const client = deployment ? this.clientFactory({
          serverUrl: deployment.connection.serverUrl,
          timeoutMs: deployment.timeoutMs,
        }) : null;
        const remote = client && deployment
          ? await this.cancelRemote({ client, promptId, deployment })
          : { remoteMayContinue: Boolean(promptId), remoteCancelConfirmed: false };
        remoteTerminalConfirmed = remote.remoteCancelConfirmed;
        this.coordinator.finalizeCancel(runId, { ...remote, promptId });
        return;
      }
      const failure = safeFailure(error);
      this.coordinator.fail(runId, {
        code: failure.code,
        error: failure.message,
        ...(failure.nodeErrors?.length ? { nodeErrors: failure.nodeErrors } : {}),
        retryable: failure.retryable,
        remoteMayContinue: Boolean(
          error?.remoteMayContinue ?? (promptId && !remoteTerminalConfirmed),
        ),
      });
      this.logger.error('Local ComfyUI workflow test failed', {
        runId,
        code: failure.code,
        errorType: error?.name || 'Error',
      });
    } finally {
      eventStream?.close();
      await Promise.allSettled(resolvedAssets.map((asset) => asset.disposeSnapshot?.()));
      if (!observationPaused && stageLedger && activeDeployment?.inputCleanupGrantId) {
        if (!promptId || remoteTerminalConfirmed) {
          await this.cleanupInputs({
            runId,
            deployment: activeDeployment,
            client: activeClient,
            stageLedger,
          });
        } else {
          await this.markInputsOrphaned({
            runId,
            deployment: activeDeployment,
            stageLedger,
          });
        }
      }
    }
  }
}
