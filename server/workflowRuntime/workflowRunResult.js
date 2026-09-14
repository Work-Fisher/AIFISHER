import { classifyReceiptOutput } from './workflowAttestationService.js';

const PROJECTED_OUTPUT_FIELDS = ['assetId', 'url', 'value', 'sha256', 'bytes'];
const OUTPUT_LABELS = {
  image: '图片结果',
  mask: '遮罩结果',
  video: '视频结果',
  audio: '音频结果',
  text: '文字结果',
  json: '数据结果',
};

export class WorkflowRunResultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WorkflowRunResultError';
    this.code = code;
    this.status = 409;
    this.retryable = false;
  }
}

function outputNotFound(message) {
  throw new WorkflowRunResultError(message, 'WORKFLOW_OUTPUT_NOT_FOUND');
}

function projectVerifiedReceipt(receipt, outputBindingSet) {
  const outputs = outputBindingSet.outputs.map((binding) => {
    const selected = receipt.outputs.find((output) =>
      String(output.nodeId) === String(binding.selector.nodeId)
      && String(output.outputKey) === String(binding.selector.outputKey)
      && Number(output.outputIndex) === Number(binding.selector.outputIndex));
    if (!selected || String(selected.mediaKind) !== String(binding.mediaKind)) {
      outputNotFound(`工作流没有生成已配置的输出“${binding.label || binding.key}”`);
    }
    if (!classifyReceiptOutput(selected).selectable) {
      outputNotFound('旧输出配置包含临时预览或内部状态，请基于原成功记录重新确认工作流输出。');
    }
    const projected = {
      portId: binding.key,
      label: binding.label || binding.key,
      primary: binding.primary === true,
      mediaKind: binding.mediaKind,
    };
    for (const field of PROJECTED_OUTPUT_FIELDS) {
      if (Object.hasOwn(selected, field)) projected[field] = selected[field];
    }
    return projected;
  });
  if (!outputs.some((output) => output.primary)) {
    outputNotFound('工作流主输出缺失');
  }
  return { ...receipt, outputs };
}

function projectDraftReceipt(receipt) {
  const outputs = receipt.outputs
    .filter((output) => classifyReceiptOutput(output).selectable)
    .map((output, index) => ({
      ...output,
      portId: `draft_output_${index + 1}`,
      label: OUTPUT_LABELS[output.mediaKind] || '数据结果',
      primary: index === 0,
    }));
  if (outputs.length === 0) {
    outputNotFound('工作流运行成功，但没有返回可用结果。请检查工作流输出节点。');
  }
  return { ...receipt, outputs };
}

export async function projectWorkflowRunReceipt({ task, receipt, configurationStore }) {
  if (task?.kind !== 'workflow-node') return receipt;
  if (!task.outputBindingSetId) return projectDraftReceipt(receipt);

  const outputBindingSet = await configurationStore.requireOutputBindingSet(
    task.outputBindingSetId,
  );
  if (outputBindingSet.outputBindingSetHash !== task.outputBindingSetHash) {
    throw new WorkflowRunResultError(
      '画布工作流输出配置已变化，请重新生成节点并运行。',
      'WORKFLOW_OUTPUT_BINDING_STALE',
    );
  }
  return projectVerifiedReceipt(receipt, outputBindingSet);
}

export async function validateWorkflowRunReceipt({
  coordinator,
  configurationStore,
  runId,
  receipt,
}) {
  const task = coordinator.getTask(runId);
  await projectWorkflowRunReceipt({ task, receipt, configurationStore });
}
