import type * as React from 'react';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { CanvasViewport } from './canvasNavigation';
import { inspectImage, inspectVideo, nearestAspectRatio, type MediaMetadata } from '../media/generationMediaMetadata';

type Asset = Record<string, unknown>;
interface Options {
  enabled: boolean;
  getWorkflowEpoch(): number;
  projectId?: string;
  viewport: CanvasViewport;
  canvasRef: React.RefObject<HTMLElement | null>;
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  closeHistory(): void;
  closeLibrary(): void;
}
interface Runtime {
  createId(): string;
  request(id: string, projectId: string | undefined, signal: AbortSignal): Promise<Asset>;
  inspect(url: string, kind: string): Promise<MediaMetadata>;
  report(message: string): void;
}
const content = (value: unknown) => (typeof value === 'string' ? value : '');
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const defaults: Runtime = {
  createId: () => crypto.randomUUID(),
  async request(id, projectId, signal) {
    const response = await fetch('/api/library/import', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, projectId }),
    });
    const body = await response.json();
    if (!response.ok) throw Error(typeof body?.error === 'string' ? body.error : '导入资产失败');
    if (!body?.asset || typeof body.asset !== 'object' || Array.isArray(body.asset))
      throw Error('导入资产返回无效');
    return body.asset;
  },
  inspect: (url, kind) =>
    kind === 'images'
      ? inspectImage(url)
      : kind === 'videos'
        ? inspectVideo(url, 5000, false)
        : Promise.resolve({}),
  report: (message) => window.alert(message),
};
const supportedTypes = new Set([
  'Image',
  'Video',
  'Audio',
  'Text',
  'Upload Image',
  'Upload Video',
  'Upload Audio',
  'Image Compare',
  'Image Composite',
  'ComfyUI',
]);

/** Preserve the asset's generation parameters; importing it never submits a generation. */
export function assetNode(
  asset: Asset,
  metadata: MediaMetadata,
  projectId: string | undefined,
  point: { x: number; y: number },
  id: string,
): CanvasNode {
  const video = asset.type === 'videos',
    audio = asset.type === 'audios';
  const fallbackType = video ? 'Upload Video' : audio ? 'Upload Audio' : 'Upload Image';
  const width = Number(asset.width), height = Number(asset.height);
  if (!metadata.resultAspectRatio && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    metadata = { ...metadata, resultAspectRatio: `${width}/${height}`, aspectRatio: nearestAspectRatio(width, height) };
  }
  const type = supportedTypes.has(text(asset.nodeType)) ? text(asset.nodeType) : fallbackType;
  const model =
    text(asset.model) ||
    (type.startsWith('Upload') || audio ? 'Upload' : video ? 'veo-3.1' : 'imagen-3.0-generate-002');
  const measuredRatio =
    video && metadata.resultAspectRatio
      ? (() => {
          const [w, h] = metadata.resultAspectRatio.split('/').map(Number);
          return w >= h ? '16:9' : '9:16';
        })()
      : metadata.aspectRatio;
  const node: CanvasNode = {
    id,
    type,
    ...point,
    prompt: content(asset.prompt) || content(asset.title) || content(asset.name),
    title: content(asset.title) || content(asset.name) || undefined,
    status: 'success',
    resultUrl: text(asset.url),
    model,
    aspectRatio:
      text(asset.aspectRatio) ||
      (audio ? (type === 'Audio' ? '4:1' : '1:1') : measuredRatio || '16:9'),
    resultAspectRatio: text(asset.resultAspectRatio) || metadata.resultAspectRatio,
    resolution: text(asset.resolution) || (video ? '720p' : '1K'),
    projectId,
  };
  const prefix =
    type === 'Image' ? 'image' : type === 'Video' ? 'video' : type === 'Audio' ? 'audio' : null;
  if (prefix) {
    node[`${prefix}Model`] = text(asset[`${prefix}Model`]) || model;
    const mode = text(asset[`${prefix}Mode`]);
    if (mode) node[`${prefix}Mode`] = mode;
  }
  if (type === 'Video' && typeof asset.duration === 'number' && Number.isFinite(asset.duration)) {
    node.duration = asset.duration;
    node.videoDuration = asset.duration;
  }
  return node;
}

