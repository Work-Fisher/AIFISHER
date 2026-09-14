import crypto from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCapabilityProjection, analyzeWorkflow, sha256Json } from './workflowFormat.js';
import {
  deriveBindingCandidates,
  deriveBindingSetBindings,
  toBindingCandidateDto,
  WorkflowBindingError,
} from './workflowBindingCompiler.js';
import { DYNAMIC_ASSET_LOADER_CLASSES } from './workflowVariableAssetGroups.js';
import { LocalComfyClient, projectRuntimeProtocol } from './localComfyClient.js';
import { toDeploymentDto, WorkflowConfigurationError } from './workflowConfigurationStore.js';
import {
  RunningHubWorkflowClient,
  RunningHubWorkflowClientError,
} from './runningHubWorkflowClient.js';
import { createRunningHubWebAppProjection } from './runningHubWebApp.js';

export class WorkflowDeploymentError extends Error {
  constructor(message, code = 'WORKFLOW_DEPLOYMENT_ERROR', status = 400, details = undefined) {
    super(message);
    this.name = 'WorkflowDeploymentError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function workflowLiteralValuesByClass(executionPlan) {
  const result = new Map();
  for (const node of Object.values(executionPlan)) {
    const fields = result.get(node.class_type) || new Map();
    for (const [fieldName, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) || typeof value === 'object') continue;
      const values = fields.get(fieldName) || new Set();
      values.add(value);
      fields.set(fieldName, values);
    }
    result.set(node.class_type, fields);
  }
  return result;
}

/**
 * ComfyUI upload widgets expose the current input-directory file list as a
 * dynamic enum. Hash the schema and literals used by this plan, not unrelated
 * filenames that happen to be present on the user's machine.
 */
export function createStableCapabilityProjection(executionPlan, objectInfo) {
  const projection = createCapabilityProjection(executionPlan, objectInfo).nodeDefinitions;
  const stable = clone(projection);
  const hasOptionalAutogrow = Object.values(stable).some((definition) =>
    Object.values(definition.input?.optional || {}).some(
      (specification) => Array.isArray(specification) && specification[0] === 'COMFY_AUTOGROW_V3',
    ));
  if (hasOptionalAutogrow) {
    for (const classType of DYNAMIC_ASSET_LOADER_CLASSES) {
      if (!stable[classType] && objectInfo?.[classType]) {
        stable[classType] = clone(objectInfo[classType]);
      }
    }
  }
  const literals = workflowLiteralValuesByClass(executionPlan);
  for (const [classType, definition] of Object.entries(stable)) {
    for (const section of ['required', 'optional']) {
      for (const [fieldName, specification] of Object.entries(definition.input?.[section] || {})) {
        if (!Array.isArray(specification)) continue;
        const options = specification[1];
        const uploadWidget = options && typeof options === 'object'
          && Object.entries(options).some(([key, value]) => /_upload$/i.test(key) && value === true);
        const dynamicLoaderField = DYNAMIC_ASSET_LOADER_CLASSES.includes(classType)
          && /^(?:image|audio|video)$/i.test(fieldName);
        if (!uploadWidget && !dynamicLoaderField) continue;
        const runtimeOptions = [
          ...(literals.get(classType)?.get(fieldName) || []),
          '__FISHERAI_RUNTIME_UPLOAD__',
        ];
        if (Array.isArray(specification[0])) {
          specification[0] = runtimeOptions;
        } else if (options && typeof options === 'object' && Array.isArray(options.options)) {
          options.options = runtimeOptions;
        }
      }
    }
  }
  return stable;
}

function portableValueType(value) {
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (Number.isInteger(value)) return 'INT';
  if (typeof value === 'number') return 'FLOAT';
  return 'JSON';
}

/**
 * RunningHub exposes the immutable API workflow, but not ComfyUI object_info.
 * This projection describes only fields and links proven by that API workflow;
 * it must never be presented as the remote machine's complete node capability.
 */
