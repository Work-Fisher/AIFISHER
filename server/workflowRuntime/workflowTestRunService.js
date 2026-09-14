import crypto from 'node:crypto';
import { sha256Json } from './workflowFormat.js';
import { normalizeRunningHubInstanceType } from './runningHubWorkflowClient.js';
import {
  projectWorkflowRunReceipt,
  WorkflowRunResultError,
} from './workflowRunResult.js';

const WORKFLOW_RUN_KINDS = new Set(['workflow-test', 'workflow-node']);

export class WorkflowTestRunError extends Error {
  constructor(message, code = 'WORKFLOW_TEST_RUN_ERROR', status = 400) {
    super(message);
    this.name = 'WorkflowTestRunError';
    this.code = code;
    this.status = status;
  }
}

function taskDto(task, receipt = null, inputCleanup = null) {
  if (!task) return null;
  const currentNodeId = typeof task.currentNodeId === 'string'
    ? task.currentNodeId.slice(0, 120)
    : undefined;
  const progressValue = Number(task.progress?.value);
  const progressMaximum = Number(task.progress?.maximum);
  const progress = Number.isFinite(progressValue)
    && Number.isFinite(progressMaximum)
    && progressMaximum > 0
    ? {
        value: Math.max(0, progressValue),
        maximum: progressMaximum,
        currentNodeId: typeof task.progress?.currentNodeId === 'string'
          ? task.progress.currentNodeId.slice(0, 120)
          : currentNodeId,
      }
    : undefined;
  const realtimeChannel = ['websocket', 'history-fallback'].includes(task.realtimeChannel)
    ? task.realtimeChannel
    : undefined;
  const cachedNodeIds = Array.isArray(task.cachedNodeIds)
    ? task.cachedNodeIds.slice(0, 1_000).map((nodeId) => String(nodeId).slice(0, 120))
    : undefined;
  const nodeErrors = Array.isArray(task.nodeErrors)
    ? task.nodeErrors.slice(0, 20).flatMap((entry) => (
      entry && typeof entry === 'object'
        ? [{
            nodeId: String(entry.nodeId || 'unknown-node').slice(0, 120),
            errorType: String(entry.errorType || 'validation').slice(0, 120),
            message: String(entry.message || '节点参数校验失败').slice(0, 500),
          }]
        : []
    ))
    : [];
  const resolvedSeeds = Array.isArray(task.resolvedSeeds)
    ? task.resolvedSeeds.slice(0, 100).flatMap((entry) => {
        const resolvedSeed = Number(entry?.resolvedSeed);
        const seedPolicy = String(entry?.seedPolicy || '');
        if (
          !entry
          || typeof entry !== 'object'
          || !Number.isSafeInteger(resolvedSeed)
          || !['fixed', 'random', 'increment', 'decrement'].includes(seedPolicy)
        ) return [];
        return [{
          bindingKey: String(entry.bindingKey || '').slice(0, 64),
          seedPolicy,
          resolvedSeed,
        }];
      })
    : [];
  const seedAdvancements = Array.isArray(task.seedAdvancements)
    ? task.seedAdvancements.slice(0, 100).flatMap((entry) => {
        const mode = String(entry?.mode || '');
        const previousValue = Number(entry?.previousValue);
        const nextValue = Number(entry?.nextValue);
        const step = Number(entry?.step);
        if (
          !entry
          || typeof entry !== 'object'
          || !['increment', 'decrement'].includes(mode)
          || !Number.isSafeInteger(previousValue)
          || !Number.isSafeInteger(nextValue)
          || !Number.isSafeInteger(step)
          || step <= 0
        ) return [];
        return [{
          bindingKey: String(entry.bindingKey || '').slice(0, 64),
          mode,
          previousValue,
          nextValue,
          step,
        }];
      })
    : [];
  const observationWindowMs = Number(task.observationWindowMs);
  const observationElapsedMs = Number(task.observationElapsedMs);
  const availableOutputs = Array.isArray(task.availableOutputs)
    ? task.availableOutputs.slice(0, 1_000).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const outputIndex = Number(entry.outputIndex);
        if (!Number.isInteger(outputIndex) || outputIndex < 0) return [];
        return [{
          nodeId: String(entry.nodeId || '').slice(0, 160),
          classType: String(entry.classType || '').slice(0, 160),
          outputKey: String(entry.outputKey || '').slice(0, 160),
          outputIndex,
          mediaKind: String(entry.mediaKind || 'json').slice(0, 40),
          kind: entry.kind === 'file' ? 'file' : 'inline',
        }];
      })
    : [];
  return {
    runId: task.nodeId,
    kind: task.kind,
    runner: task.runner || 'local-comfyui',
    status: task.status,
    phase: task.phase,
    definitionId: task.definitionId,
    deploymentId: task.deploymentId,
    bindingSetId: task.bindingSetId,
    outputBindingSetId: task.outputBindingSetId,
    projectId: task.projectId,
    promptId: task.promptId,
    code: task.code,
    error: task.error,
    retryable: Boolean(task.retryable),
    remoteMayContinue: Boolean(task.remoteMayContinue),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    durationMs: task.durationMs,
    ...(currentNodeId ? { currentNodeId } : {}),
    ...(progress ? { progress } : {}),
    ...(realtimeChannel ? { realtimeChannel } : {}),
    ...(cachedNodeIds ? { cachedNodeIds } : {}),
    ...(nodeErrors.length ? { nodeErrors } : {}),
    ...(resolvedSeeds.length ? { resolvedSeeds } : {}),
    ...(seedAdvancements.length ? { seedAdvancements } : {}),
    ...(Number.isFinite(observationWindowMs) && observationWindowMs > 0
      ? { observationWindowMs }
      : {}),
    ...(Number.isFinite(observationElapsedMs) && observationElapsedMs >= 0
      ? { observationElapsedMs }
      : {}),
    ...(typeof task.observationPausedAt === 'string'
      ? { observationPausedAt: task.observationPausedAt }
      : {}),
    ...(availableOutputs.length ? { availableOutputs } : {}),
    ...(inputCleanup ? { inputCleanup } : {}),
    ...(receipt ? {
      receipt: {
        receiptHash: receipt.receiptHash,
        succeededAt: receipt.succeededAt,
        seeds: resolvedSeeds,
        outputs: receipt.outputs,
      },
    } : {}),
  };
}

