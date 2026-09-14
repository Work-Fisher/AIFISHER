import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';

const MODEL_INPUT_TYPES = Object.freeze({
  ckpt_name: 'checkpoints',
  unet_name: 'diffusionModels',
  clip_name: 'textEncoders',
  vae_name: 'vaes',
  lora_name: 'loras',
});

const WORKFLOW_DIRECTORY = path.join(RUNTIME_PATHS.SERVER_DIR, 'comfyui', 'workflows');
const registryCache = new WeakMap();

export function extractWorkflowRequirements(workflow) {
  const nodeTypes = new Set();
  const models = new Map();
  for (const node of Object.values(workflow || {})) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.class_type === 'string' && node.class_type.trim()) {
      nodeTypes.add(node.class_type);
    }
    for (const [field, type] of Object.entries(MODEL_INPUT_TYPES)) {
      const name = node.inputs?.[field];
      if (typeof name !== 'string' || !name.trim()) continue;
      models.set(`${type}:${name}`, { type, name });
    }
  }
  return {
    nodeTypes: [...nodeTypes].sort(),
    models: [...models.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function loadWorkflowRequirements(workflowRegistry) {
  if (!workflowRegistry || typeof workflowRegistry !== 'object') return {};
  if (registryCache.has(workflowRegistry)) return registryCache.get(workflowRegistry);
  const loading = Promise.all(Object.entries(workflowRegistry).map(async ([type, configuration]) => {
    if (configuration.requirements) return [type, configuration];
    const templateFile = String(configuration.templateFile || '');
    if (!templateFile || path.basename(templateFile) !== templateFile) {
      return [type, { ...configuration, requirements: { nodeTypes: [], models: [] } }];
    }
    const content = await readFile(path.join(WORKFLOW_DIRECTORY, templateFile), 'utf8');
    return [type, {
      ...configuration,
      requirements: extractWorkflowRequirements(JSON.parse(content)),
    }];
  })).then((entries) => Object.fromEntries(entries));
  registryCache.set(workflowRegistry, loading);
  return loading;
}
