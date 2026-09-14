import type { AgentVision } from './agentVision';
const CHAT_PROVIDERS = new Set([
  'DoubaoTextProvider',
  'DeepSeekProvider',
  'GlmTextProvider',
  'KimiTextProvider',
  'RelayTextProvider',
]);
interface CatalogModel<Parameter> {
  name: string;
  provider?: string;
  selectable?: boolean;
  supportedReferenceTypes?: readonly string[];
  endpoint?: Record<string, { model?: string }>;
  advancedParams?: Parameter[];
}
/** Public catalog names identify a choice uniquely, even when providers share an upstream id. */
export function canvasAgentModels<Parameter>(catalog: readonly CatalogModel<Parameter>[]) {
  return catalog
    .filter(
      (model) =>
        model.selectable !== false &&
        CHAT_PROVIDERS.has(model.provider || '') &&
        typeof model.endpoint?.['multimodal-chat']?.model === 'string' &&
        model.endpoint['multimodal-chat'].model,
    )
    .map((model) => ({
      id: model.name,
      label: model.name,
      vision: (model.supportedReferenceTypes?.includes('image') ? 'supported'
        : model.provider !== 'RelayTextProvider' && model.supportedReferenceTypes?.includes('text')
          ? 'unsupported' : 'unknown') as AgentVision,
      advancedParams: model.advancedParams || [],
    }))
    .sort((a, b) => Number(b.vision === 'supported') - Number(a.vision === 'supported'));
}
