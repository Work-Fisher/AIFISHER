const text = value => typeof value === 'string' && value.length > 0 && value.length <= 255;
const exact = (value, keys) => Object.keys(value).every(key => keys.includes(key));
export function validTaskControl(value) {
  if (value.action === 'tasks') return exact(value, ['action', 'nodeIds']) && (value.nodeIds === undefined || Array.isArray(value.nodeIds) && value.nodeIds.length > 0 && value.nodeIds.length <= 100 && value.nodeIds.every(text));
  if (value.action === 'cancelTask') return exact(value, ['action', 'revision', 'nodeId']) && text(value.revision) && text(value.nodeId);
  return null;
}
export function projectTaskResult(value, result) {
  if (value.tasks === undefined) return;
  if (!Array.isArray(value.tasks) || value.tasks.length > 100) throw new Error('Invalid tasks');
  result.tasks = value.tasks.map(task => {
    if (!text(task?.nodeId) || !['pending', 'success', 'failed', 'cancelled', 'unknown', 'missing', 'cancelling', 'unsupported'].includes(task.status)) throw new Error('Invalid task');
    return { nodeId: task.nodeId, status: task.status, remoteMayContinue: task.remoteMayContinue === true,
      ...(typeof task.text === 'string' ? { text: task.text } : {}) };
  });
}
