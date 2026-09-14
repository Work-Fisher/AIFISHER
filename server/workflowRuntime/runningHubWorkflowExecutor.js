import path from 'node:path';
import { workflowAssetKey } from './workflowAssetIdentity.js';
import { MediaArtifactError, resolveMediaArtifact } from '../media/mediaArtifact.js';
import {
  compileWorkflowBindings,
  resolvePublicBindingValues,
} from './workflowBindingCompiler.js';
import { localizeWorkflowOutputs } from './workflowOutputLocalizer.js';
import {
  RunningHubWorkflowClient,
  RunningHubWorkflowClientError,
  normalizeRunningHubInstanceType,
  RUNNINGHUB_WORKFLOW_LIMITS,
} from './runningHubWorkflowClient.js';
import { RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID } from './runningHubWebApp.js';
import { prepareRunningHubWebAppCompatibility } from './runningHubWebAppCompatibility.js';
import { prepareRunningHubUploadAsset } from './runningHubUploadAdapter.js';
import { validateWorkflowRunReceipt } from './workflowRunResult.js';

const MAX_ASSETS = 20;
const MAX_TOTAL_UPLOAD_BYTES = MAX_ASSETS * RUNNINGHUB_WORKFLOW_LIMITS.maximumUploadBytes;
const MAX_OUTPUTS = 1_000;
const SAFE_CODE = /^(?:WORKFLOW|RUNNINGHUB|OUTPUT|ASSET|BINDING|INVALID|MISSING|CAPABILITY|INPUT)_/;

export class RunningHubWorkflowExecutorError extends Error {
  constructor(message, code = 'RUNNINGHUB_WORKFLOW_EXECUTION_ERROR', status = 500, retryable = false) {
    super(message);
    this.name = 'RunningHubWorkflowExecutorError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function publicFailure(error) {
  if (error?.code && SAFE_CODE.test(error.code)) {
    return {
      code: error.code,
      message: String(error.message || 'RunningHub 工作流执行失败').slice(0, 500),
      retryable: Boolean(error.retryable),
    };
  }
  return {
    code: 'RUNNINGHUB_WORKFLOW_EXECUTION_ERROR',
    message: 'RunningHub 工作流执行失败。',
    retryable: false,
  };
}

function assertReferences({ definition, executionPlanHash, deployment, bindingSet }) {
  if (
    !['runninghub-workflow', 'runninghub-webapp'].includes(deployment.runner)
    || deployment.definitionId !== definition.id
    || deployment.definitionRevision !== definition.revision
    || deployment.executionPlanHash !== executionPlanHash
    || bindingSet.definitionId !== definition.id
    || bindingSet.definitionRevision !== definition.revision
    || bindingSet.executionPlanHash !== executionPlanHash
  ) {
    throw new RunningHubWorkflowExecutorError(
      '工作流、RunningHub 部署与参数配置引用冲突',
      'WORKFLOW_REFERENCE_CONFLICT',
      409,
    );
  }
}

function fieldValue(value) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function nodeInfoList(bindingSet, resolvedValues) {
  return bindingSet.bindings
    .filter((binding) => Object.hasOwn(resolvedValues, binding.key))
    .map((binding) => ({
      nodeId: String(binding.target.nodeId),
      fieldName: String(binding.target.fieldName),
      fieldValue: fieldValue(resolvedValues[binding.key]),
      description: String(binding.description || binding.label || binding.target.fieldName)
        .slice(0, 500),
    }));
}

function runningHubMediaArtifact(fileType, filename) {
  try {
    return resolveMediaArtifact({ filename, declaredType: fileType });
  } catch (error) {
    if (!(error instanceof MediaArtifactError)) throw error;
    throw new RunningHubWorkflowExecutorError(
      'RunningHub 返回了不支持的输出类型',
      'OUTPUT_TYPE_UNSUPPORTED',
      409,
    );
  }
}

function filenameForOutput(item, index) {
  let filename;
  try {
    filename = path.posix.basename(new URL(String(item?.fileUrl || '')).pathname);
  } catch {
    throw new RunningHubWorkflowExecutorError(
      'RunningHub 输出地址无效',
      'RUNNINGHUB_OUTPUT_URL_INVALID',
      502,
    );
  }
  if (!path.extname(filename)) {
    const artifact = runningHubMediaArtifact(item?.fileType, filename);
    filename = `runninghub-output-${index + 1}${artifact.extension}`;
  }
  if (!filename || filename.length > 240 || /[\0\r\n\\]/.test(filename)) {
    throw new RunningHubWorkflowExecutorError(
      'RunningHub 输出文件名无效',
      'OUTPUT_REFERENCE_INVALID',
      502,
    );
  }
  return filename;
}

export function normalizeRunningHubOutputs(
  outputs,
  executionPlan,
  { defaultNodeId = '', forceDefaultNodeId = false } = {},
) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new RunningHubWorkflowExecutorError(
      'RunningHub 任务成功但没有可用输出',
      'OUTPUT_NOT_FOUND',
      409,
    );
  }
  if (outputs.length > MAX_OUTPUTS) {
    throw new RunningHubWorkflowExecutorError(
      'RunningHub 输出候选超过 1000 项',
      'OUTPUT_CANDIDATE_LIMIT',
      413,
    );
  }
  const counters = new Map();
  return outputs.map((item, index) => {
    const nodeId = String(
      forceDefaultNodeId ? defaultNodeId : (item?.nodeId || defaultNodeId || ''),
    ).trim();
    const node = executionPlan[nodeId];
    if (!node) {
      throw new RunningHubWorkflowExecutorError(
        'RunningHub 输出引用了执行计划外的节点',
        'OUTPUT_REFERENCE_INVALID',
        409,
      );
    }
    const filename = filenameForOutput(item, index);
    const kind = runningHubMediaArtifact(item?.fileType, filename).kind;
    const outputKey = kind === 'image' ? 'images' : kind === 'video' ? 'videos' : 'audio';
    const counterKey = `${nodeId}:${outputKey}`;
    const outputIndex = counters.get(counterKey) || 0;
    counters.set(counterKey, outputIndex + 1);
    return {
      nodeId,
      classType: node.class_type,
      outputKey,
      outputIndex,
      mediaKind: kind,
      kind: 'file',
      handle: { url: String(item.fileUrl), filename },
    };
  });
}