export class WorkflowTestRunService {
  constructor({
    definitionStore,
    configurationStore,
    runStore,
    coordinator,
    executor,
    executors = null,
    logger = console,
    heartbeatIntervalMs = 10_000,
  }) {
    Object.assign(this, {
      definitionStore,
      configurationStore,
      runStore,
      coordinator,
      executor,
      logger,
      heartbeatIntervalMs,
    });
    this.executors = new Map(executors || []);
    if (executor && !this.executors.has('local-comfyui')) {
      this.executors.set('local-comfyui', executor);
    }
  }

  executorForRunner(runner = 'local-comfyui') {
    const selected = this.executors.get(runner);
    if (!selected) {
      throw new WorkflowTestRunError(
        '当前服务未启用该工作流运行器',
        'WORKFLOW_RUNNER_UNAVAILABLE',
        409,
      );
    }
    return selected;
  }

  async start({ idempotencyKey, definitionId, request, kind = 'workflow-test' }) {
    if (!WORKFLOW_RUN_KINDS.has(kind)) {
      throw new WorkflowTestRunError('工作流运行类型无效', 'INVALID_WORKFLOW_RUN_KIND');
    }
    if (request?.confirmExecution !== true) {
      throw new WorkflowTestRunError(
        '真实测试必须明确 confirmExecution=true',
        'WORKFLOW_EXECUTION_CONFIRMATION_REQUIRED',
        409,
      );
    }
    const [{ definition, executionPlanHash }, deployment, bindingSet] = await Promise.all([
      this.definitionStore.readExecutionPlan(definitionId),
      this.configurationStore.requireDeployment(request.deploymentId),
      this.configurationStore.requireBindingSet(request.bindingSetId),
    ]);
    const outputBindingSet = kind === 'workflow-node' && request.outputBindingSetId
      ? await this.configurationStore.requireOutputBindingSet(request.outputBindingSetId)
      : null;
    if (['runninghub-workflow', 'runninghub-webapp'].includes(deployment.runner)
      && request.confirmPaidExecution !== true) {
      throw new WorkflowTestRunError(
        'RunningHub 是付费远程执行，必须明确 confirmPaidExecution=true',
        'WORKFLOW_PAID_EXECUTION_CONFIRMATION_REQUIRED',
        409,
      );
    }
    const selectedExecutor = this.executorForRunner(deployment.runner);
    const runningHubInstanceType = ['runninghub-workflow', 'runninghub-webapp'].includes(deployment.runner)
      ? normalizeRunningHubInstanceType(request.instanceType || deployment.connection.instanceType)
      : undefined;
    if (
      deployment.definitionId !== definition.id
      || deployment.definitionRevision !== definition.revision
      || bindingSet.definitionId !== definition.id
      || bindingSet.definitionRevision !== definition.revision
      || deployment.executionPlanHash !== executionPlanHash
      || bindingSet.executionPlanHash !== executionPlanHash
      || (outputBindingSet && (
        outputBindingSet.definitionId !== definition.id
        || outputBindingSet.definitionRevision !== definition.revision
        || outputBindingSet.executionPlanHash !== executionPlanHash
      ))
    ) {
      throw new WorkflowTestRunError(
        '工作流、部署与参数配置引用冲突',
        'WORKFLOW_REFERENCE_CONFLICT',
        409,
      );
    }
    const fingerprint = sha256Json({
      kind,
      definitionId: definition.id,
      definitionRevision: definition.revision,
      executionPlanHash,
      deploymentId: deployment.id,
      bindingSetId: bindingSet.id,
      outputBindingSetId: outputBindingSet?.id,
      outputBindingSetHash: outputBindingSet?.outputBindingSetHash,
      projectId: request.projectId,
      values: request.values || {},
      ...(runningHubInstanceType ? { instanceType: runningHubInstanceType } : {}),
    });
    const runId = crypto.randomUUID();
    const ownerToken = crypto.randomUUID();
    const reservation = await this.runStore.reserveIdempotency({
      key: idempotencyKey,
      fingerprint,
      runId,
      ownerToken,
    });
    if (!reservation.owner) {
      if (reservation.record.state === 'rejected') {
        throw new WorkflowTestRunError(
          '该测试请求此前未通过任务准入',
          reservation.record.code || 'WORKFLOW_ADMISSION_REJECTED',
          429,
        );
      }
      if (reservation.record.state === 'interrupted-before-admission') {
        throw new WorkflowTestRunError(
          '该测试请求在任务准入前被中断，请用新的 Idempotency-Key 重试',
          'WORKFLOW_ADMISSION_INTERRUPTED',
          409,
        );
      }
      const existingTask = this.coordinator.getTask(reservation.record.runId);
      if (existingTask) return this.getRun(reservation.record.runId);
      return taskDto({
        nodeId: reservation.record.runId,
        kind,
        status: 'loading',
        phase: 'admitting',
      });
    }

    const lease = this.coordinator.begin({
      nodeId: reservation.record.runId,
      kind,
      modelName: deployment.runner === 'runninghub-webapp'
        ? 'RunningHub WebApp'
        : deployment.runner === 'runninghub-workflow'
          ? 'RunningHub Workflow'
          : 'Local ComfyUI',
      modelIdKey: ['runninghub-workflow', 'runninghub-webapp'].includes(deployment.runner)
        ? `runninghub:${deployment.connection.baseUrl}:${
            deployment.connection.remoteWebAppId || deployment.connection.remoteWorkflowId
          }`
        : `comfy:${deployment.connection.serverUrl}`,
      maxConcurrent: 1,
      timeEstimate: '1min',
      leaseHeartbeatMs: 30_000,
      absoluteTimeoutMs: deployment.timeoutMs + 30 * 60_000,
      metadata: {
        phase: 'admitted',
        runner: deployment.runner,
        definitionId: definition.id,
        definitionRevision: definition.revision,
        executionPlanHash,
        deploymentId: deployment.id,
        bindingSetId: bindingSet.id,
        ...(outputBindingSet ? {
          outputBindingSetId: outputBindingSet.id,
          outputBindingSetHash: outputBindingSet.outputBindingSetHash,
        } : {}),
        projectId: request.projectId,
        ...(runningHubInstanceType ? { instanceType: runningHubInstanceType } : {}),
        requestFingerprint: fingerprint,
      },
    });
    if (!lease.ok) {
      await this.runStore.updateAdmission({
        key: idempotencyKey,
        ownerToken,
        state: 'rejected',
        code: lease.code,
      });
      throw new WorkflowTestRunError('工作流运行并发已满', lease.code, 429);
    }
    await this.runStore.updateAdmission({
      key: idempotencyKey,
      ownerToken,
      state: 'admitted',
    });
    const heartbeatTimer = setInterval(() => {
      this.coordinator.heartbeat(lease.nodeId);
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    void selectedExecutor.execute({
      runId: lease.nodeId,
      definitionId: definition.id,
      deploymentId: deployment.id,
      bindingSetId: bindingSet.id,
      projectId: request.projectId,
      values: request.values || {},
      ...(runningHubInstanceType ? { instanceType: runningHubInstanceType } : {}),
      signal: lease.signal,
    }).catch((error) => {
      this.logger.error('Unhandled workflow executor failure', {
        runId: lease.nodeId,
        errorType: error?.name || 'Error',
      });
    }).finally(() => clearInterval(heartbeatTimer));
    return taskDto(this.coordinator.getTask(lease.nodeId));
  }

  async getRun(runId) {
    const task = this.coordinator.getTask(runId);
    if (!task || !WORKFLOW_RUN_KINDS.has(task.kind)) {
      throw new WorkflowTestRunError('工作流任务不存在', 'WORKFLOW_RUN_NOT_FOUND', 404);
    }
    let receipt = null;
    const ledger = await this.runStore.requireInputStageLedger(runId).catch((error) => {
      if (error?.code === 'INPUT_STAGE_LEDGER_NOT_FOUND') return null;
      throw error;
    });
    const inputCleanup = ledger ? {
      state: ledger.cleanupState,
      totalBytes: Number(ledger.totalBytes || 0),
      retryable: ledger.cleanupState === 'orphaned',
      updatedAt: ledger.updatedAt,
    } : null;
    if (task.status === 'success') {
      try {
        receipt = await this.runStore.requireReceipt(runId);
      } catch (error) {
        if (error?.code !== 'TEST_RUN_RECEIPT_NOT_FOUND') throw error;
        try {
          receipt = await this.runStore.recoverPendingReceipt(runId, task);
        } catch (recoveryError) {
          this.logger.error('Workflow receipt publication is awaiting retry', {
            runId,
            code: recoveryError?.code || 'RECEIPT_PUBLICATION_RETRY_PENDING',
            errorType: recoveryError?.name || 'Error',
          });
          return taskDto({
            ...task,
            status: 'loading',
            phase: 'publishing-receipt',
            finishedAt: undefined,
            durationMs: undefined,
          }, null, inputCleanup);
        }
      }
      try {
        receipt = await projectWorkflowRunReceipt({
          task,
          receipt,
          configurationStore: this.configurationStore,
        });
      } catch (error) {
        if (!(error instanceof WorkflowRunResultError)) throw error;
        return taskDto({
          ...task,
          status: 'failed',
          phase: 'output-contract-failed',
          code: error.code,
          error: error.message,
          retryable: false,
        }, null, inputCleanup);
      }
    }
    return taskDto(task, receipt, inputCleanup);
  }

  async continueObservation(runId) {
    const current = this.coordinator.getTask(runId);
    if (
      !current
      || !WORKFLOW_RUN_KINDS.has(current.kind)
      || current.status !== 'loading'
      || current.phase !== 'observation-paused'
      || !current.promptId
    ) {
      throw new WorkflowTestRunError(
        '工作流当前没有可继续的观察任务',
        'WORKFLOW_OBSERVATION_NOT_PAUSED',
        409,
      );
    }
    const deployment = await this.configurationStore.requireDeployment(current.deploymentId);
    const reacquired = this.coordinator.reacquireObservation(runId, {
      leaseHeartbeatMs: 30_000,
      absoluteTimeoutMs: deployment.timeoutMs + 30 * 60_000,
    });
    if (!reacquired.ok) {
      throw new WorkflowTestRunError(
        reacquired.code === 'MODEL_CONCURRENCY_LIMIT'
          ? '当前 ComfyUI 连接已有其他工作流在观察，请稍后继续'
          : '工作流当前没有可继续的观察任务',
        reacquired.code,
        409,
      );
    }
    const heartbeatTimer = setInterval(() => {
      this.coordinator.heartbeat(runId);
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    const selectedExecutor = this.executorForRunner(current.runner);
    void selectedExecutor.resume({
      task: this.coordinator.getTask(runId),
      signal: reacquired.signal,
    }).catch((error) => {
      this.coordinator.fail(runId, {
        phase: 'recovery-failed',
        code: 'WORKFLOW_RECOVERY_FAILED',
        error: '继续观察工作流失败。',
        retryable: true,
        remoteMayContinue: true,
      });
      this.logger.error('Unhandled workflow observation continuation failure', {
        runId,
        errorType: error?.name || 'Error',
      });
    }).finally(() => clearInterval(heartbeatTimer));
    return taskDto(this.coordinator.getTask(runId));
  }

  async retryInputCleanup(runId, input = {}) {
    const task = this.coordinator.getTask(runId);
    if (!task || !WORKFLOW_RUN_KINDS.has(task.kind)) {
      throw new WorkflowTestRunError('工作流任务不存在', 'WORKFLOW_RUN_NOT_FOUND', 404);
    }
    if (!['success', 'failed', 'cancelled', 'unknown'].includes(task.status)) {
      throw new WorkflowTestRunError(
        '工作流仍在运行，不能并发清理其暂存输入',
        'INPUT_CLEANUP_RUN_ACTIVE',
        409,
      );
    }
    if (task.remoteMayContinue && input.confirmRemoteStopped !== true) {
      throw new WorkflowTestRunError(
        'ComfyUI 任务可能仍在运行；请先在 ComfyUI 中确认已经停止，再允许清理暂存输入',
        'INPUT_CLEANUP_REMOTE_CONFIRMATION_REQUIRED',
        409,
      );
    }
    return this.executorForRunner(task.runner).retryInputCleanup(runId);
  }

  async reconcileTerminalInputCleanup(taskJournal) {
    const terminalStatuses = new Set(['success', 'failed', 'cancelled', 'unknown']);
    const ledgers = await this.runStore.listInputStageLedgers();
    const reconciled = [];
    for (const ledger of ledgers) {
      if (ledger?.cleanupState !== 'pending') continue;
      const task = taskJournal.get(ledger.runId);
      if (
        !WORKFLOW_RUN_KINDS.has(task?.kind)
        || !terminalStatuses.has(task.status)
      ) continue;
      const deployment = await this.configurationStore
        .requireDeployment(ledger.deploymentId)
        .catch(() => null);
      const executor = this.executorForRunner(deployment?.runner || task.runner);
      if (
        task.status === 'unknown'
        || task.remoteMayContinue
        || !deployment?.inputCleanupGrantId
        || deployment.inputCleanupGrantId !== ledger.cleanupGrantId
      ) {
        await executor.markInputsOrphaned({
          runId: ledger.runId,
          deployment,
          stageLedger: ledger,
          code: task.remoteMayContinue || task.status === 'unknown'
            ? 'INPUT_CLEANUP_REMOTE_MAY_CONTINUE'
            : 'INPUT_CLEANUP_GRANT_UNAVAILABLE',
        });
      } else {
        await executor.cleanupInputs({
          runId: ledger.runId,
          deployment,
          stageLedger: ledger,
        });
      }
      reconciled.push(ledger.runId);
    }
    return reconciled;
  }

  recoverInterruptedTasks(taskJournal) {
    const recoverable = taskJournal.list().filter((task) =>
      WORKFLOW_RUN_KINDS.has(task?.kind)
      && task.status === 'loading'
      && task.phase === 'recovering');
    const resumed = [];
    for (const task of recoverable) {
      const adopted = this.coordinator.adopt(task, {
        absoluteDeadlineMs: 30 * 60_000,
      });
      if (!adopted.ok) continue;
      resumed.push(task.nodeId);
      const heartbeatTimer = setInterval(() => {
        this.coordinator.heartbeat(task.nodeId);
      }, this.heartbeatIntervalMs);
      heartbeatTimer.unref?.();
      let executor;
      try {
        executor = this.executorForRunner(task.runner);
      } catch (error) {
        this.coordinator.fail(task.nodeId, {
          phase: 'recovery-failed',
          code: error.code,
          error: error.message,
          retryable: true,
      remoteMayContinue: ['runninghub-workflow', 'runninghub-webapp'].includes(task.runner)
        && Boolean(task.promptId),
        });
        clearInterval(heartbeatTimer);
        continue;
      }
      void executor.resume({
        task: this.coordinator.getTask(task.nodeId),
        signal: adopted.signal,
      }).catch((error) => {
        this.coordinator.fail(task.nodeId, {
          phase: 'recovery-failed',
          code: 'WORKFLOW_RECOVERY_FAILED',
          error: '工作流恢复失败。',
          retryable: true,
        });
        this.logger.error('Unhandled workflow recovery failure', {
          runId: task.nodeId,
          errorType: error?.name || 'Error',
        });
      }).finally(() => clearInterval(heartbeatTimer));
    }
    return resumed;
  }

  cancel(runId) {
    const current = this.coordinator.getTask(runId);
    if (!current || !WORKFLOW_RUN_KINDS.has(current.kind) || current.status !== 'loading') {
      throw new WorkflowTestRunError('工作流任务当前不可取消', 'WORKFLOW_RUN_NOT_ACTIVE', 409);
    }
    let resumedObserver = null;
    if (current.phase === 'observation-paused') {
      resumedObserver = this.coordinator.reacquireObservation(runId, {
        leaseHeartbeatMs: 30_000,
        absoluteTimeoutMs: Number(current.observationWindowMs || 30 * 60_000) + 30 * 60_000,
      });
      if (!resumedObserver.ok) {
        throw new WorkflowTestRunError(
          '工作流任务当前无法重新连接并取消',
          resumedObserver.code,
          409,
        );
      }
    }
    const result = this.coordinator.requestCancel(runId, { phase: 'cancelling' });
    if (!result.ok) {
      throw new WorkflowTestRunError('工作流任务当前不可取消', 'WORKFLOW_RUN_NOT_ACTIVE', 409);
    }
    if (resumedObserver) {
      const selectedExecutor = this.executorForRunner(current.runner);
      const heartbeatTimer = setInterval(() => {
        this.coordinator.heartbeat(runId);
      }, this.heartbeatIntervalMs);
      heartbeatTimer.unref?.();
      void selectedExecutor.resume({
        task: this.coordinator.getTask(runId),
        signal: resumedObserver.signal,
      }).catch((error) => {
        this.coordinator.fail(runId, {
          phase: 'cancel-confirmation-failed',
          code: 'WORKFLOW_CANCEL_CONFIRMATION_FAILED',
          error: '取消请求已发出，但无法确认 ComfyUI 端状态。',
          retryable: false,
          remoteMayContinue: true,
        });
        this.logger.error('Unhandled paused workflow cancellation failure', {
          runId,
          errorType: error?.name || 'Error',
        });
      }).finally(() => clearInterval(heartbeatTimer));
    }
    return taskDto(result.task);
  }
}