export function createCanvasAssetInsertion(get: () => Options, runtime: Runtime = defaults) {
  let disposed = false;
  const jobs = new Set<AbortController>(),
    importing = new Set<string>();
  const run = async (read: (signal: AbortSignal) => Promise<Asset>, library: boolean) => {
    const start = get(),
      epoch = start.getWorkflowEpoch(),
      bounds = start.canvasRef.current?.getBoundingClientRect();
    if (disposed || !start.enabled || !bounds) return;
    const point = {
      x: (bounds.width / 2 - start.viewport.x) / start.viewport.zoom - 170,
      y: (bounds.height / 2 - start.viewport.y) / start.viewport.zoom - 150,
    };
    const controller = new AbortController();
    jobs.add(controller);
    const current = () =>
      !disposed &&
      !controller.signal.aborted &&
      get().enabled &&
      get().getWorkflowEpoch() === epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(Error('素材导入已取消或等待超时。')),
          { once: true },
        );
        timer = setTimeout(() => controller.abort(), 30_000);
      });
      const asset = await Promise.race([read(controller.signal), cancelled]);
      if (!current()) return;
      if (!text(asset.url) || !['images', 'videos', 'audios'].includes(text(asset.type)))
        throw Error('导入资产返回无效');
      const metadata = await Promise.race([
        runtime.inspect(text(asset.url), text(asset.type)),
        cancelled,
      ]);
      if (!current()) return;
      const node = assetNode(asset, metadata, get().projectId, point, runtime.createId());
      get().setNodes((nodes) => (current() ? [...nodes, node] : nodes));
      if (!library) get().closeHistory();
      get().closeLibrary();
    } catch (error) {
      // A timeout in the current document is actionable; a closed document is silent.
      if (!disposed && get().enabled && get().getWorkflowEpoch() === epoch)
        runtime.report(error instanceof Error ? error.message : '导入资产失败，请稍后重试。');
    } finally {
      clearTimeout(timer);
      jobs.delete(controller);
    }
  };
  return {
    history(
      kind: string,
      url: string,
      prompt: string,
      model?: string,
      mode?: string,
      ratio?: string,
      resolution?: string,
      duration?: number,
    ) {
      return run(
        async () => ({
          type: kind,
          url,
          prompt,
          model,
          nodeType: kind === 'videos' ? 'Video' : kind === 'audios' ? 'Upload Audio' : 'Image',
          imageMode: mode,
          videoMode: mode,
          aspectRatio: ratio || (kind === 'audios' ? '4:1' : undefined),
          resolution,
          duration,
        }),
        false,
      );
    },
    async library(item: Asset) {
      const id = text(item.id);
      if (!id || importing.has(id)) return;
      importing.add(id);
      try {
        const projectId = get().projectId;
        await run(
          async (signal) => ({
            name: item.name,
            title: item.title,
            ...(await runtime.request(id, projectId, signal)),
          }),
          true,
        );
      } finally {
        importing.delete(id);
      }
    },
    dispose() {
      disposed = true;
      for (const job of jobs) job.abort();
      jobs.clear();
      importing.clear();
    },
  };
}

export function useCanvasAssetInsertion(
  hooks: Pick<typeof React, 'useRef' | 'useEffect'>,
  options: Options,
) {
  const live = hooks.useRef(options);
  live.current = options;
  const owner = hooks.useRef<ReturnType<typeof createCanvasAssetInsertion> | null>(null);
  const epoch = options.getWorkflowEpoch();
  hooks.useEffect(() => {
    const active = createCanvasAssetInsertion(() => live.current);
    owner.current = active;
    return () => {
      active.dispose();
      if (owner.current === active) owner.current = null;
    };
  }, [epoch, options.enabled]);
  return {
    selectHistoryAsset: (
      ...args: Parameters<ReturnType<typeof createCanvasAssetInsertion>['history']>
    ) => owner.current?.history(...args),
    importLibraryAsset: (asset: Asset) => owner.current?.library(asset),
  };
}
