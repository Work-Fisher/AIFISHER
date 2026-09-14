import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeLocalComfyServer } from '../comfyui/comfyServerAddress.js';
import { sha256Json } from './workflowFormat.js';
import {
  assertRunningHubRemoteId,
  normalizeRunningHubBaseUrl,
  normalizeRunningHubInstanceType,
} from './runningHubWorkflowClient.js';
import {
  assertWorkflowStorageIsPrivate,
  resolveWorkflowStorageDirectory,
} from './workflowStoragePaths.js';

const SAFE_ID = /^[a-f\d-]{36}$/i;
const SHA256 = /^[a-f\d]{64}$/i;

export class WorkflowConfigurationError extends Error {
  constructor(message, code = 'WORKFLOW_CONFIGURATION_ERROR', status = 400) {
    super(message);
    this.name = 'WorkflowConfigurationError';
    this.code = code;
    this.status = status;
  }
}

function assertId(value, label) {
  const normalized = String(value || '');
  if (!SAFE_ID.test(normalized)) {
    throw new WorkflowConfigurationError(`${label}无效`, 'INVALID_WORKFLOW_REFERENCE');
  }
  return normalized;
}

function assertHash(value, label) {
  const normalized = String(value || '');
  if (!SHA256.test(normalized)) {
    throw new WorkflowConfigurationError(`${label}无效`, 'INVALID_WORKFLOW_HASH');
  }
  return normalized.toLowerCase();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function writeImmutable(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new WorkflowConfigurationError('不可变配置标识冲突', 'WORKFLOW_OBJECT_EXISTS', 409);
    }
    throw error;
  }
}

function deploymentSemantic(record) {
  return {
    schemaVersion: record.schemaVersion,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    runner: record.runner,
    connection: record.connection,
    timeoutMs: record.timeoutMs,
    relevantCapabilityHash: record.relevantCapabilityHash,
    runtimeProtocolHash: record.runtimeProtocolHash,
    inputCleanupGrantId: record.inputCleanupGrantId,
  };
}

function bindingSetSemantic(record) {
  return {
    schemaVersion: record.schemaVersion,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    bindings: record.bindings,
  };
}

function outputBindingSetSemantic(record) {
  return {
    schemaVersion: record.schemaVersion,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    sourceRunId: record.sourceRunId,
    sourceReceiptHash: record.sourceReceiptHash,
    outputs: record.outputs,
  };
}

function attestationSemantic(record) {
  const { id, createdAt, attestationHash, ...semantic } = record;
  return semantic;
}

function normalizeRuntimeProtocol(value = {}, runner = 'local-comfyui') {
  if (runner === 'runninghub-workflow' || runner === 'runninghub-webapp') {
    return {
      apiRevision: String(value.apiRevision || '2026-04-08').trim().slice(0, 40),
      supportsCancellation: false,
      remoteTemplateHash: assertHash(value.remoteTemplateHash, '远端模板哈希'),
    };
  }
  return {
    comfyuiVersion: String(value.comfyuiVersion || 'unknown').trim().slice(0, 120) || 'unknown',
    supportsAtomicJobCancel: Boolean(value.supportsAtomicJobCancel),
  };
}

function normalizeRunningHubWebAppProtocol(value) {
  const normalized = String(value || 'legacy-webapp-v1').trim();
  if (!['legacy-webapp-v1', 'ai-app-v2'].includes(normalized)) {
    throw new WorkflowConfigurationError(
      'RunningHub AI 应用协议无效',
      'INVALID_RUNNINGHUB_WEBAPP_PROTOCOL',
    );
  }
  return normalized;
}

function normalizeCredentialReference(value) {
  if (!['runninghub-cn', 'runninghub-global'].includes(value)) {
    throw new WorkflowConfigurationError(
      'RunningHub 凭证引用无效',
      'INVALID_CREDENTIAL_REFERENCE',
    );
  }
  return value;
}

