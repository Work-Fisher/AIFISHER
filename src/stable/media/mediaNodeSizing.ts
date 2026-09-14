const ADAPTIVE_MEDIA_TYPES = new Set([
  'Image',
  'Upload Image',
  'Video',
  'Upload Video',
]);

const RESIZABLE_MEDIA_TYPES = new Set([
  ...ADAPTIVE_MEDIA_TYPES,
  'Image Compare',
  'Image Composite',
]);

export interface AdaptiveMediaNode {
  type?: unknown;
  width?: unknown;
  height?: unknown;
  naturalWidth?: unknown;
  naturalHeight?: unknown;
  resultAspectRatio?: unknown;
  aspectRatio?: unknown;
  resultUrl?: unknown;
}

export interface MediaNodeSizingAdapter {
  getSize(node: AdaptiveMediaNode): { width: number; height: number } | undefined;
  isResizable(node: AdaptiveMediaNode): boolean;
}

export function isResizableMediaNode(node: AdaptiveMediaNode): boolean {
  return RESIZABLE_MEDIA_TYPES.has(String(node.type || ''));
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function ratioFromLabel(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^([\d.]+)\s*[/:]\s*([\d.]+)$/);
  if (!match) return undefined;
  const width = positiveNumber(match[1]);
  const height = positiveNumber(match[2]);
  if (!width || !height) return undefined;
  const ratio = width / height;
  return ratio >= 0.05 && ratio <= 20 ? ratio : undefined;
}

function resultMediaAspectRatio(node: AdaptiveMediaNode): number | undefined {
  const resultRatio = ratioFromLabel(node.resultAspectRatio);
  if (resultRatio) return resultRatio;
  const naturalWidth = positiveNumber(node.naturalWidth);
  const naturalHeight = positiveNumber(node.naturalHeight);
  if (naturalWidth && naturalHeight) return naturalWidth / naturalHeight;
  return undefined;
}

/** Output parameters never resize a generated video's placeholder or its previous result. */
export function videoDisplayAspectRatio(node: AdaptiveMediaNode): number {
  if (!node.resultUrl) return 16 / 9;
  return resultMediaAspectRatio(node) ?? 16 / 9;
}

function mediaAspectRatio(node: AdaptiveMediaNode): number | undefined {
  if (node.type === 'Video') return videoDisplayAspectRatio(node);
  return resultMediaAspectRatio(node) ?? ratioFromLabel(node.aspectRatio);
}

export function adaptiveMediaNodeSize(
  node: AdaptiveMediaNode,
): { width: number; height: number } | undefined {
  if (!ADAPTIVE_MEDIA_TYPES.has(String(node.type || ''))) return undefined;
  const ratio = mediaAspectRatio(node);
  if (!ratio) return undefined;
  const storedWidth = positiveNumber(node.width);
  const width = Math.min(4_096, Math.max(112, storedWidth ?? (ratio >= 1 ? 252 * ratio : 252)));
  return {
    width,
    height: Math.min(4_096, Math.max(112, width / ratio)),
  };
}

export function installMediaNodeSizing(): MediaNodeSizingAdapter {
  const adapter = Object.freeze({
    getSize: adaptiveMediaNodeSize,
    isResizable: isResizableMediaNode,
  });
  window.__FISHERAI_MEDIA_NODE_SIZING__ = adapter;
  return adapter;
}

declare global {
  interface Window {
    __FISHERAI_MEDIA_NODE_SIZING__?: MediaNodeSizingAdapter;
  }
}
