export type ImageModeDefinition = { value: string };

export type ImageModeAdapter = {
  isAutomatic: (mode: string | null | undefined) => boolean;
  resolve: (mode: string | null | undefined, hasImageInput: boolean) => string;
  supports: (
    supportedModes: readonly ImageModeDefinition[] | null | undefined,
    mode: string,
  ) => boolean;
};

const STANDARD_IMAGE_MODES = new Set(['text-to-image', 'image-to-image']);

export function isAutomaticImageMode(mode: string | null | undefined): boolean {
  return !mode || STANDARD_IMAGE_MODES.has(mode);
}

export function resolveImageGenerationMode(
  currentMode: string | null | undefined,
  hasImageInput: boolean,
): string {
  if (!isAutomaticImageMode(currentMode)) return currentMode!;
  return hasImageInput ? 'image-to-image' : 'text-to-image';
}

export function supportsImageGenerationMode(
  supportedModes: readonly ImageModeDefinition[] | null | undefined,
  mode: string,
): boolean {
  return supportedModes?.some((candidate) => candidate.value === mode) ?? false;
}

declare global {
  interface Window {
    __FISHERAI_IMAGE_MODE__?: ImageModeAdapter;
  }
}

export function installImageModeAdapter(target: Window = window): ImageModeAdapter {
  if (target.__FISHERAI_IMAGE_MODE__) return target.__FISHERAI_IMAGE_MODE__;

  const adapter: ImageModeAdapter = {
    isAutomatic: isAutomaticImageMode,
    resolve: resolveImageGenerationMode,
    supports: supportsImageGenerationMode,
  };
  target.__FISHERAI_IMAGE_MODE__ = adapter;
  return adapter;
}