function validateDeploymentIntegrity(record) {
  if (sha256Json(record.relevantCapabilities) !== record.relevantCapabilityHash) {
    throw new WorkflowConfigurationError(
      '部署能力快照完整性校验失败',
      'DEPLOYMENT_INTEGRITY_ERROR',
      409,
    );
  }
  if (sha256Json(record.runtimeProtocol) !== record.runtimeProtocolHash) {
    throw new WorkflowConfigurationError(
      '部署协议快照完整性校验失败',
      'DEPLOYMENT_INTEGRITY_ERROR',
      409,
    );
  }
  if (sha256Json(deploymentSemantic(record)) !== record.deploymentSnapshotHash) {
    throw new WorkflowConfigurationError(
      '部署快照完整性校验失败',
      'DEPLOYMENT_INTEGRITY_ERROR',
      409,
    );
  }
}

function validateBindingSetIntegrity(record) {
  if (sha256Json(bindingSetSemantic(record)) !== record.bindingSetHash) {
    throw new WorkflowConfigurationError(
      '参数绑定集完整性校验失败',
      'BINDING_SET_INTEGRITY_ERROR',
      409,
    );
  }
}

function validateOutputBindingSetIntegrity(record) {
  if (sha256Json(outputBindingSetSemantic(record)) !== record.outputBindingSetHash) {
    throw new WorkflowConfigurationError(
      '输出绑定集完整性校验失败',
      'OUTPUT_BINDING_SET_INTEGRITY_ERROR',
      409,
    );
  }
}

function validateAttestationIntegrity(record) {
  if (sha256Json(attestationSemantic(record)) !== record.attestationHash) {
    throw new WorkflowConfigurationError(
      '测试证明完整性校验失败',
      'ATTESTATION_INTEGRITY_ERROR',
      409,
    );
  }
}

