import {
  isBindingRequiredForDeployment,
  toBindingSetDto,
} from './workflowBindingCompiler.js';
import {
  classifyReceiptOutput,
  toOutputBindingSetDto,
} from './workflowAttestationService.js';
import { sha256Json } from './workflowFormat.js';
import { normalizeRunningHubInstanceType } from './runningHubWorkflowClient.js';

const HASH = /^[a-f\d]{64}$/i;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const MEDIA_KINDS = new Set(['image', 'mask', 'video', 'audio', 'text', 'json']);

export class WorkflowCanvasNodeError extends Error {
  constructor(message, code = 'WORKFLOW_CANVAS_NODE_ERROR', status = 400) {
    super(message);
    this.name = 'WorkflowCanvasNodeError';
    this.code = code;
    this.status = status;
  }
}

function assertUuid(value, label) {
  const normalized = String(value || '');
  if (!UUID.test(normalized)) {
    throw new WorkflowCanvasNodeError(`${label}无效`, 'INVALID_WORKFLOW_CANVAS_REFERENCE');
  }
  return normalized;
}

function assertHash(value, label) {
  const normalized = String(value || '');
  if (!HASH.test(normalized)) {
    throw new WorkflowCanvasNodeError(`${label}无效`, 'INVALID_WORKFLOW_CANVAS_HASH');
  }
  return normalized.toLowerCase();
}

