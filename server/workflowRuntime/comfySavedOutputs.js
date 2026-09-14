export function isComfyPreviewNode(classType) {
  return /preview/i.test(String(classType || ''));
}

export function isSavedComfyFile(candidate, executionPlan) {
  if (candidate?.kind !== 'file' || candidate.handle?.type !== 'output') return false;
  const node = executionPlan
    ? (Object.hasOwn(executionPlan, candidate.nodeId) ? executionPlan[candidate.nodeId] : null)
    : { class_type: candidate.classType, inputs: {} };
  // The returned file type is the save evidence. Custom node names need no registration.
  return node?.class_type === candidate.classType
    && !isComfyPreviewNode(node.class_type)
    && node.inputs?.save_output !== false;
}

// Persist only output policy, not prompts or staged input paths, for interrupted runs.
export function createComfyOutputPlan(executionPlan) {
  return Object.fromEntries(Object.entries(executionPlan).map(([id, node]) => [id, {
    class_type: node.class_type,
    inputs: typeof node.inputs?.save_output === 'boolean'
      ? { save_output: node.inputs.save_output }
      : {},
  }]));
}