export class WorkflowConfigurationStore {
  constructor({ libraryDirectory, storageDirectory }) {
    this.libraryDirectory = path.resolve(libraryDirectory);
    this.rootDirectory = resolveWorkflowStorageDirectory({ libraryDirectory, storageDirectory });
    this.deploymentsDirectory = path.join(this.rootDirectory, 'deployments');
    this.bindingSetsDirectory = path.join(this.rootDirectory, 'binding-sets');
    this.outputBindingSetsDirectory = path.join(this.rootDirectory, 'output-binding-sets');
    this.attestationsDirectory = path.join(this.rootDirectory, 'attestations');
    this.bindingLocks = new Map();
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true });
    await assertWorkflowStorageIsPrivate({
      libraryDirectory: this.libraryDirectory,
      storageDirectory: this.rootDirectory,
    });
    await Promise.all([
      mkdir(this.deploymentsDirectory, { recursive: true }),
      mkdir(this.bindingSetsDirectory, { recursive: true }),
      mkdir(this.outputBindingSetsDirectory, { recursive: true }),
      mkdir(this.attestationsDirectory, { recursive: true }),
    ]);
  }

  objectPath(directory, id) {
    return path.join(directory, `${assertId(id, '配置标识')}.json`);
  }

  async readObject(directory, id, kind) {
    await this.init();
    try {
      return JSON.parse(await readFile(this.objectPath(directory, id), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new WorkflowConfigurationError(`${kind}不存在`, 'WORKFLOW_OBJECT_NOT_FOUND', 404);
      }
      if (error instanceof WorkflowConfigurationError) throw error;
      throw new WorkflowConfigurationError(`${kind}文件损坏`, 'WORKFLOW_OBJECT_CORRUPT', 409);
    }
  }

  async listObjects(directory, definitionId) {
    await this.init();
    const expectedDefinitionId = assertId(definitionId, '工作流定义标识');
    const entries = await readdir(directory, { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && SAFE_ID.test(path.basename(entry.name, '.json')))
      .map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.name), 'utf8'))));
    return records.filter((record) => record.definitionId === expectedDefinitionId);
  }

  async createDeployment({
    definitionId,
    definitionRevision,
    executionPlanHash,
    runner = 'local-comfyui',
    serverUrl,
    baseUrl,
    credentialRef,
    remoteWorkflowId,
    remoteWebAppId,
    apiProtocol,
    includeWorkflowJson = false,
    instanceType = '',
    timeoutMs = 60 * 60_000,
    relevantCapabilities,
    runtimeProtocol,
    inputCleanupGrantId = null,
    validatedAt = new Date().toISOString(),
  }) {
    await this.init();
    if (!relevantCapabilities || typeof relevantCapabilities !== 'object') {
      throw new WorkflowConfigurationError('缺少部署能力快照', 'INVALID_DEPLOYMENT_CAPABILITIES');
    }
    const normalizedTimeout = Number(timeoutMs);
    if (!Number.isInteger(normalizedTimeout) || normalizedTimeout < 10_000 || normalizedTimeout > 7_200_000) {
      throw new WorkflowConfigurationError('工作流超时时间必须在 10 秒到 2 小时之间', 'INVALID_DEPLOYMENT_TIMEOUT');
    }
    if (!['local-comfyui', 'runninghub-workflow', 'runninghub-webapp'].includes(runner)) {
      throw new WorkflowConfigurationError('工作流运行器无效', 'INVALID_WORKFLOW_RUNNER');
    }
    const normalizedConnection = runner === 'runninghub-workflow'
      ? {
          baseUrl: normalizeRunningHubBaseUrl(baseUrl),
          credentialRef: normalizeCredentialReference(credentialRef),
          remoteWorkflowId: assertRunningHubRemoteId(remoteWorkflowId),
          includeWorkflowJson: Boolean(includeWorkflowJson),
        }
      : runner === 'runninghub-webapp'
        ? {
            baseUrl: normalizeRunningHubBaseUrl(baseUrl),
            credentialRef: normalizeCredentialReference(credentialRef),
            remoteWebAppId: assertRunningHubRemoteId(remoteWebAppId, 'RunningHub WebApp ID'),
            instanceType: normalizeRunningHubInstanceType(instanceType),
            apiProtocol: normalizeRunningHubWebAppProtocol(apiProtocol),
          }
        : { serverUrl: normalizeLocalComfyServer(serverUrl) };
    const record = {
      id: crypto.randomUUID(),
      schemaVersion: 1,
      definitionId: assertId(definitionId, '工作流定义标识'),
      definitionRevision: Number(definitionRevision),
      executionPlanHash: assertHash(executionPlanHash, '执行计划哈希'),
      runner,
      connection: normalizedConnection,
      timeoutMs: normalizedTimeout,
      relevantCapabilities: clone(relevantCapabilities),
      relevantCapabilityHash: sha256Json(relevantCapabilities),
      runtimeProtocol: normalizeRuntimeProtocol(runtimeProtocol, runner),
      inputCleanupGrantId: runner !== 'local-comfyui' || inputCleanupGrantId == null
        ? null
        : assertId(inputCleanupGrantId, '清理授权标识'),
      validatedAt,
      createdAt: new Date().toISOString(),
    };
    if (!Number.isInteger(record.definitionRevision) || record.definitionRevision < 1) {
      throw new WorkflowConfigurationError('工作流定义版本无效', 'INVALID_DEFINITION_REVISION');
    }
    record.runtimeProtocolHash = sha256Json(record.runtimeProtocol);
    record.deploymentSnapshotHash = sha256Json(deploymentSemantic(record));
    await writeImmutable(this.objectPath(this.deploymentsDirectory, record.id), record);
    return clone(record);
  }

  async requireDeployment(id) {
    const record = await this.readObject(this.deploymentsDirectory, id, '工作流部署');
    validateDeploymentIntegrity(record);
    return clone(record);
  }

  async listDeployments(definitionId) {
    const records = await this.listObjects(this.deploymentsDirectory, definitionId);
    for (const record of records) validateDeploymentIntegrity(record);
    return records.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async withBindingLock(definitionId, operation) {
    const previous = this.bindingLocks.get(definitionId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.bindingLocks.set(definitionId, current);
    try {
      return await current;
    } finally {
      if (this.bindingLocks.get(definitionId) === current) this.bindingLocks.delete(definitionId);
    }
  }

  async createBindingSet(input) {
    const definitionId = assertId(input.definitionId, '工作流定义标识');
    return this.withBindingLock(definitionId, async () => {
      const existing = await this.listBindingSets(definitionId);
      if (input.previousBindingSetId) {
        const previous = existing.find((record) => record.id === input.previousBindingSetId);
        if (!previous) {
          throw new WorkflowConfigurationError(
            '上一版参数绑定集不存在',
            'BINDING_SET_PREVIOUS_NOT_FOUND',
            409,
          );
        }
      }
      const record = {
        id: crypto.randomUUID(),
        schemaVersion: 1,
        definitionId,
        definitionRevision: Number(input.definitionRevision),
        executionPlanHash: assertHash(input.executionPlanHash, '执行计划哈希'),
        revision: existing.reduce((maximum, item) => Math.max(maximum, item.revision || 0), 0) + 1,
        previousBindingSetId: input.previousBindingSetId || null,
        name: String(input.name || '参数配置').trim().slice(0, 120) || '参数配置',
        bindings: clone(input.bindings || []),
        createdAt: new Date().toISOString(),
      };
      if (!Number.isInteger(record.definitionRevision) || record.definitionRevision < 1) {
        throw new WorkflowConfigurationError('工作流定义版本无效', 'INVALID_DEFINITION_REVISION');
      }
      if (!Array.isArray(record.bindings) || record.bindings.length > 256) {
        throw new WorkflowConfigurationError('参数绑定数量超过限制', 'BINDING_SET_SIZE_LIMIT');
      }
      const keys = record.bindings.map((binding) => binding?.key);
      if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length) {
        throw new WorkflowConfigurationError('参数绑定 key 无效或重复', 'INVALID_BINDING_KEY');
      }
      record.bindingSetHash = sha256Json(bindingSetSemantic(record));
      await writeImmutable(this.objectPath(this.bindingSetsDirectory, record.id), record);
      return clone(record);
    });
  }

  async requireBindingSet(id) {
    const record = await this.readObject(this.bindingSetsDirectory, id, '参数绑定集');
    validateBindingSetIntegrity(record);
    return clone(record);
  }

  async listBindingSets(definitionId) {
    const records = await this.listObjects(this.bindingSetsDirectory, definitionId);
    for (const record of records) validateBindingSetIntegrity(record);
    return records.sort((left, right) => Number(left.revision) - Number(right.revision));
  }

  async createOutputBindingSet(input) {
    const definitionId = assertId(input.definitionId, '工作流定义标识');
    return this.withBindingLock(`outputs:${definitionId}`, async () => {
      const existing = await this.listOutputBindingSets(definitionId);
      const record = {
        id: crypto.randomUUID(),
        schemaVersion: 1,
        definitionId,
        definitionRevision: Number(input.definitionRevision),
        executionPlanHash: assertHash(input.executionPlanHash, '执行计划哈希'),
        sourceRunId: assertId(input.sourceRunId, '来源运行标识'),
        sourceReceiptHash: assertHash(input.sourceReceiptHash, '来源凭证哈希'),
        revision: existing.reduce((maximum, item) => Math.max(maximum, item.revision || 0), 0) + 1,
        name: String(input.name || '输出配置').trim().slice(0, 120) || '输出配置',
        outputs: clone(input.outputs || []),
        createdAt: new Date().toISOString(),
      };
      if (!Array.isArray(record.outputs) || record.outputs.length === 0 || record.outputs.length > 256) {
        throw new WorkflowConfigurationError('输出绑定数量无效', 'OUTPUT_BINDING_SET_SIZE_LIMIT');
      }
      if (record.outputs.filter((output) => output.primary === true).length !== 1) {
        throw new WorkflowConfigurationError('输出绑定集必须恰好有一个主输出', 'INVALID_PRIMARY_OUTPUT');
      }
      record.outputBindingSetHash = sha256Json(outputBindingSetSemantic(record));
      await writeImmutable(
        this.objectPath(this.outputBindingSetsDirectory, record.id),
        record,
      );
      return clone(record);
    });
  }

  async requireOutputBindingSet(id) {
    const record = await this.readObject(this.outputBindingSetsDirectory, id, '输出绑定集');
    validateOutputBindingSetIntegrity(record);
    return clone(record);
  }

  async listOutputBindingSets(definitionId) {
    const records = await this.listObjects(this.outputBindingSetsDirectory, definitionId);
    for (const record of records) validateOutputBindingSetIntegrity(record);
    return records.sort((left, right) => Number(left.revision) - Number(right.revision));
  }

  async createAttestation(input) {
    await this.init();
    const record = {
      id: crypto.randomUUID(),
      schemaVersion: 1,
      definitionId: assertId(input.definitionId, '工作流定义标识'),
      definitionRevision: Number(input.definitionRevision),
      executionPlanHash: assertHash(input.executionPlanHash, '执行计划哈希'),
      bindingSetId: assertId(input.bindingSetId, '参数绑定集标识'),
      bindingSetHash: assertHash(input.bindingSetHash, '参数绑定集哈希'),
      outputBindingSetId: assertId(input.outputBindingSetId, '输出绑定集标识'),
      outputBindingSetHash: assertHash(input.outputBindingSetHash, '输出绑定集哈希'),
      deploymentId: assertId(input.deploymentId, '部署标识'),
      deploymentSnapshotHash: assertHash(input.deploymentSnapshotHash, '部署快照哈希'),
      relevantCapabilityHash: assertHash(input.relevantCapabilityHash, '能力快照哈希'),
      runId: assertId(input.runId, '运行标识'),
      receiptHash: assertHash(input.receiptHash, '测试凭证哈希'),
      succeededAt: input.succeededAt,
      createdAt: new Date().toISOString(),
    };
    record.attestationHash = sha256Json(attestationSemantic(record));
    await writeImmutable(this.objectPath(this.attestationsDirectory, record.id), record);
    return clone(record);
  }

  async requireAttestation(id) {
    const record = await this.readObject(this.attestationsDirectory, id, '测试证明');
    validateAttestationIntegrity(record);
    return clone(record);
  }

  async listAttestations(definitionId) {
    const records = await this.listObjects(this.attestationsDirectory, definitionId);
    for (const record of records) validateAttestationIntegrity(record);
    return records.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }
}