export function createPortableWorkflowProjection(executionPlan) {
  const projection = Object.create(null);
  const outputSlots = new Map();
  for (const node of Object.values(executionPlan)) {
    if (!projection[node.class_type]) {
      projection[node.class_type] = {
        input: { optional: Object.create(null) },
        input_order: { optional: [] },
        output: [],
        output_name: [],
        output_node: /(?:Save|Preview|Output|VideoCombine|Audio.*Save)/i.test(node.class_type),
      };
    }
    const definition = projection[node.class_type];
    for (const [fieldName, value] of Object.entries(node.inputs)) {
      const connected = Array.isArray(value)
        && value.length === 2
        && (typeof value[0] === 'string' || Number.isInteger(value[0]))
        && Number.isInteger(value[1])
        && value[1] >= 0;
      const specification = connected
        ? ['ANY', { forceInput: true }]
        : [portableValueType(value), {
            default: value,
            ...(typeof value === 'string' && (value.length > 80 || /prompt|text|description/i.test(fieldName))
              ? { multiline: true }
              : {}),
          }];
      const previous = definition.input.optional[fieldName];
      if (!previous) {
        definition.input.optional[fieldName] = specification;
        definition.input_order.optional.push(fieldName);
      } else if (previous[0] !== specification[0]) {
        definition.input.optional[fieldName] = ['JSON', { default: value }];
      }
      if (connected) {
        const sourceNode = executionPlan[String(value[0])];
        if (sourceNode) {
          const current = outputSlots.get(sourceNode.class_type) || -1;
          outputSlots.set(sourceNode.class_type, Math.max(current, value[1]));
        }
      }
    }
  }
  for (const [classType, maximumSlot] of outputSlots) {
    const definition = projection[classType];
    definition.output = Array.from({ length: maximumSlot + 1 }, () => 'ANY');
    definition.output_name = definition.output.map((_, index) => `output_${index}`);
  }
  return JSON.parse(JSON.stringify(projection));
}