export class RunningHubWorkflowExecutor {
  constructor({
    definitionStore,
    configurationStore,
    deploymentService,
    assetResolver,
    runStore,
    coordinator,
    libraryDirectory,
    credentialResolver,
    clientFactory = (options) => new RunningHubWorkflowClient(options),
    uploadAssetAdapter = prepareRunningHubUploadAsset,
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
      libraryDirectory,
      credentialResolver,
      clientFactory,
      uploadAssetAdapter,
      wait,
      now,
      logger,
    });
  }

  async clientFor(deployment) {
    const apiKey = await this.credentialResolver(deployment.connection.credentialRef);
    return this.clientFactory({
      baseUrl: deployment.connection.baseUrl,
      apiKey,
      timeoutMs: deployment.timeoutMs,
    });
  }

  createAssetSession(runId, signal) {
    const cache = new Map();
    const snapshots = [];
    let totalBytes = 0;
    const resolve = async (reference) => {
      const key = workflowAssetKey(reference);
      if (cache.has(key)) return cache.get(key);
      if (cache.size >= MAX_ASSETS) {
        throw new RunningHubWorkflowExecutorError(
          'RunningHub 单次工作流最多上传 20 个素材',
          'WORKFLOW_STAGE_QUOTA_EXCEEDED',
          413,
        );
      }
      const pending = this.assetResolver.resolve(reference, {
        snapshotRunId: runId,
      }).then((asset) => this.uploadAssetAdapter(asset, {
        maximumBytes: RUNNINGHUB_WORKFLOW_LIMITS.maximumUploadBytes,
        signal,
      })).then((asset) => {
        totalBytes += Number(asset.bytes || 0);
        if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
          return Promise.resolve(asset.disposeSnapshot?.()).then(() => {
            throw new RunningHubWorkflowExecutorError(
              'RunningHub 单次工作流素材总量超过限制',
              'WORKFLOW_STAGE_QUOTA_EXCEEDED',
              413,
            );
          });
        }
        snapshots.push(asset);
        return asset;
      });
      cache.set(key, pending);
      return pending;
    };
    return {
      resolve,
      snapshots,
      async dispose() {
        const settled = await Promise.allSettled([...cache.values()]);
        const assets = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
        await Promise.allSettled(assets.map((asset) => asset.disposeSnapshot?.()));
      },
    };
  }

  async observe({ client, taskId, deployment, signal, runId }) {
    const deadline = this.now() + deployment.timeoutMs;
    let delay = 1_000;
    while (this.now() < deadline) {
      if (signal.aborted) return { state: 'cancel-requested' };
      try {
        const observed = deployment.runner === 'runninghub-webapp'
          ? await client.getWebAppTaskOutputs(taskId, {
              signal,
              apiProtocol: deployment.connection.apiProtocol || 'legacy-webapp-v1',
            })
          : await client.getTaskOutputs(taskId, { signal });
        if (observed.state !== 'pending') return observed;
        this.coordinator.update(runId, {
          phase: 'running',
          providerStatus: String(observed.status || 'RUNNING').slice(0, 80),
        });
      } catch (error) {
        if (signal.aborted) return { state: 'cancel-requested' };
        if (!(error instanceof RunningHubWorkflowClientError)) throw error;
        if (!error.retryable) throw error;
        this.coordinator.update(runId, {
          phase: 'observing',
          code: error.code,
          retryable: Boolean(error.retryable),
          remoteMayContinue: true,
        });
      }
      await this.wait(delay);
      delay = Math.min(5_000, Math.ceil(delay * 1.5));
    }
    return { state: 'unknown' };
  }

  pauseObservation({ runId, taskId, deployment }) {
    return this.coordinator.pauseObservation(runId, {
      code: 'WORKFLOW_OBSERVATION_PAUSED',
      error: '已到当前查询上限，远端任务未取消。可以继续查询原任务。',
      retryable: false,
      remoteMayContinue: true,
      promptId: taskId,
      observationWindowMs: deployment.timeoutMs,
    });
  }

  async publishSuccess({
    runId,
    definitionId,
    definitionRevision,
    executionPlanHash,
    apiJson,
    bindingSet,
    deployment,
    projectId,
    compiledPromptHash,
    resolvedSeeds = [],
    taskId,
    client,
    outputs,
    signal,
  }) {
    let localized = null;
    let pendingReceipt = null;
    let schedulerCommitted = false;
    try {
      this.coordinator.update(runId, { phase: 'localizing-outputs', remoteMayContinue: false });
      localized = await localizeWorkflowOutputs({
        candidates: normalizeRunningHubOutputs(outputs, apiJson, {
          defaultNodeId: deployment.runner === 'runninghub-webapp'
            ? RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID
            : '',
          forceDefaultNodeId: deployment.runner === 'runninghub-webapp',
        }),
        client,
        libraryDirectory: this.libraryDirectory,
        projectId,
        runId,
        stagingDirectory: path.join(this.runStore.rootDirectory, 'output-staging'),
        signal,
        source: deployment.runner,
        model: deployment.runner === 'runninghub-webapp'
          ? 'RunningHub WebApp'
          : 'RunningHub Workflow',
      });
      const receiptPayload = {
        id: runId,
        schemaVersion: 1,
        definitionId,
        definitionRevision,
        executionPlanHash,
        bindingSetId: bindingSet.id,
        bindingSetHash: bindingSet.bindingSetHash,
        deploymentId: deployment.id,
        deploymentSnapshotHash: deployment.deploymentSnapshotHash,
        relevantCapabilityHash: deployment.relevantCapabilityHash,
        projectId,
        compiledPromptHash,
        promptId: taskId,
        seeds: resolvedSeeds,
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
      if (localized && !schedulerCommitted) await localized.rollback().catch(() => undefined);
      if (pendingReceipt && !schedulerCommitted) {
        await this.runStore.discardPendingReceipt(pendingReceipt.pendingReceiptId).catch(() => undefined);
      }
      throw error;
    }
  }

  async execute({
    runId,
    definitionId,
    deploymentId,
    bindingSetId,
    projectId,
    values,
    instanceType,
    signal,
  }) {
    const assetSession = this.createAssetSession(runId, signal);
    const seedResolutionCache = new Map();
    let taskId = null;
    let remoteTerminalConfirmed = false;
    try {
      const [{ definition, apiJson, executionPlanHash }, deployment, bindingSet] = await Promise.all([
        this.definitionStore.readExecutionPlan(definitionId),
        this.configurationStore.requireDeployment(deploymentId),
        this.configurationStore.requireBindingSet(bindingSetId),
      ]);
      assertReferences({ definition, executionPlanHash, deployment, bindingSet });
      const selectedInstanceType = normalizeRunningHubInstanceType(
        instanceType || deployment.connection.instanceType,
      );
      const client = await this.clientFor(deployment);
      const webAppCompatibility = deployment.runner === 'runninghub-webapp'
        ? await prepareRunningHubWebAppCompatibility(deployment, client)
        : null;
      this.coordinator.update(runId, { phase: 'resolving-inputs' });
      const internalValues = resolvePublicBindingValues(bindingSet, values || {});
      const resolved = await compileWorkflowBindings({
        executionPlan: apiJson,
        bindingSet,
        deployment,
        projectId,
        values: internalValues,
        resolveAsset: assetSession.resolve,
        seedResolutionCache,
      });
      const uniqueAssets = [...new Map(resolved.assets.map((asset) => [workflowAssetKey(asset), asset])).values()];
      this.coordinator.update(runId, { phase: 'uploading-inputs' });
      const uploadedByAssetId = new Map();
      for (const asset of uniqueAssets) {
        if (signal.aborted) break;
        try {
          uploadedByAssetId.set(workflowAssetKey(asset), await client.uploadAsset(asset, {
            signal,
            apiProtocol: deployment.runner === 'runninghub-webapp'
              ? (deployment.connection.apiProtocol || 'legacy-webapp-v1')
              : 'legacy-webapp-v1',
          }));
        } finally {
          await asset.disposeSnapshot?.();
        }
      }
      if (signal.aborted) {
        this.coordinator.finalizeCancel(runId, {
          remoteMayContinue: false,
          remoteCancelConfirmed: false,
        });
        return;
      }
      const compiled = await compileWorkflowBindings({
        executionPlan: apiJson,
        bindingSet,
        deployment,
        projectId,
        values: internalValues,
        resolveAsset: async (reference) => {
          const asset = await assetSession.resolve(reference);
          const uploaded = uploadedByAssetId.get(workflowAssetKey(asset));
          return { ...asset, value: uploaded.fileName };
        },
        seedResolutionCache,
      });
      this.coordinator.update(runId, {
        phase: 'submitting',
        compiledPromptHash: compiled.compiledPromptHash,
        remoteMayContinue: true,
        resolvedSeeds: compiled.resolvedSeeds,
        pendingSeedAdvancements: compiled.seedAdvancements,
      });
      try {
        const compiledNodeInfoList = nodeInfoList(bindingSet, compiled.resolvedValues);
        const submitted = deployment.runner === 'runninghub-webapp'
          ? webAppCompatibility
            ? await client.createTask({
                ...webAppCompatibility,
                nodeInfoList: compiledNodeInfoList,
                instanceType: selectedInstanceType,
                signal,
              })
            : await client.createWebAppTask({
                webAppId: deployment.connection.remoteWebAppId,
                nodeInfoList: compiledNodeInfoList,
                instanceType: selectedInstanceType,
                apiProtocol: deployment.connection.apiProtocol || 'legacy-webapp-v1',
                signal,
              })
          : await client.createTask({
              workflowId: deployment.connection.remoteWorkflowId,
              nodeInfoList: compiledNodeInfoList,
              instanceType: selectedInstanceType,
              ...(deployment.connection.includeWorkflowJson
                ? { workflow: JSON.stringify(compiled.apiJson) }
                : {}),
              signal,
            });
        taskId = submitted.taskId;
        this.coordinator.update(runId, {
          seedAdvancements: compiled.seedAdvancements,
          seedAcceptedAt: new Date(this.now()).toISOString(),
        });
      } catch (error) {
        if (signal.aborted) {
          this.coordinator.finalizeCancel(runId, {
            remoteMayContinue: true,
            remoteCancelConfirmed: false,
          });
        } else if (error?.confirmedRejected) {
          throw error;
        } else {
          this.coordinator.finalizeUnknown(runId, {
            phase: 'submission-unknown',
            code: 'RUNNINGHUB_SUBMISSION_UNKNOWN',
            error: '无法确认 RunningHub 是否已接受任务，系统不会自动重提。',
            remoteMayContinue: true,
          });
        }
        return;
      }
      this.coordinator.update(runId, { phase: 'queued', promptId: taskId, remoteMayContinue: true });
      const terminal = await this.observe({ client, taskId, deployment, signal, runId });
      if (terminal.state === 'cancel-requested') {
        this.coordinator.finalizeCancel(runId, {
          promptId: taskId,
          remoteMayContinue: true,
          remoteCancelConfirmed: false,
        });
        return;
      }
      if (terminal.state === 'unknown') {
        this.pauseObservation({ runId, taskId, deployment });
        return;
      }
      remoteTerminalConfirmed = true;
      if (terminal.state === 'failed') {
        this.coordinator.fail(runId, {
          phase: 'provider-failed',
          code: 'RUNNINGHUB_EXECUTION_FAILED',
          error: String(terminal.reason || 'RunningHub 工作流执行失败').slice(0, 500),
          retryable: false,
          remoteMayContinue: false,
          promptId: taskId,
        });
        return;
      }
      await this.publishSuccess({
        runId,
        definitionId: definition.id,
        definitionRevision: definition.revision,
        executionPlanHash,
        apiJson,
        bindingSet,
        deployment,
        projectId,
        compiledPromptHash: compiled.compiledPromptHash,
        resolvedSeeds: compiled.resolvedSeeds,
        taskId,
        client,
        outputs: terminal.outputs,
        signal,
      });
    } catch (error) {
      if (signal.aborted && this.coordinator.isActive(runId)) {
        this.coordinator.finalizeCancel(runId, {
          promptId: taskId,
          remoteMayContinue: Boolean(taskId) && !remoteTerminalConfirmed,
          remoteCancelConfirmed: false,
        });
        return;
      }
      const failure = publicFailure(error);
      this.coordinator.fail(runId, {
        phase: 'failed',
        code: failure.code,
        error: failure.message,
        retryable: failure.retryable,
        remoteMayContinue: Boolean(taskId) && !remoteTerminalConfirmed,
        ...(taskId ? { promptId: taskId } : {}),
      });
      this.logger.error('RunningHub workflow execution failed', {
        runId,
        code: failure.code,
        errorType: error?.name || 'Error',
      });
    } finally {
      await assetSession.dispose();
    }
  }

  async resume({ task, signal }) {
    const runId = task.nodeId;
    const taskId = String(task.promptId || '').trim();
    if (!taskId) {
      this.coordinator.finalizeUnknown(runId, {
        phase: 'submission-unknown',
        code: 'RUNNINGHUB_SUBMISSION_UNKNOWN',
        remoteMayContinue: true,
      });
      return;
    }
    let remoteTerminalConfirmed = false;
    try {
      const [{ definition, apiJson, executionPlanHash }, deployment, bindingSet] = await Promise.all([
        this.definitionStore.readExecutionPlan(task.definitionId, {
          executionPlanHash: task.executionPlanHash,
        }),
        this.configurationStore.requireDeployment(task.deploymentId),
        this.configurationStore.requireBindingSet(task.bindingSetId),
      ]);
      assertReferences({ definition, executionPlanHash, deployment, bindingSet });
      const client = await this.clientFor(deployment);
      const terminal = await this.observe({ client, taskId, deployment, signal, runId });
      if (terminal.state === 'cancel-requested') {
        this.coordinator.finalizeCancel(runId, {
          promptId: taskId,
          remoteMayContinue: true,
          remoteCancelConfirmed: false,
        });
        return;
      }
      if (terminal.state === 'unknown') {
        this.pauseObservation({ runId, taskId, deployment });
        return;
      }
      remoteTerminalConfirmed = true;
      if (terminal.state === 'failed') {
        this.coordinator.fail(runId, {
          phase: 'provider-failed',
          code: 'RUNNINGHUB_EXECUTION_FAILED',
          error: String(terminal.reason || 'RunningHub 工作流执行失败').slice(0, 500),
          remoteMayContinue: false,
          promptId: taskId,
        });
        return;
      }
      await this.publishSuccess({
        runId,
        definitionId: task.definitionId,
        definitionRevision: Number(task.definitionRevision),
        executionPlanHash,
        apiJson,
        bindingSet,
        deployment,
        projectId: task.projectId,
        compiledPromptHash: task.compiledPromptHash,
        resolvedSeeds: Array.isArray(task.resolvedSeeds) ? task.resolvedSeeds : [],
        taskId,
        client,
        outputs: terminal.outputs,
        signal,
      });
    } catch (error) {
      if (signal.aborted && this.coordinator.isActive(runId)) {
        this.coordinator.finalizeCancel(runId, {
          promptId: taskId,
          remoteMayContinue: !remoteTerminalConfirmed,
          remoteCancelConfirmed: false,
        });
        return;
      }
      const failure = publicFailure(error);
      this.coordinator.fail(runId, {
        phase: 'recovery-failed',
        code: failure.code,
        error: failure.message,
        retryable: failure.retryable,
        promptId: taskId,
        remoteMayContinue: !remoteTerminalConfirmed,
      });
    }
  }
}

export function isRunningHubWorkflowExecutorError(error) {
  return error instanceof RunningHubWorkflowExecutorError;
}
