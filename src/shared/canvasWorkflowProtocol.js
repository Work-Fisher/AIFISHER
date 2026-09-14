const text = value => typeof value === 'string' && value.length > 0 && value.length <= 255;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const seed = value => exact(value, value?.mode === 'random' ? ['mode'] : value?.mode === 'fixed' ? ['mode', 'value'] : ['mode', 'value', 'step'])
  && (value.mode === 'random' || ['fixed', 'increment', 'decrement'].includes(value.mode) && Number.isSafeInteger(value.value) && (value.step === undefined || Number.isSafeInteger(value.step) && value.step > 0));
export const workflowParameterSchema = { oneOf: [{ type: ['string', 'number', 'boolean'] }, { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { enum: ['random', 'fixed', 'increment', 'decrement'] }, value: { type: 'integer' }, step: { type: 'integer', minimum: 1 } } }] };
export function validWorkflowControl(value) {
  if (value.action === 'workflows') return exact(value, ['action', 'offset']) && (value.offset === undefined || Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= 100000);
  if (value.action === 'product') return text(value.revision) && exact(value, ['action', 'revision', 'operation', 'nodeId']) && (['upload', 'workflowManager'].includes(value.operation) ? value.nodeId === undefined : ['replace', 'download', 'saveAsset', 'resize', 'runWorkflow'].includes(value.operation) && text(value.nodeId));
  if (value.action !== 'workflow') return null;
  if (!text(value.revision)) return false;
  if (value.operation === 'describe') return exact(value, ['action', 'revision', 'operation', 'definitionId']) && id(value.definitionId);
  if (value.operation === 'insert') return exact(value, ['action', 'revision', 'operation', 'definitionId', 'x', 'y']) && id(value.definitionId) && [value.x, value.y].every(n => Number.isFinite(n) && Math.abs(n) <= 1000000);
  if (value.operation === 'configure') return exact(value, ['action', 'revision', 'operation', 'nodeId', 'parameters']) && text(value.nodeId) && exact(value.parameters, Object.keys(value.parameters || {})) && Object.keys(value.parameters).length <= 50
    && Object.entries(value.parameters).every(([key, value]) => text(key) && !['__proto__', 'constructor', 'prototype'].includes(key) && (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value) || seed(value)));
  return false;
}
export function projectWorkflowResult(value, result) {
  if (value.workflows !== undefined) {
    if (!Array.isArray(value.workflows) || value.workflows.length > 50) throw Error('Invalid workflows');
    result.workflows = value.workflows.map(item => {
      if (!text(item.id) || typeof item.name !== 'string') throw Error('Invalid workflow');
      return { id: item.id, name: item.name.slice(0, 500), ...(typeof item.parameters === 'string' ? { parameters: item.parameters } : {}), ...(item.ready === true ? { ready: true } : {}) };
    });
    if (value.nextOffset !== undefined) {
      if (value.nextOffset !== null && (!Number.isInteger(value.nextOffset) || value.nextOffset < 0 || value.nextOffset > 100000)) throw Error('Invalid pagination');
      result.nextOffset = value.nextOffset;
    }
  }
}