function safeDisplayText(value, fallback, maximum = 120) {
  const text = String(value ?? '').trim();
  if (
    !text
    || Buffer.byteLength(text, 'utf8') > maximum * 4
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    || /[\0\r\n\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text)
    || /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/)[^\s"'<>]+)/i.test(text)
    || /https?:\/\/[^\s"'<>]+/i.test(text)
    || /(?:api[_ -]?key|authorization|bearer|token|secret|password)\s*[:=]/i.test(text)
  ) return fallback;
  return text.slice(0, maximum);
}

function referencesMatch({
  definition,
  executionPlanHash,
  attestation,
  deployment,
  bindingSet,
  outputBindingSet,
  receipt,
}) {
  return attestation.definitionId === definition.id
    && attestation.definitionRevision === definition.revision
    && attestation.executionPlanHash === executionPlanHash
    && deployment.id === attestation.deploymentId
    && deployment.definitionId === definition.id
    && deployment.definitionRevision === definition.revision
    && deployment.executionPlanHash === executionPlanHash
    && deployment.deploymentSnapshotHash === attestation.deploymentSnapshotHash
    && deployment.relevantCapabilityHash === attestation.relevantCapabilityHash
    && bindingSet.id === attestation.bindingSetId
    && bindingSet.definitionId === definition.id
    && bindingSet.definitionRevision === definition.revision
    && bindingSet.executionPlanHash === executionPlanHash
    && bindingSet.bindingSetHash === attestation.bindingSetHash
    && outputBindingSet.id === attestation.outputBindingSetId
    && outputBindingSet.definitionId === definition.id
    && outputBindingSet.definitionRevision === definition.revision
    && outputBindingSet.executionPlanHash === executionPlanHash
    && outputBindingSet.outputBindingSetHash === attestation.outputBindingSetHash
    && outputBindingSet.sourceRunId === receipt.id
    && outputBindingSet.sourceReceiptHash === receipt.receiptHash
    && receipt.id === attestation.runId
    && receipt.receiptHash === attestation.receiptHash
    && receipt.definitionId === definition.id
    && receipt.definitionRevision === definition.revision
    && receipt.executionPlanHash === executionPlanHash
    && receipt.deploymentId === deployment.id
    && receipt.deploymentSnapshotHash === deployment.deploymentSnapshotHash
    && receipt.relevantCapabilityHash === deployment.relevantCapabilityHash
    && receipt.bindingSetId === bindingSet.id
    && receipt.bindingSetHash === bindingSet.bindingSetHash;
}

function bindingMatchesPlan(bindingSet, { definition, executionPlanHash }) {
  return bindingSet.definitionId === definition.id
    && bindingSet.definitionRevision === definition.revision
    && bindingSet.executionPlanHash === executionPlanHash;
}

function workflowReference({ definition, executionPlanHash, attestation, deployment, bindingSet, outputBindingSet }) {
  return {
    verificationStatus: 'verified',
    definitionId: definition.id,
    definitionRevision: definition.revision,
    executionPlanHash,
    bindingSetId: bindingSet.id,
    bindingSetHash: bindingSet.bindingSetHash,
    outputBindingSetId: outputBindingSet.id,
    outputBindingSetHash: outputBindingSet.outputBindingSetHash,
    deploymentId: deployment.id,
    deploymentSnapshotHash: deployment.deploymentSnapshotHash,
    relevantCapabilityHash: deployment.relevantCapabilityHash,
    attestationId: attestation.id,
    attestationHash: attestation.attestationHash,
  };
}

function draftWorkflowReference({ definition, executionPlanHash, deployment, bindingSet }) {
  return {
    verificationStatus: 'draft',
    definitionId: definition.id,
    definitionRevision: definition.revision,
    executionPlanHash,
    bindingSetId: bindingSet.id,
    bindingSetHash: bindingSet.bindingSetHash,
    deploymentId: deployment.id,
    deploymentSnapshotHash: deployment.deploymentSnapshotHash,
    relevantCapabilityHash: deployment.relevantCapabilityHash,
  };
}

function inputPorts(bindingSetDto, bindingSet, deployment) {
  const storedBindingsById = new Map(bindingSet.bindings.map((binding) => [binding.id, binding]));
  return bindingSetDto.bindings
    .filter((binding) => binding.control.kind === 'asset')
    .map((binding, index) => ({
      id: binding.key,
      bindingId: binding.id,
      label: binding.label,
      mediaKind: MEDIA_KINDS.has(binding.control.mediaKind)
        ? binding.control.mediaKind
        : 'image',
      required: isBindingRequiredForDeployment(
        storedBindingsById.get(binding.id) || binding,
        deployment,
      ),
      multiple: Boolean(binding.control.multiple),
      maximumItems: Math.min(100, Math.max(1, Number(binding.control.maximumItems || 1))),
      portIndex: index,
    }));
}

function outputPorts(outputBindingSetDto) {
  return outputBindingSetDto.outputs.map((output, index) => ({
    id: output.key,
    label: safeDisplayText(output.label, output.key),
    mediaKind: MEDIA_KINDS.has(output.mediaKind) ? output.mediaKind : 'json',
    primary: output.primary === true,
    portIndex: index,
    selector: {
      nodeId: String(output.selector.nodeId),
      outputKey: String(output.selector.outputKey),
      outputIndex: Number(output.selector.outputIndex),
    },
  }));
}

function parameterSchema(bindingSetDto) {
  return bindingSetDto.bindings
    .filter((binding) => binding.control.kind !== 'asset')
    .map((binding) => ({
      key: binding.key,
      bindingId: binding.id,
      label: binding.label,
      description: binding.description || '',
      control: binding.control,
      presentation: binding.presentation,
    }));
}

function initialParameterValues(schema) {
  return Object.fromEntries(schema
    .filter((parameter) => parameter.control.hasDefault)
    .map((parameter) => [parameter.key, parameter.control.defaultValue]));
}

function canvasNodeSemantic(blueprint) {
  return {
    schemaVersion: blueprint.schemaVersion,
    kind: blueprint.kind,
    workflowRef: blueprint.workflowRef,
    inputPorts: blueprint.inputPorts,
    outputPorts: blueprint.outputPorts,
    parameterSchema: blueprint.parameterSchema,
  };
}

function buildBlueprint(current, input = {}) {
  const bindingSetDto = toBindingSetDto(current.bindingSet);
  const outputBindingSetDto = toOutputBindingSetDto(current.outputBindingSet);
  const schema = parameterSchema(bindingSetDto);
  const defaultTitle = safeDisplayText(current.definition.name, '工作流');
  const blueprint = {
    schemaVersion: 1,
    kind: 'workflow',
    type: 'Workflow',
    title: safeDisplayText(input.title, defaultTitle),
    coverUrl: current.definition.presentation?.customCoverUrl || null,
    subtitle: current.deployment.runner === 'local-comfyui'
      ? '本地 ComfyUI'
      : current.deployment.runner === 'runninghub-webapp'
        ? 'RunningHub 云端 WebApp'
        : 'RunningHub 工作流',
    executionTarget: current.deployment.runner === 'local-comfyui' ? 'local' : 'cloud',
    ...(['runninghub-workflow', 'runninghub-webapp'].includes(current.deployment.runner)
      ? { runningHubInstanceType: normalizeRunningHubInstanceType(current.deployment.connection.instanceType) }
      : {}),
    workflowRef: workflowReference(current),
    inputPorts: inputPorts(bindingSetDto, current.bindingSet, current.deployment),
    outputPorts: outputPorts(outputBindingSetDto),
    parameterSchema: schema,
    parameterValues: initialParameterValues(schema),
    executionState: { status: 'idle' },
    ui: {
      width: 520,
      height: Math.min(700, Math.max(420, 310 + Math.ceil(schema.length / 2) * 54)),
      collapsed: false,
    },
  };
  blueprint.canvasNodeHash = sha256Json(canvasNodeSemantic(blueprint));
  return blueprint;
}

function buildDraftBlueprint(current, input = {}) {
  const bindingSetDto = toBindingSetDto(current.bindingSet);
  const schema = parameterSchema(bindingSetDto);
  const defaultTitle = safeDisplayText(current.definition.name, '工作流');
  const blueprint = {
    schemaVersion: 1,
    kind: 'workflow',
    type: 'Workflow',
    title: safeDisplayText(input.title, defaultTitle),
    coverUrl: current.definition.presentation?.customCoverUrl || null,
    subtitle: current.deployment.runner === 'local-comfyui'
      ? '本地 ComfyUI · 首次运行时验证'
      : current.deployment.runner === 'runninghub-webapp'
        ? 'RunningHub 云端 WebApp · 首次运行时验证'
        : 'RunningHub 工作流 · 首次运行时验证',
    executionTarget: current.deployment.runner === 'local-comfyui' ? 'local' : 'cloud',
    ...(['runninghub-workflow', 'runninghub-webapp'].includes(current.deployment.runner)
      ? { runningHubInstanceType: normalizeRunningHubInstanceType(current.deployment.connection.instanceType) }
      : {}),
    workflowRef: draftWorkflowReference(current),
    inputPorts: inputPorts(bindingSetDto, current.bindingSet, current.deployment),
    outputPorts: [],
    parameterSchema: schema,
    parameterValues: initialParameterValues(schema),
    executionState: { status: 'idle' },
    ui: {
      width: 520,
      height: Math.min(700, Math.max(420, 310 + Math.ceil(schema.length / 2) * 54)),
      collapsed: false,
    },
  };
  blueprint.canvasNodeHash = sha256Json(canvasNodeSemantic(blueprint));
  return blueprint;
}

export class WorkflowCanvasNodeService {
  constructor({
    definitionStore,
    configurationStore,
    runStore,
    deploymentService,
    testRunService,
  }) {
    Object.assign(this, {
      definitionStore,
      configurationStore,
      runStore,
      deploymentService,
      testRunService,
    });
  }

  async requireCurrentConfiguration(
    definitionId,
    attestationId,
    { verifyCapabilities = true, bindingSetId } = {},
  ) {
    const safeAttestationId = assertUuid(attestationId, '测试凭证标识');
    const plan = await this.definitionStore.readExecutionPlan(definitionId);
    const attestation = await this.configurationStore.requireAttestation(safeAttestationId);
    const [deployment, attestedBindingSet, outputBindingSet, receipt] = await Promise.all([
      this.configurationStore.requireDeployment(attestation.deploymentId),
      this.configurationStore.requireBindingSet(attestation.bindingSetId),
      this.configurationStore.requireOutputBindingSet(attestation.outputBindingSetId),
      this.runStore.requireReceipt(attestation.runId),
    ]);
    if (!referencesMatch({
      ...plan,
      attestation,
      deployment,
      bindingSet: attestedBindingSet,
      outputBindingSet,
      receipt,
    })) {
      throw new WorkflowCanvasNodeError(
        '工作流配置或测试凭证已经变化，请重新运行测试',
        'WORKFLOW_CANVAS_ATTESTATION_STALE',
        409,
      );
    }
    const metadataBinding = outputBindingSet.outputs.find((binding) => {
      const selected = receipt.outputs.find((output) => (
        String(output.nodeId) === String(binding.selector?.nodeId)
        && String(output.outputKey) === String(binding.selector?.outputKey)
        && Number(output.outputIndex) === Number(binding.selector?.outputIndex)
      ));
      // File eligibility is checked at the output boundary, not while adding the workflow.
      return selected && !selected.assetId && !classifyReceiptOutput(selected).selectable;
    });
    if (metadataBinding) {
      throw new WorkflowCanvasNodeError(
        '当前输出是动画状态标记，不是视频文件。请重新确认工作流输出。',
        'WORKFLOW_OUTPUT_METADATA_BINDING',
        409,
      );
    }
    if (verifyCapabilities) {
      await this.deploymentService.verifyDeployment(deployment, plan.apiJson);
    }
    let bindingSet = attestedBindingSet;
    if (bindingSetId && bindingSetId !== attestedBindingSet.id) {
      const requestedBindingSetId = assertUuid(bindingSetId, '参数配置标识');
      const bindingSets = await this.configurationStore.listBindingSets(plan.definition.id);
      const byId = new Map(bindingSets.map((item) => [item.id, item]));
      bindingSet = byId.get(requestedBindingSetId);
      if (!bindingSet || !bindingMatchesPlan(bindingSet, plan)) {
        throw new WorkflowCanvasNodeError(
          '字段配置不属于当前已部署工作流',
          'WORKFLOW_CANVAS_BINDING_SET_MISMATCH',
          409,
        );
      }
      const visited = new Set();
      let cursor = bindingSet;
      while (cursor && cursor.id !== attestedBindingSet.id && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        if (!bindingMatchesPlan(cursor, plan)) break;
        cursor = cursor.previousBindingSetId ? byId.get(cursor.previousBindingSetId) : undefined;
      }
      if (cursor?.id !== attestedBindingSet.id) {
        throw new WorkflowCanvasNodeError(
          '字段配置不是当前部署记录的后续版本',
          'WORKFLOW_CANVAS_BINDING_SET_NOT_DESCENDANT',
          409,
        );
      }
    }
    return { ...plan, attestation, deployment, bindingSet, outputBindingSet, receipt };
  }

  async requireDraftConfiguration(
    definitionId,
    { deploymentId, bindingSetId, verifyCapabilities = true } = {},
  ) {
    const safeDeploymentId = assertUuid(deploymentId, '部署标识');
    const safeBindingSetId = assertUuid(bindingSetId, '参数配置标识');
    const plan = await this.definitionStore.readExecutionPlan(definitionId);
    const [deployment, bindingSet] = await Promise.all([
      this.configurationStore.requireDeployment(safeDeploymentId),
      this.configurationStore.requireBindingSet(safeBindingSetId),
    ]);
    if (
      deployment.definitionId !== plan.definition.id
      || deployment.definitionRevision !== plan.definition.revision
      || deployment.executionPlanHash !== plan.executionPlanHash
      || !bindingMatchesPlan(bindingSet, plan)
    ) {
      throw new WorkflowCanvasNodeError(
        '工作流、运行目标与参数配置引用冲突',
        'WORKFLOW_CANVAS_DRAFT_REFERENCE_CONFLICT',
        409,
      );
    }
    if (verifyCapabilities) {
      await this.deploymentService.verifyDeployment(deployment, plan.apiJson);
    }
    return { ...plan, deployment, bindingSet };
  }

  async createBlueprint(definitionId, input = {}) {
    if (!input.attestationId) {
      const current = await this.requireDraftConfiguration(definitionId, {
        deploymentId: input.deploymentId,
        bindingSetId: input.bindingSetId,
        verifyCapabilities: false,
      });
      return buildDraftBlueprint(current, input);
    }
    const current = await this.requireCurrentConfiguration(definitionId, input.attestationId, {
      bindingSetId: input.bindingSetId,
      verifyCapabilities: false,
    });
    return buildBlueprint(current, input);
  }

  async startRun({ idempotencyKey, definitionId, request = {} }) {
    if (!request.attestationId) {
      const current = await this.requireDraftConfiguration(definitionId, {
        deploymentId: request.deploymentId,
        bindingSetId: request.bindingSetId,
      });
      const blueprint = buildDraftBlueprint(current);
      if (assertHash(request.canvasNodeHash, '画布节点哈希') !== blueprint.canvasNodeHash) {
        throw new WorkflowCanvasNodeError(
          '画布草稿配置已经变化，请重新添加节点',
          'WORKFLOW_CANVAS_NODE_STALE',
          409,
        );
      }
      return this.testRunService.start({
        idempotencyKey,
        definitionId: current.definition.id,
        kind: 'workflow-node',
        request: {
          deploymentId: current.deployment.id,
          bindingSetId: current.bindingSet.id,
          projectId: request.projectId,
          values: request.values || {},
          instanceType: request.instanceType,
          confirmExecution: request.confirmExecution === true,
          confirmPaidExecution: request.confirmPaidExecution === true,
        },
      });
    }
    const current = await this.requireCurrentConfiguration(definitionId, request.attestationId, {
      bindingSetId: request.bindingSetId,
    });
    const blueprint = buildBlueprint(current);
    if (assertHash(request.canvasNodeHash, '画布节点哈希') !== blueprint.canvasNodeHash) {
      throw new WorkflowCanvasNodeError(
        '画布节点配置与当前测试凭证不一致，请重新生成节点',
        'WORKFLOW_CANVAS_NODE_STALE',
        409,
      );
    }
    return this.testRunService.start({
      idempotencyKey,
      definitionId: current.definition.id,
      kind: 'workflow-node',
      request: {
        deploymentId: current.deployment.id,
        bindingSetId: current.bindingSet.id,
        outputBindingSetId: current.outputBindingSet.id,
        projectId: request.projectId,
        values: request.values || {},
        instanceType: request.instanceType,
        confirmExecution: request.confirmExecution === true,
        confirmPaidExecution: request.confirmPaidExecution === true,
      },
    });
  }
}
