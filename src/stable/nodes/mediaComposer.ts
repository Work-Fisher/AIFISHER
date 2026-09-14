import type { ConnectedAssetsProps } from './canvasConnectedAssets';
import type * as ReactTypes from 'react';
import type { CanvasPromptEditor } from '../prompt/canvasPromptEditor';
import type { GenerationModel } from '../generation/canvasGenerationRequests';
export type ComposerRuntime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'Fragment'
  | 'useState'
  | 'useRef'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useSyncExternalStore'
>;
export interface ComposerNode {
  id: string;
  type: string;
  projectId?: string;
  parentIds?: string[];
  prompt?: string;
  imageModel?: string;
  videoModel?: string;
  imageMode?: string;
  videoMode?: string;
  resolution?: string;
  aspectRatio?: string;
  generateCount?: number;
  duration?: number;
  generate_audio?: boolean;
  speed?: string;
  errorMessage?: string;
  generationDurationMs?: number;
  [key: string]: unknown;
}
export interface ComposerAsset {
  id: string;
  type: string;
  url?: string;
  prompt?: string;
  textContent?: string;
  [key: string]: unknown;
}
export interface ComposerModel extends GenerationModel {
  advancedParams?: (NonNullable<GenerationModel['advancedParams']>[number] & {
    type?: string;
    step?: number;
    options?: { value: string | number | boolean; label: string }[];
  })[];
  imageModes?: Array<{ value: string; label: string }>;
  videoModes?: Array<{
    value: string;
    label: string;
    allowedInputs?: Partial<Record<'text' | 'image' | 'video' | 'audio', number>>;
  }>;
  aspectRatios?: string[];
  resolutions?: string[];
}
export interface MediaComposerProps {
  data: ComposerNode;
  isLoading?: boolean;
  connectedImageNodes?: ComposerAsset[];
  onUpdate(id: string, patch: Partial<ComposerNode>): void;
  onGenerate(id: string): void;
  onSelect(id: string): void;
}
type Icon = ReactTypes.ComponentType<{ size: number }>;
export interface MediaComposerComponents {
  models: ComposerModel[];
  ratios: string[];
  resolutions: string[];
  PromptEditor: ReactTypes.ComponentType<Parameters<typeof CanvasPromptEditor>[1]>;
  ConnectedAssets: ReactTypes.ComponentType<ConnectedAssetsProps>;
  ModelSelector: ReactTypes.ComponentType<{
    isVideoNode: boolean;
    currentModel: ComposerModel;
    availableModels: ComposerModel[];
    disabled: boolean;
    onModelChange(name: string): void;
  }>;
  Dimensions: ReactTypes.ComponentType<{
    videoSettings?: {
      duration: number;
      parameter?: NonNullable<ComposerModel['advancedParams']>[number];
      fixed: boolean;
      audio?: boolean;
    };
    data: ComposerNode;
    onUpdate(patch: Partial<ComposerNode>): void;
    disabled: boolean;
    allRatios: string[];
    supportedRatios: string[];
    allResolutions: string[];
    supportedResolutions: string[];
    isDark: boolean;
  }>;
  AdvancedSettings: ReactTypes.ComponentType<Record<string, unknown>>;
  Tooltip: ReactTypes.ComponentType<{ text: string; children: ReactTypes.ReactNode }>;
  CollapseIcon: Icon;
  SettingsIcon: Icon;
  GenerateIcon: Icon;
  VolumeIcon?: Icon;
  MuteIcon?: Icon;
}
const subscribeNone = () => () => {},
  zero = () => 0;
export function useComposerBusy(React: ComposerRuntime, id: string, loading: boolean) {
  const scheduler = window.__FISHERAI_GENERATION_SCHEDULER__;
  React.useSyncExternalStore(
    scheduler?.subscribe || subscribeNone,
    scheduler?.version || zero,
    zero,
  );
  return loading || !!scheduler?.isInFlight(id);
}
export function useComposerPricing(React: ComposerRuntime) {
  const pricing = window.__FISHERAI_MODEL_PRICING__;
  React.useSyncExternalStore(pricing?.subscribe || subscribeNone, pricing?.version || zero, zero);
  return pricing;
}
export function changeComposerModel(
  kind: 'image' | 'video',
  node: ComposerNode,
  model: ComposerModel,
  ratios: string[],
  resolutions: string[],
): Partial<ComposerNode> {
  const patch: Partial<ComposerNode> = { [`${kind}Model`]: model.name };
  const modes = kind === 'image' ? model.imageModes : model.videoModes;
  const currentMode = kind === 'image' ? node.imageMode : node.videoMode;
  if (modes?.length && !modes.some((mode) => mode.value === currentMode))
    patch[`${kind}Mode`] = modes[0].value;
  const nextRatios = model.aspectRatios || ratios,
    nextResolutions = model.resolutions || resolutions;
  if (node.aspectRatio && !nextRatios.includes(node.aspectRatio)) patch.aspectRatio = nextRatios[0];
  if (node.resolution && !nextResolutions.includes(node.resolution))
    patch.resolution = nextResolutions[0];
  const count = model.advancedParams?.find((parameter) => parameter.key === 'generateCount');
  if (kind === 'image' && typeof count?.default === 'number') patch.generateCount = count.default;
  return patch;
}
