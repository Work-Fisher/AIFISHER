import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS, TEXT_MODELS } from '../../config/modelConfig';
import type { CanvasNode } from '../nodes/canvasNodeOperations';

type Scalar = string | number | boolean;
type Parameter = {
  key: string;
  label?: string;
  type: string;
  default?: Scalar;
  min?: number;
  max?: number;
  options?: { value: Scalar }[];
};
type Model = {
  name: string;
  source?: string;
  resolutions?: string[];
  aspectRatios?: string[];
  advancedParams?: Parameter[];
  selectable?: boolean;
  imageModes?: { value: string }[];
  videoModes?: { value: string }[];
  audioModes?: { value: string }[];
  languageModes?: { value: string }[];
};
const catalogs: Record<string, Model[]> = {
  Image: IMAGE_MODELS,
  Video: VIDEO_MODELS,
  Audio: AUDIO_MODELS,
  Text: TEXT_MODELS,
};
export const modeKey = (type: string) =>
  type === 'Text' ? 'languageMode' : `${type.toLowerCase()}Mode`;
export const modelKey = (type: string) => `${type.toLowerCase()}Model`;
export function canvasModels(type: string) {
  // Keep retired descriptors available to the execution path so old projects
  // can still resolve their saved model metadata; new choices are filtered by
  // the source/Agent catalogs before reaching this helper.
  return catalogs[type] || [];
}
export function modelParameters(type: string, name: string) {
  const model = canvasModels(type).find((item) => item.name === name);
  if (!model) return [];
  const modes =
    model.imageModes || model.videoModes || model.audioModes || model.languageModes || [];
  const parameters: Parameter[] = [
    ...(modes.length
      ? [
          {
            key: 'mode',
            type: 'select',
            options: modes.map((item) => ({ value: item.value })),
            default: modes[0].value,
          },
        ]
      : []),
    ...(model.resolutions?.length
      ? [
          {
            key: 'resolution',
            type: 'select',
            options: model.resolutions.map((value) => ({ value })),
            default: model.resolutions[0],
          },
        ]
      : []),
    ...(model.aspectRatios?.length
      ? [
          {
            key: 'aspectRatio',
            type: 'select',
            options: model.aspectRatios.map((value) => ({ value })),
            default: model.aspectRatios[0],
          },
        ]
      : []),
    ...(model.advancedParams || []),
  ];
  // Only actual UI parameter descriptors are exposed, never endpoints/provider configuration.
  return parameters
    .filter((item) =>
      ['select', 'slider', 'number', 'toggle', 'text', 'textarea'].includes(item.type),
    )
    .map((item) => ({
      key: item.key,
      label: item.label || item.key,
      type: item.type,
      ...(item.default !== undefined ? { default: item.default } : {}),
      ...(['dreamina_cli', 'libtv_cli'].includes(model.source || '') && item.key === 'duration' ? { integer: true } : {}),
      ...(item.min !== undefined ? { min: item.min } : {}),
      ...(item.max !== undefined ? { max: item.max } : {}),
      ...(item.options ? { options: item.options.map((option) => option.value) } : {}),
    }));
}
export function configureCanvasModel(
  node: CanvasNode,
  model: string,
  parameters: Record<string, Scalar>,
): Partial<CanvasNode> | null {
  if (
    !canvasModels(node.type).some((item) => item.name === model) ||
    node.status === 'loading' ||
    node.generationAttemptId
  )
    return null;
  const descriptors = modelParameters(node.type, model);
  const patch: Partial<CanvasNode> = { [modelKey(node.type)]: model };
  for (const [key, value] of Object.entries(parameters)) {
    const descriptor = descriptors.find((item) => item.key === key);
    if (descriptor?.integer && !Number.isInteger(value)) return null;
    if (!descriptor || ['__proto__', 'prototype', 'constructor'].includes(key)) return null;
    if (
      descriptor.options
        ? !descriptor.options.includes(value)
        : descriptor.type === 'toggle'
          ? typeof value !== 'boolean'
          : ['slider', 'number'].includes(descriptor.type)
            ? typeof value !== 'number' ||
              !Number.isFinite(value) ||
              value < (descriptor.min ?? -Infinity) ||
              value > (descriptor.max ?? Infinity)
            : typeof value !== 'string'
    )
      return null;
    if (
      key === 'generateCount' &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100)
    )
      return null;
    patch[key === 'mode' ? modeKey(node.type) : key] = value;
  }
  // A model switch starts from its own defaults instead of inheriting incompatible old values.
  if (node[modelKey(node.type)] !== model)
    for (const item of descriptors) {
      const key = item.key === 'mode' ? modeKey(node.type) : item.key;
      if (!(key in patch) && item.default !== undefined) patch[key] = item.default;
    }
  if (node.type === 'Text' && patch.languageMode !== undefined) patch.textMode = patch.languageMode;
  return patch;
}