export function toDeploymentDto(record) {
  const common = {
    id: record.id,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    runner: record.runner,
    timeoutMs: record.timeoutMs,
    relevantCapabilityHash: record.relevantCapabilityHash,
    runtimeProtocolHash: record.runtimeProtocolHash,
    nodeTypeCount: Object.keys(record.relevantCapabilities || {}).length,
    deploymentSnapshotHash: record.deploymentSnapshotHash,
    validatedAt: record.validatedAt,
    createdAt: record.createdAt,
  };
  if (record.runner === 'runninghub-workflow') {
    return {
      ...common,
      baseUrl: record.connection.baseUrl,
      credentialRef: record.connection.credentialRef,
      remoteWorkflowId: record.connection.remoteWorkflowId,
      includeWorkflowJson: Boolean(record.connection.includeWorkflowJson),
      apiRevision: record.runtimeProtocol.apiRevision,
      supportsCancellation: false,
    };
  }
  if (record.runner === 'runninghub-webapp') {
    return {
      ...common,
      baseUrl: record.connection.baseUrl,
      credentialRef: record.connection.credentialRef,
      remoteWebAppId: record.connection.remoteWebAppId,
      instanceType: record.connection.instanceType || '',
      apiProtocol: record.connection.apiProtocol || 'legacy-webapp-v1',
      apiRevision: record.runtimeProtocol.apiRevision,
      supportsCancellation: false,
    };
  }
  return {
    ...common,
    serverUrl: record.connection.serverUrl,
    comfyuiVersion: record.runtimeProtocol.comfyuiVersion,
    supportsAtomicJobCancel: record.runtimeProtocol.supportsAtomicJobCancel,
  };
}
