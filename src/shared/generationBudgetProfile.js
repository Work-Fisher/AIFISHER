// A quantity authorization permits new creative content, never different execution parameters.
const omitted = new Set(['nodeId', 'projectId', 'generationAttemptId', 'agentAuthorizationId', 'agentPlanId', 'prompt', 'lyrics', 'cost']);
const media = new Set(['imageBase64', 'images', 'videos', 'audios', 'videoUrl']);
function referenceProfile(value) {
  if (Array.isArray(value)) return value.map(referenceProfile);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['url', 'imageUrl', 'dataUrl', 'image', 'base64'].includes(key) ? Boolean(item) : referenceProfile(item)]));
  return typeof value === 'string' && /^(?:https?:|data:|\/library\/)/.test(value) ? true : value;
}
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, ordered(value[key])]));
  return value;
}
export function generationBudgetProfile(request) {
  const result = {};
  for (const [key, value] of Object.entries(request)) {
    if (omitted.has(key) || value === undefined) continue;
    result[key] = media.has(key) ? (Array.isArray(value) ? value.length : value ? 1 : 0) : key === 'midjourneyReferences' ? referenceProfile(value) : value;
  }
  return JSON.stringify(ordered(result));
}
