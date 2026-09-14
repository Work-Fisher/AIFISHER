const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const exact = (value, keys) => Object.keys(value).every(key => keys.includes(key));
export function validBudgetControl(value) {
  if (value.action === 'budgets') return exact(value, ['action']);
  if (value.action === 'revokeBudget') return exact(value, ['action', 'authorizationId']) && text(value.authorizationId);
  if (value.action === 'runGeneration') return exact(value, ['action', 'revision', 'generationPlanId', 'authorizationId']) && [value.revision, value.generationPlanId, value.authorizationId].every(text);
  if (value.action !== 'prepareBudget') return null;
  return exact(value, ['action', 'revision', 'nodeIds', 'maxRequests', 'maxOutputs', 'minutes', 'budgetCny']) && text(value.revision)
    && Array.isArray(value.nodeIds) && value.nodeIds.length > 0 && value.nodeIds.length <= 20 && value.nodeIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 255)
    && [[value.maxRequests, 100], [value.maxOutputs, 1000], [value.minutes, 1440]].every(([n, max]) => Number.isInteger(n) && n > 0 && n <= max)
    && (value.budgetCny === undefined || Number.isFinite(value.budgetCny) && value.budgetCny >= 0 && value.budgetCny <= 1000000);
}
export function projectBudgetResult(value, result) {
  if (value.budgets === undefined) return;
  if (!Array.isArray(value.budgets) || value.budgets.length > 100) throw new Error('Invalid budgets');
  result.budgets = value.budgets.map(grant => {
    if (!text(grant?.id) || !['pending', 'approved', 'revoked'].includes(grant.state) || !Number.isFinite(grant.expiresAt)
      || ![grant.maxRequests, grant.maxOutputs, grant.usedRequests, grant.usedOutputs, grant.reservedMicros].every(n => Number.isSafeInteger(n) && n >= 0)
      || grant.budgetMicros !== null && (!Number.isSafeInteger(grant.budgetMicros) || grant.budgetMicros < 0)) throw new Error('Invalid budget');
    return { id: grant.id, state: grant.state, expiresAt: grant.expiresAt, maxRequests: grant.maxRequests, maxOutputs: grant.maxOutputs,
      usedRequests: grant.usedRequests, usedOutputs: grant.usedOutputs, budgetMicros: grant.budgetMicros, reservedMicros: grant.reservedMicros };
  });
}
export const budgetControlSchema = {
  authorizationId: { type: 'string' }, generationPlanId: { type: 'string' },
  maxRequests: { type: 'integer', minimum: 1, maximum: 100 }, maxOutputs: { type: 'integer', minimum: 1, maximum: 1000 },
  minutes: { type: 'integer', minimum: 1, maximum: 1440 }, budgetCny: { type: 'number', minimum: 0, maximum: 1000000 },
};