function safePublicText(value, fallback, maximum = 160) {
  const text = String(value ?? '').trim();
  if (
    !text
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    || /[\0\r\n\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text)
    || /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/)[^\s"'<>]+)/i.test(text)
    || /https?:\/\/[^\s"'<>]+/i.test(text)
    || /(?:api[_ -]?key|authorization|bearer|token|secret|password)\s*[:=]/i.test(text)
  ) return fallback;
  return text.slice(0, maximum);
}

function toPlannedOutputDto(candidate, index) {
  const opaqueId = sha256Json({
    index,
    nodeId: candidate?.nodeId,
    classType: candidate?.classType,
  }).slice(0, 32);
  return {
    id: `planned_${opaqueId}`,
    nodeId: safePublicText(candidate?.nodeId, `node-${opaqueId.slice(0, 10)}`),
    classType: safePublicText(candidate?.classType, '本机输出节点'),
    title: safePublicText(candidate?.title, '本机输出节点', 120),
    outputTypes: Array.isArray(candidate?.outputTypes)
      ? candidate.outputTypes.slice(0, 64).map((type, outputIndex) => (
        safePublicText(type, `output-${outputIndex + 1}`, 120)
      ))
      : [],
  };
}

export class WorkflowDeploymentService {
  constructor({
    definitionStore,
    configurationStore,
    directoryGrantStore = null,
    clientFactory = (options) => new LocalComfyClient(options),
    runningHubClientFactory = (options) => new RunningHubWorkflowClient(options),
    credentialResolver = () => null,
  }) {
    if (!definitionStore || !configurationStore) {
      throw new Error('WorkflowDeploymentService requires definition and configuration stores');
    }
    this.definitionStore = definitionStore;
    this.configurationStore = configurationStore;
    this.directoryGrantStore = directoryGrantStore;
    this.clientFactory = clientFactory;
    this.runningHubClientFactory = runningHubClientFactory;
    this.credentialResolver = credentialResolver;
  }

  async inspectRuntime(serverUrl, timeoutMs) {
    const client = this.clientFactory({ serverUrl, timeoutMs });
    const [systemStats, objectInfo, supportsAtomicJobCancel] = await Promise.all([
      client.getSystemStats(),
      client.getObjectInfo(),
      client.supportsAtomicJobCancel().catch(() => false),
    ]);
    return {
      client,
      objectInfo,
      runtimeProtocol: projectRuntimeProtocol(systemStats, supportsAtomicJobCancel),
    };
  }

  async verifyInputCleanupMapping(client, grantId) {
    const runId = crypto.randomUUID();
    const filename = `${crypto.randomUUID()}.bin`;
    const subfolder = `fisherai-runs/${runId}`;
    const content = crypto.randomBytes(32);
    const probeDirectory = path.join(this.configurationStore.rootDirectory, 'cleanup-probes');
    const probePath = path.join(probeDirectory, filename);
    await mkdir(probeDirectory, { recursive: true });
    await writeFile(probePath, content, { flag: 'wx' });
    try {
      const handle = await client.uploadInput({
        filePath: probePath,
        filename,
        subfolder,
      });
      const relativeHandle = handle.subfolder ? `${handle.subfolder}/${handle.name}` : handle.name;
      const result = await this.directoryGrantStore.deleteOwnedStagedFiles(grantId, runId, [{
        relativeHandle,
        bytes: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
      }]);
      if (result.deleted !== 1) {
        throw new WorkflowDeploymentError(
          '所选输入目录与当前 ComfyUI 的上传目录不一致',
          'CLEANUP_GRANT_MAPPING_MISMATCH',
          409,
        );
      }
    } catch (error) {
      if (error instanceof WorkflowDeploymentError) throw error;
      throw new WorkflowDeploymentError(
        '无法验证 ComfyUI 输入暂存与清理目录映射',
        'CLEANUP_GRANT_MAPPING_MISMATCH',
        409,
      );
    } finally {
      await rm(probePath, { force: true });
    }
  }

  async createDeployment(definitionId, {
    runner = 'local-comfyui',
    serverUrl,
    baseUrl,
    credentialRef,
    remoteWorkflowId,
    remoteWebAppId,
    webAppInfo,
    apiProtocol = 'legacy-webapp-v1',
    includeWorkflowJson = false,
    instanceType = '',
    timeoutMs,
    inputCleanupGrantId,
  }) {
    if (runner === 'runninghub-webapp') {
      const { definition, apiJson, executionPlanHash } = await this.definitionStore
        .readExecutionPlan(definitionId);
      const apiKey = await this.credentialResolver(credentialRef);
      const client = this.runningHubClientFactory({ baseUrl, apiKey, timeoutMs });
      const projection = createRunningHubWebAppProjection(
        remoteWebAppId,
        webAppInfo || (client.getWebAppInfoForProtocol
          ? await client.getWebAppInfoForProtocol(remoteWebAppId, apiProtocol)
          : await client.getWebAppInfo(remoteWebAppId)),
      );
      if (projection.executionPlanHash !== executionPlanHash) {
        throw new WorkflowDeploymentError(
          'RunningHub WebApp 开放字段已变化，请重新添加该云端工作流',
          'RUNNINGHUB_WEBAPP_SCHEMA_MISMATCH',
          409,
        );
      }
      const analysis = analyzeWorkflow(apiJson, 'comfy-api', {
        objectInfo: projection.nodeDefinitions,
      });
      const deployment = await this.configurationStore.createDeployment({
        definitionId: definition.id,
        definitionRevision: definition.revision,
        executionPlanHash,
        runner,
        baseUrl,
        credentialRef,
        remoteWebAppId,
        apiProtocol,
        instanceType,
        timeoutMs,
        relevantCapabilities: projection.nodeDefinitions,
        runtimeProtocol: {
          apiRevision: apiProtocol === 'ai-app-v2' ? 'ai-app-v2' : 'ai-app-v1',
          remoteTemplateHash: projection.schemaHash,
        },
      });
      return {
        deployment,
        dto: toDeploymentDto(deployment),
        candidates: deriveBindingCandidates({
          executionPlan: apiJson,
          nodeDefinitions: projection.nodeDefinitions,
        }).map(toBindingCandidateDto),
        outputs: analysis.candidateOutputs.map(toPlannedOutputDto),
      };
    }
    if (runner === 'runninghub-workflow') {
      const { definition, apiJson, executionPlanHash } = await this.definitionStore
        .readExecutionPlan(definitionId);
      const apiKey = await this.credentialResolver(credentialRef);
      const client = this.runningHubClientFactory({ baseUrl, apiKey, timeoutMs });
      const remotePlan = await client.getWorkflowApiFormat(remoteWorkflowId);
      const remoteTemplateHash = sha256Json(remotePlan);
      if (!includeWorkflowJson && remoteTemplateHash !== executionPlanHash) {
        throw new WorkflowDeploymentError(
          '本地执行计划与 RunningHub 远程工作流不一致，请上传匹配的 API Format 或启用完整工作流覆盖',
          'RUNNINGHUB_WORKFLOW_MISMATCH',
          409,
        );
      }
      const relevantCapabilities = createPortableWorkflowProjection(apiJson);
      const analysis = analyzeWorkflow(apiJson, 'comfy-api', { objectInfo: relevantCapabilities });
      const deployment = await this.configurationStore.createDeployment({
        definitionId: definition.id,
        definitionRevision: definition.revision,
        executionPlanHash,
        runner,
        baseUrl,
        credentialRef,
        remoteWorkflowId,
        includeWorkflowJson,
        timeoutMs,
        relevantCapabilities,
        runtimeProtocol: { apiRevision: '2026-04-08', remoteTemplateHash },
      });
      return {
        deployment,
        dto: toDeploymentDto(deployment),
        candidates: deriveBindingCandidates({
          executionPlan: apiJson,
          nodeDefinitions: relevantCapabilities,
        }).map(toBindingCandidateDto),
        outputs: analysis.candidateOutputs.map(toPlannedOutputDto),
      };
    }
    if (inputCleanupGrantId) {
      if (!this.directoryGrantStore) {
        throw new WorkflowDeploymentError(
          '当前服务未启用 ComfyUI 输入目录清理授权',
          'CLEANUP_GRANT_UNAVAILABLE',
          409,
        );
      }
      await this.directoryGrantStore.requireGrant(inputCleanupGrantId, {
        purpose: 'comfy-input-cleanup',
        access: 'delete-owned-staged-files',
      });
    }
    const { definition, apiJson, executionPlanHash } = await this.definitionStore
      .readExecutionPlan(definitionId);
    const runtime = await this.inspectRuntime(serverUrl, timeoutMs);
    if (inputCleanupGrantId) {
      await this.verifyInputCleanupMapping(runtime.client, inputCleanupGrantId);
    }
    const analysis = analyzeWorkflow(apiJson, 'comfy-api', { objectInfo: runtime.objectInfo });
    const relevantCapabilities = createStableCapabilityProjection(apiJson, runtime.objectInfo);
    const deployment = await this.configurationStore.createDeployment({
      definitionId: definition.id,
      definitionRevision: definition.revision,
      executionPlanHash,
      serverUrl,
      timeoutMs,
      relevantCapabilities,
      runtimeProtocol: runtime.runtimeProtocol,
      inputCleanupGrantId,
    });
    return {
      deployment,
      dto: toDeploymentDto(deployment),
      candidates: deriveBindingCandidates({
        executionPlan: apiJson,
        nodeDefinitions: relevantCapabilities,
      }).map(toBindingCandidateDto),
      outputs: analysis.candidateOutputs.map(toPlannedOutputDto),
    };
  }

  async verifyDeployment(deployment, apiJson) {
    if (deployment.runner === 'runninghub-webapp') {
      const apiKey = await this.credentialResolver(deployment.connection.credentialRef);
      const client = this.runningHubClientFactory({
        baseUrl: deployment.connection.baseUrl,
        apiKey,
        timeoutMs: deployment.timeoutMs,
      });
      let projection = createRunningHubWebAppProjection(
        deployment.connection.remoteWebAppId,
        client.getWebAppInfoForProtocol
          ? await client.getWebAppInfoForProtocol(
              deployment.connection.remoteWebAppId,
              deployment.connection.apiProtocol || 'legacy-webapp-v1',
            )
          : await client.getWebAppInfo(deployment.connection.remoteWebAppId),
      );
      // schemaHash also includes the app name and display text. Existing deployments
      // retain that historical hash; validate the executable plan and field contract
      // against their saved hashes instead, without rewriting user inputs or snapshots.
      const matchesDeployment = (candidate) => (
        candidate.executionPlanHash === deployment.executionPlanHash
        && sha256Json(candidate.nodeDefinitions) === deployment.relevantCapabilityHash
        && sha256Json({
          apiRevision: deployment.runtimeProtocol.apiRevision,
          supportsCancellation: false,
          remoteTemplateHash: deployment.runtimeProtocol.remoteTemplateHash,
        }) === deployment.runtimeProtocolHash
      );
      if (!matchesDeployment(projection)
        && ['www.runninghub.ai', 'runninghub.ai'].includes(new URL(deployment.connection.baseUrl).hostname)
        && client.getGlobalAiAppPageInfo) {
        // Older imports captured the English page. Accept that live representation
        // only if the executable contract still matches; never overwrite saved inputs.
        projection = createRunningHubWebAppProjection(
          deployment.connection.remoteWebAppId,
          await client.getGlobalAiAppPageInfo(deployment.connection.remoteWebAppId),
        );
      }
      if (!matchesDeployment(projection)) {
        throw new WorkflowDeploymentError(
          'RunningHub WebApp 字段已变化，请重新验证云端工作流',
          'CAPABILITY_DRIFT',
          409,
        );
      }
      const analysis = analyzeWorkflow(apiJson, 'comfy-api', {
        objectInfo: projection.nodeDefinitions,
      });
      return { client, analysis, relevantCapabilities: projection.nodeDefinitions };
    }
    if (deployment.runner === 'runninghub-workflow') {
      const apiKey = await this.credentialResolver(deployment.connection.credentialRef);
      const client = this.runningHubClientFactory({
        baseUrl: deployment.connection.baseUrl,
        apiKey,
        timeoutMs: deployment.timeoutMs,
      });
      const remotePlan = await client.getWorkflowApiFormat(deployment.connection.remoteWorkflowId);
      const remoteTemplateHash = sha256Json(remotePlan);
      if (
        remoteTemplateHash !== deployment.runtimeProtocol.remoteTemplateHash
        || (!deployment.connection.includeWorkflowJson
          && remoteTemplateHash !== deployment.executionPlanHash)
      ) {
        throw new WorkflowDeploymentError(
          'RunningHub 远程工作流已变化，请重新验证部署',
          'CAPABILITY_DRIFT',
          409,
        );
      }
      const relevantCapabilities = createPortableWorkflowProjection(apiJson);
      const analysis = analyzeWorkflow(apiJson, 'comfy-api', { objectInfo: relevantCapabilities });
      if (
        sha256Json(relevantCapabilities) !== deployment.relevantCapabilityHash
        || sha256Json({
          apiRevision: deployment.runtimeProtocol.apiRevision,
          supportsCancellation: false,
          remoteTemplateHash,
        }) !== deployment.runtimeProtocolHash
      ) {
        throw new WorkflowDeploymentError(
          'RunningHub 部署能力已变化，请重新验证',
          'CAPABILITY_DRIFT',
          409,
        );
      }
      return { client, analysis, relevantCapabilities };
    }
    const runtime = await this.inspectRuntime(
      deployment.connection.serverUrl,
      deployment.timeoutMs,
    );
    const analysis = analyzeWorkflow(apiJson, 'comfy-api', { objectInfo: runtime.objectInfo });
    const relevantCapabilities = createStableCapabilityProjection(apiJson, runtime.objectInfo);
    const relevantCapabilityHash = sha256Json(relevantCapabilities);
    const runtimeProtocolHash = sha256Json(runtime.runtimeProtocol);
    return {
      ...runtime,
      analysis,
      relevantCapabilities,
      capabilityChanged: relevantCapabilityHash !== deployment.relevantCapabilityHash,
      runtimeProtocolChanged: runtimeProtocolHash !== deployment.runtimeProtocolHash,
    };
  }

  async listDeployments(definitionId) {
    return (await this.configurationStore.listDeployments(definitionId)).map(toDeploymentDto);
  }

  async listBindingCandidates(definitionId, deploymentId) {
    const [{ definition, apiJson, executionPlanHash }, deployment] = await Promise.all([
      this.definitionStore.readExecutionPlan(definitionId),
      this.configurationStore.requireDeployment(deploymentId),
    ]);
    if (
      deployment.definitionId !== definition.id
      || deployment.definitionRevision !== definition.revision
      || deployment.executionPlanHash !== executionPlanHash
    ) {
      throw new WorkflowDeploymentError('部署与当前工作流版本不一致', 'WORKFLOW_REFERENCE_CONFLICT', 409);
    }
    return deriveBindingCandidates({
      executionPlan: apiJson,
      nodeDefinitions: deployment.relevantCapabilities,
    }).map(toBindingCandidateDto);
  }

  async createBindingSet(definitionId, {
    deploymentId,
    name,
    previousBindingSetId,
    bindings: selections,
  }) {
    const [{ definition, apiJson, executionPlanHash }, deployment] = await Promise.all([
      this.definitionStore.readExecutionPlan(definitionId),
      this.configurationStore.requireDeployment(deploymentId),
    ]);
    if (
      deployment.definitionId !== definition.id
      || deployment.definitionRevision !== definition.revision
      || deployment.executionPlanHash !== executionPlanHash
    ) {
      throw new WorkflowDeploymentError('部署与当前工作流版本不一致', 'WORKFLOW_REFERENCE_CONFLICT', 409);
    }
    const bindings = deriveBindingSetBindings({
      executionPlan: apiJson,
      nodeDefinitions: deployment.relevantCapabilities,
      selections,
    });
    return this.configurationStore.createBindingSet({
      definitionId: definition.id,
      definitionRevision: definition.revision,
      executionPlanHash,
      previousBindingSetId,
      name,
      bindings,
    });
  }
}

export function isWorkflowRuntimeDomainError(error) {
  return error instanceof WorkflowDeploymentError
    || error instanceof WorkflowBindingError
    || error instanceof WorkflowConfigurationError
    || error instanceof RunningHubWorkflowClientError;
}
