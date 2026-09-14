import { AUDIO_MODELS, IMAGE_MODELS, TEXT_MODELS, VIDEO_MODELS } from './modelConfig';

// Saved model names and provider IDs remain execution identifiers. Resolve labels
// from the current catalog so old projects and historical activity use the same UI name.
const labels = new Map<string, string>();
for (const model of [...TEXT_MODELS, ...IMAGE_MODELS, ...AUDIO_MODELS, ...VIDEO_MODELS]) {
  if (!('displayName' in model) || typeof model.displayName !== 'string') continue;
  labels.set(model.name, model.displayName);
  for (const endpoint of Object.values(model.endpoint)) {
    if (typeof endpoint.model === 'string') labels.set(endpoint.model, model.displayName);
  }
}

export function modelDisplayName(name: unknown, modelId?: unknown): string {
  const identity = typeof name === 'string' ? name.trim() : '';
  const executionId = typeof modelId === 'string' ? modelId.trim() : '';
  return labels.get(identity) || labels.get(executionId) || identity || executionId || '未知模型';
}
