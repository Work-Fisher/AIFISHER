import path from 'node:path';

const LEGACY_ANIMA_WEBAPP_ID = '2079545014811885570';
const LEGACY_ANIMA_WORKFLOW_ID = '2079525261288267777';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNode(plan, nodeId, classType) {
  const node = plan?.[nodeId];
  if (!node || node.class_type !== classType || !node.inputs || typeof node.inputs !== 'object') {
    const error = new Error('RunningHub AI 应用的兼容工作流已变化，请重新发布应用后再试。');
    error.code = 'RUNNINGHUB_WEBAPP_COMPATIBILITY_DRIFT';
    error.status = 409;
    throw error;
  }
  return node;
}

export function adaptLegacyAnimaWebAppWorkflow(source) {
  const plan = clone(source);
  const textEncoder = assertNode(plan, '11', 'CLIPTextEncode');
  const promptPreview = assertNode(plan, '70', 'PreviewAny');
  const promptJoin = assertNode(plan, '72', 'JoinStringMulti');
  const legacyPatch = assertNode(plan, '46', 'AnimaLLLiteApply');
  const imageOutput = assertNode(plan, '48', 'SaveImage');
  const legacyPatchName = String(legacyPatch.inputs.lllite_name || '').trim();
  if (
    !Array.isArray(textEncoder.inputs.text)
    || String(textEncoder.inputs.text[0]) !== '70'
    || !legacyPatchName
    || !Array.isArray(legacyPatch.inputs.model)
    || !Array.isArray(legacyPatch.inputs.image)
    || !promptPreview.inputs.source
    || !promptJoin.inputs
  ) {
    const error = new Error('RunningHub AI 应用的兼容工作流已变化，请重新发布应用后再试。');
    error.code = 'RUNNINGHUB_WEBAPP_COMPATIBILITY_DRIFT';
    error.status = 409;
    throw error;
  }

  // The published app still points at the legacy Anima LLLite node contract and
  // exposes PreviewAny (node 70) as its only API output. Current ComfyUI splits
  // patch loading into ModelPatchLoader. Keep the published output node id, but
  // turn it into the real SaveImage output so RunningHub schedules the image graph.
  textEncoder.inputs.text = ['72', 0];
  plan['93'] = {
    class_type: 'ModelPatchLoader',
    inputs: { name: path.posix.basename(legacyPatchName) },
    _meta: { title: 'Load Model Patch' },
  };
  legacyPatch.inputs.model_patch = ['93', 0];
  delete legacyPatch.inputs.lllite_name;
  delete legacyPatch.inputs.preserve_wrapper;
  plan['70'] = clone(imageOutput);
  for (const nodeId of ['48', '88', '90', '91']) delete plan[nodeId];
  return plan;
}

export async function prepareRunningHubWebAppCompatibility(deployment, client) {
  if (
    deployment?.runner !== 'runninghub-webapp'
    || deployment?.connection?.remoteWebAppId !== LEGACY_ANIMA_WEBAPP_ID
    || new URL(deployment.connection.baseUrl).hostname.toLowerCase() !== 'www.runninghub.ai'
  ) return null;

  const source = await client.getWorkflowApiFormat(LEGACY_ANIMA_WORKFLOW_ID);
  return {
    workflowId: LEGACY_ANIMA_WORKFLOW_ID,
    workflow: JSON.stringify(adaptLegacyAnimaWebAppWorkflow(source)),
  };
}
