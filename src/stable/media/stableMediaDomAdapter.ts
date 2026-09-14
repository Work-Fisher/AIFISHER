export interface StableMediaTarget {
  nodeId: string;
  node: HTMLElement;
  image: HTMLImageElement;
  originalUrl: string;
  previewUrl: string;
  selected: boolean;
}

export type StableMediaMode = 'native-preview' | 'pixi' | 'native-original';

function toPreviewUrl(originalUrl: string) {
  if (!originalUrl.startsWith('/library/')) return originalUrl;
  return `/api/media/thumbnail?url=${encodeURIComponent(originalUrl)}&max=960`;
}

export function isStableMediaManagedSource(image: HTMLImageElement) {
  const current = image.getAttribute('src') ?? '';
  const original = image.dataset.fisheraiOriginalSrc;
  if (!original) return false;
  return current === original || current === toPreviewUrl(original);
}

function getOriginalUrl(image: HTMLImageElement) {
  const current = image.getAttribute('src') ?? '';
  const previous = image.dataset.fisheraiOriginalSrc;
  if (!previous) {
    image.dataset.fisheraiOriginalSrc = current;
    return current;
  }

  // React 会在“设为主图”后直接更新 img.src，而节点内的
  // 缩略图增强层会保留上一张原图。只有当当前 src 既不是已记录
  // 的原图，也不是该原图的缩略图时，才把它视为新的 React 结果。
  if (current && current !== previous && current !== toPreviewUrl(previous)) {
    image.dataset.fisheraiOriginalSrc = current;
    return current;
  }

  return previous;
}

export function scanStableMediaTargets(root: ParentNode = document): StableMediaTarget[] {
  const images = root.querySelectorAll<HTMLImageElement>(
    '[data-canvas-nodes-layer="true"] [data-node-id] img',
  );

  return Array.from(images).flatMap((image) => {
    if (image.closest('[data-fisherai-original-media="true"]')) return [];
    const node = image.closest<HTMLElement>('[data-node-id]');
    if (!node) return [];
    const nodeId = node.dataset.nodeId;
    if (!nodeId) return [];
    const originalUrl = getOriginalUrl(image);
    if (!originalUrl) return [];

    return [
      {
        nodeId,
        node,
        image,
        originalUrl,
        previewUrl: toPreviewUrl(originalUrl),
        selected: node.dataset.nodeSelected === 'true',
      },
    ];
  });
}

export function applyStableMediaMode(target: StableMediaTarget, mode: StableMediaMode) {
  if (target.image.dataset.fisheraiPreviewMode !== mode) {
    target.image.dataset.fisheraiPreviewMode = mode;
  }
  if (mode === 'pixi' || mode === 'native-preview') {
    if (target.image.getAttribute('src') !== target.previewUrl) {
      target.image.setAttribute('src', target.previewUrl);
    }
    target.image.style.opacity = mode === 'pixi' ? '0' : '';
    return;
  }

  if (target.image.getAttribute('src') !== target.originalUrl) {
    target.image.setAttribute('src', target.originalUrl);
  }
  target.image.style.opacity = '';
}
