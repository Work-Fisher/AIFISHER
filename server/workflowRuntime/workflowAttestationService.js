import { sha256Json } from './workflowFormat.js';
import { isComfyPreviewNode } from './comfySavedOutputs.js';

const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const BOOLEAN_METADATA_KEYS = new Set(['animated', 'isanimated', 'completed', 'cached']);

function safeDisplayText(value, fallback, maximum = 120) {
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

export class WorkflowAttestationError extends Error {
  constructor(message, code = 'WORKFLOW_ATTESTATION_ERROR', status = 400) {
    super(message);
    this.name = 'WorkflowAttestationError';
    this.code = code;
    this.status = status;
  }
}

function candidateSemantic(receiptHash, output) {
  return {
    receiptHash,
    nodeId: String(output.nodeId),
    outputKey: String(output.outputKey),
    outputIndex: Number(output.outputIndex),
    mediaKind: String(output.mediaKind),
  };
}

function outputCandidateId(receiptHash, output) {
  return `out_${sha256Json(candidateSemantic(receiptHash, output)).slice(0, 32)}`;
}

function friendlyFileName(mediaKind) {
  if (mediaKind === 'video') return '视频文件';
  if (mediaKind === 'image' || mediaKind === 'mask') return '图片文件';
  if (mediaKind === 'audio') return '音频文件';
  return '结果文件';
}

export function classifyReceiptOutput(output) {
  if (isComfyPreviewNode(output?.classType)
    || (output?.comfyOutput && (output.comfyOutput.type !== 'output' || output.comfyOutput.saved !== true))) {
    return {
      kind: output?.assetId ? 'file' : 'inline', category: 'metadata', selectable: false,
      displayName: '临时预览（非成品）',
      description: '工作流内部预览，不作为最终素材；请重新确认正式保存的输出。',
    };
  }
  const outputKey = String(output?.outputKey || '');
  const normalizedKey = outputKey.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
  const kind = output?.assetId ? 'file' : 'inline';
  const metadata = kind === 'inline'
    && typeof output?.value === 'boolean'
    && BOOLEAN_METADATA_KEYS.has(normalizedKey);
  if (metadata) {
    return {
      kind,
      category: 'metadata',
      selectable: false,
      displayName: normalizedKey === 'animated' || normalizedKey === 'isanimated'
        ? '动画标记（非文件）'
        : `${outputKey}（内部状态）`,
      description: normalizedKey === 'animated' || normalizedKey === 'isanimated'
        ? '动画状态标记，不是输出文件'
        : '工作流内部状态，不是可绑定结果',
      valuePreview: String(output.value),
    };
  }
  return {
    kind,
    category: 'result',
    selectable: true,
    displayName: kind === 'file'
      ? friendlyFileName(String(output?.mediaKind || ''))
      : `${String(output?.classType || 'Unknown')} · ${outputKey}`,
  };
}

function toOutputCandidate(receipt, output) {
  const presentation = classifyReceiptOutput(output);
  return {
    id: outputCandidateId(receipt.receiptHash, output),
    nodeId: String(output.nodeId),
    classType: String(output.classType || 'Unknown').slice(0, 160),
    outputKey: String(output.outputKey),
    outputIndex: Number(output.outputIndex),
    mediaKind: String(output.mediaKind),
    ...presentation,
    ...(output.assetId ? { assetId: output.assetId } : {}),
  };
}

function assertReference(condition) {
  if (!condition) {
    throw new WorkflowAttestationError(
      '工作流定义、配置、运行凭证之间的引用不一致',
      'WORKFLOW_ATTESTATION_REFERENCE_CONFLICT',
      409,
    );
  }
}

function normalizeOutputBindings(receipt, requestedOutputs) {
  if (!Array.isArray(requestedOutputs) || requestedOutputs.length === 0 || requestedOutputs.length > 256) {
    throw new WorkflowAttestationError(
      '请选择 1 至 256 个真实运行输出',
      'INVALID_OUTPUT_BINDINGS',
    );
  }
  const candidates = receipt.outputs.map((output) => toOutputCandidate(receipt, output));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seenCandidateIds = new Set();
  const seenKeys = new Set();
  const normalized = requestedOutputs.map((requested, index) => {
    const candidateId = String(requested?.candidateId || '');
    const candidate = byId.get(candidateId);
    if (!candidate || seenCandidateIds.has(candidateId)) {
      throw new WorkflowAttestationError(
        '输出选择必须来自指定测试运行且不能重复',
        'OUTPUT_CANDIDATE_INVALID',
        409,
      );
    }
    if (!candidate.selectable) {
      throw new WorkflowAttestationError(
        '临时预览或内部状态不能作为工作流最终输出，请选择正式保存的结果。',
        'OUTPUT_METADATA_NOT_BINDABLE',
        409,
      );
    }
    seenCandidateIds.add(candidateId);
    const key = String(requested?.key || `output_${index + 1}`).trim();
    if (!SAFE_KEY.test(key) || seenKeys.has(key)) {
      throw new WorkflowAttestationError('输出 key 无效或重复', 'INVALID_OUTPUT_KEY');
    }
    seenKeys.add(key);
    return {
      key,
      label: safeDisplayText(requested?.label, key),
      primary: requested?.primary === true,
      candidateId,
      selector: {
        nodeId: candidate.nodeId,
        outputKey: candidate.outputKey,
        outputIndex: candidate.outputIndex,
      },
      mediaKind: candidate.mediaKind,
    };
  });
  if (normalized.filter((output) => output.primary).length !== 1) {
    throw new WorkflowAttestationError(
      '输出配置必须恰好指定一个主输出',
      'INVALID_PRIMARY_OUTPUT',
    );
  }
  return normalized;
}

export function toOutputBindingSetDto(record) {
  return {
    id: record.id,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    sourceRunId: record.sourceRunId,
    sourceReceiptHash: record.sourceReceiptHash,
    revision: record.revision,
    name: safeDisplayText(record.name, '输出配置'),
    outputs: record.outputs,
    outputBindingSetHash: record.outputBindingSetHash,
    createdAt: record.createdAt,
  };
}

export function toAttestationDto(record) {
  return {
    id: record.id,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    bindingSetId: record.bindingSetId,
    bindingSetHash: record.bindingSetHash,
    outputBindingSetId: record.outputBindingSetId,
    outputBindingSetHash: record.outputBindingSetHash,
    deploymentId: record.deploymentId,
    deploymentSnapshotHash: record.deploymentSnapshotHash,
    relevantCapabilityHash: record.relevantCapabilityHash,
    runId: record.runId,
    receiptHash: record.receiptHash,
    succeededAt: record.succeededAt,
    attestationHash: record.attestationHash,
    createdAt: record.createdAt,
  };
}

export class WorkflowAttestationService {
  constructor({ definitionStore, configurationStore, runStore }) {
    Object.assign(this, { definitionStore, configurationStore, runStore });
  }

  async requireReceiptForDefinition(definitionId, runId) {
    const [{ definition, executionPlanHash }, receipt] = await Promise.all([
      this.definitionStore.readExecutionPlan(definitionId),
      this.runStore.requireReceipt(runId),
    ]);
    assertReference(
      receipt.definitionId === definition.id
      && receipt.definitionRevision === definition.revision
      && receipt.executionPlanHash === executionPlanHash,
    );
    return { definition, executionPlanHash, receipt };
  }

  async listOutputCandidates(definitionId, runId) {
    const { receipt } = await this.requireReceiptForDefinition(definitionId, runId);
    return receipt.outputs.map((output) => toOutputCandidate(receipt, output));
  }

  async createOutputBindingSet(definitionId, input) {
    const { definition, executionPlanHash, receipt } = await this.requireReceiptForDefinition(
      definitionId,
      input?.sourceRunId,
    );
    const outputs = normalizeOutputBindings(receipt, input?.outputs);
    const record = await this.configurationStore.createOutputBindingSet({
      definitionId: definition.id,
      definitionRevision: definition.revision,
      executionPlanHash,
      sourceRunId: receipt.id,
      sourceReceiptHash: receipt.receiptHash,
      name: input?.name,
      outputs,
    });
    return toOutputBindingSetDto(record);
  }

  async listOutputBindingSets(definitionId) {
    await this.definitionStore.requireDefinition(definitionId);
    return (await this.configurationStore.listOutputBindingSets(definitionId))
      .map(toOutputBindingSetDto);
  }

  async createAttestation(definitionId, input) {
    const [plan, deployment, bindingSet, outputBindingSet, receipt] = await Promise.all([
      this.definitionStore.readExecutionPlan(definitionId),
      this.configurationStore.requireDeployment(input?.deploymentId),
      this.configurationStore.requireBindingSet(input?.bindingSetId),
      this.configurationStore.requireOutputBindingSet(input?.outputBindingSetId),
      this.runStore.requireReceipt(input?.runId),
    ]);
    const { definition, executionPlanHash } = plan;
    assertReference(
      deployment.definitionId === definition.id
      && bindingSet.definitionId === definition.id
      && outputBindingSet.definitionId === definition.id
      && receipt.definitionId === definition.id
      && deployment.definitionRevision === definition.revision
      && bindingSet.definitionRevision === definition.revision
      && outputBindingSet.definitionRevision === definition.revision
      && receipt.definitionRevision === definition.revision
      && deployment.executionPlanHash === executionPlanHash
      && bindingSet.executionPlanHash === executionPlanHash
      && outputBindingSet.executionPlanHash === executionPlanHash
      && receipt.executionPlanHash === executionPlanHash
      && receipt.deploymentId === deployment.id
      && receipt.deploymentSnapshotHash === deployment.deploymentSnapshotHash
      && receipt.relevantCapabilityHash === deployment.relevantCapabilityHash
      && receipt.bindingSetId === bindingSet.id
      && receipt.bindingSetHash === bindingSet.bindingSetHash
      && outputBindingSet.sourceRunId === receipt.id
      && outputBindingSet.sourceReceiptHash === receipt.receiptHash,
    );
    const record = await this.configurationStore.createAttestation({
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
      runId: receipt.id,
      receiptHash: receipt.receiptHash,
      succeededAt: receipt.succeededAt,
    });
    return toAttestationDto(record);
  }

  async listAttestations(definitionId) {
    await this.definitionStore.requireDefinition(definitionId);
    return (await this.configurationStore.listAttestations(definitionId)).map(toAttestationDto);
  }
}
