import { loadCollageImage, renderImageCollage } from './imageCollage';
import { ASSET_CATEGORIES, assetCategory } from './assetOrganization';
import type * as React from 'react';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { CanvasViewport } from '../canvas/canvasNavigation';
import { interruptedMediaNode } from './mediaOperationRecovery';
import {
  inspectImage,
  inspectVideo,
  nearestAspectRatio,
  type MediaMetadata,
} from './generationMediaMetadata';
import {
  classifyMedia,
  uploadMediaFile,
  uploadMediaData,
  readMediaResponse,
  mediaResultUrl,
  type MediaKind,
} from './canvasMediaTransport';
export { uploadMediaFile, uploadMediaData } from './canvasMediaTransport';
export { inspectImage, nearestAspectRatio } from './generationMediaMetadata';
export const videoOrientation = (width: number, height: number) =>
  width / height >= 1 ? '16:9' : '9:16';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Hooks = Pick<typeof React, 'useRef' | 'useEffect' | 'useState' | 'useCallback' | 'useMemo'>;
interface MediaOptions {
  nodes: CanvasNode[];
  getNodes: () => CanvasNode[];
  projectId?: string;
  enabled: boolean;
  setNodes: Setter<CanvasNode[]>;
  setSelectedNodeIds?: Setter<string[]>;
  viewport?: CanvasViewport;
  contextMenu?: { x: number; y: number };
}
interface MediaBinding {
  getNodes: () => CanvasNode[];
  getProjectId: () => string | undefined;
  isActive: () => boolean;
  setNodes: Setter<CanvasNode[]>;
  select?: Setter<string[]>;
}
export interface MediaRuntime {
  createId: () => string;
  uploadFile: typeof uploadMediaFile;
  uploadData: typeof uploadMediaData;
  inspect: (url: string, kind: MediaKind) => Promise<MediaMetadata>;
  trimAudio: (
    request: { audioUrl: string; projectId: string; startTime: number; endTime: number },
    signal: AbortSignal,
  ) => Promise<string>;
  createPreview: (file: File) => string;
  revokePreview: (url: string) => void;
  report: (message: string) => void;
}
const runtime: MediaRuntime = {
  createId: () => crypto.randomUUID(),
  uploadFile: uploadMediaFile,
  uploadData: uploadMediaData,
  inspect: (url, kind) =>
    kind === 'image'
      ? inspectImage(url)
      : kind === 'video'
        ? inspectVideo(url, 5000, false)
        : Promise.resolve({}),
  trimAudio: async (request, signal) =>
    mediaResultUrl(
      await readMediaResponse(
        await fetch('/api/trim-audio', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }),
      ),
    ),
  createPreview: (file) => URL.createObjectURL(file),
  revokePreview: (url) => {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
  report: (message) => window.alert(message),
};
const nodeType = (kind: MediaKind) =>
  ({ image: 'Upload Image', video: 'Upload Video', audio: 'Upload Audio' })[kind];
const message = (error: unknown) => (error instanceof Error ? error.message : '素材处理失败');

/** A project owns its media jobs. Results only replace the placeholder of the same operation. */
export function createCanvasMedia(binding: MediaBinding, api: MediaRuntime = runtime) {
  const projectId = binding.getProjectId();
  let disposed = false;
  const active = () => !disposed && binding.isActive() && binding.getProjectId() === projectId;
  const jobs = new Map<string, { token: string; abort: AbortController; preview?: string }>();
  const start = (nodeId: string, preview?: string) => {
    const previous = jobs.get(nodeId);
    previous?.abort.abort();
    if (previous?.preview) api.revokePreview(previous.preview);
    const job = { token: api.createId(), abort: new AbortController(), preview };
    jobs.set(nodeId, job);
    return job;
  };
  const patch = (id: string, job: ReturnType<typeof start>, value: Partial<CanvasNode>) => {
    if (!active() || jobs.get(id) !== job) return false;
    let applied = false;
    binding.setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== id || node.mediaOperationId !== job.token) return node;
        applied = true;
        return { ...node, ...value };
      }),
    );
    return applied;
  };
  const finish = (id: string, job: ReturnType<typeof start>) => {
    if (jobs.get(id) !== job) return;
    jobs.delete(id);
    if (job.preview) api.revokePreview(job.preview);
  };
  const complete = async (
    node: CanvasNode,
    job: ReturnType<typeof start>,
    kind: MediaKind,
    request: () => Promise<string>,
    preserveOnFailure = false,
  ) => {
    try {
      // Attach the rejection handler immediately, before waiting for optional metadata.
      const url = await request();
      if (!active() || jobs.get(node.id) !== job) return false;
      const metadata = await api.inspect(job.preview || url, kind).catch(() => ({}));
      return patch(node.id, job, {
        ...metadata,
        status: 'success',
        resultUrl: url,
        uploadPending: undefined,
        mediaOperationId: undefined,
        errorMessage: undefined,
        ...(preserveOnFailure ? { title: node.title, prompt: node.prompt, networkUrl: null } : {}),
      });
    } catch (error) {
      const applied = patch(node.id, job, {
        status: preserveOnFailure ? node.status : 'error',
        resultUrl: preserveOnFailure ? node.resultUrl : undefined,
        uploadPending: undefined,
        mediaOperationId: undefined,
        errorMessage: message(error),
      });
      if (applied && preserveOnFailure) api.report(`替换失败：${message(error)}`);
      return false;
    } finally {
      finish(node.id, job);
    }
  };
  const insert = (node: CanvasNode, job: ReturnType<typeof start>) => {
    if (!active()) return false;
    binding.setNodes((nodes) => [...nodes, { ...node, mediaOperationId: job.token }]);
    return true;
  };
  return {
    async upload(
      files: ArrayLike<File> | null,
      point: { x: number; y: number },
      viewport: CanvasViewport,
    ) {
      if (!active() || !files) return;
      const position = {
        x: (point.x - viewport.x) / viewport.zoom,
        y: (point.y - viewport.y) / viewport.zoom,
      };
      for (const [index, file] of Array.from(files).entries()) {
        if (!active()) break;
        let kind: MediaKind;
        try {
          kind = classifyMedia(file);
        } catch (error) {
          api.report(message(error));
          continue;
        }
        const id = api.createId(),
          preview = api.createPreview(file),
          job = start(id, preview);
        const node: CanvasNode = {
          id,
          type: nodeType(kind),
          x: position.x + index * 40,
          y: position.y + index * 40,
          title: file.name,
          prompt: file.name,
          status: 'loading',
          resultUrl: preview,
          uploadPending: true,
          model: 'Upload',
          aspectRatio: kind === 'audio' ? '1:1' : '16:9',
          resolution: kind === 'video' ? '720p' : '1K',
        };
        if (insert(node, job)) binding.select?.([id]);
        await complete(node, job, kind, () =>
          api.uploadFile(file, projectId, id, job.abort.signal),
        );
      }
    },
    async replace(id: string, file: File) {
      if (!active()) return;
      const current = binding.getNodes().find((node) => node.id === id);
      if (!current) return;
      if (current.uploadPending || current.mediaOperationId) {
        api.report('素材仍在处理中，请完成后再替换。');
        return;
      }
      let kind: MediaKind;
      try {
        kind = classifyMedia(file);
      } catch (error) {
        api.report(message(error));
        return;
      }
      const job = start(id);
      binding.setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, mediaOperationId: job.token, uploadPending: true } : node,
        ),
      );
      await complete(
        { ...current, title: file.name, prompt: file.name },
        job,
        kind,
        () => api.uploadFile(file, projectId, id, job.abort.signal),
        true,
      );
    },
    async snapshot(sourceId: string, frames: { data: string; title: string; offset: number }[]) {
      if (!active()) return;
      const source = binding.getNodes().find((node) => node.id === sourceId);
      if (!source) return;
      const pending = frames.map((frame) => {
        const id = api.createId(),
          job = start(id);
        const node: CanvasNode = {
          id,
          type: 'Upload Image',
          x: source.x + 400,
          y: source.y + frame.offset,
          title: frame.title,
          prompt: frame.title,
          status: 'loading',
          parentIds: [sourceId],
          model: 'Snapshot',
          aspectRatio: source.aspectRatio || '16:9',
          resolution: source.resolution || '1080p',
        };
        insert(node, job);
        return { node, job, frame };
      });
      binding.select?.(pending.map(({ node }) => node.id));
      await Promise.all(
        pending.map(({ node, job, frame }) =>
          complete(node, job, 'image', () =>
            api.uploadData(frame.data, 'image', frame.title, projectId, job.abort.signal),
          ),
        ),
      );
    },
    async saveEditedImage(
      sourceId: string,
      data: string,
      title: string,
      getSourceWidth: (node: CanvasNode) => number,
      dimensions?: { width: number; height: number },
    ) {
      const original = binding.getNodes().find((node) => node.id === sourceId);
      if (!active() || !original) throw new Error('原图片已不在当前画布。');
      const key = `image-edit:${sourceId}:${title}`;
      if (jobs.has(key)) throw new Error('图片正在保存，请稍候。');
      const job = start(key);
      const current = () =>
        active() &&
        jobs.get(key) === job &&
        binding
          .getNodes()
          .some((node) => node.id === sourceId && node.resultUrl === original.resultUrl);
      try {
        const url = await api.uploadData(data, 'image', title, projectId, job.abort.signal);
        if (!current()) return false;
        const metadata: MediaMetadata =
          dimensions &&
          Number.isFinite(dimensions.width) &&
          Number.isFinite(dimensions.height) &&
          dimensions.width > 0 &&
          dimensions.height > 0
            ? {
                resultAspectRatio: `${dimensions.width}/${dimensions.height}`,
                aspectRatio: nearestAspectRatio(dimensions.width, dimensions.height),
              }
            : await api.inspect(url, 'image').catch(() => ({}));
        if (!current()) return false;
        const source = binding.getNodes().find((node) => node.id === sourceId)!;
        const result: CanvasNode = {
          id: api.createId(),
          type: 'Upload Image',
          x: source.x + getSourceWidth(source) + 100,
          y: source.y,
          title,
          prompt: title,
          status: 'success',
          model: 'Upload',
          resultUrl: url,
          aspectRatio: '16:9',
          ...metadata,
          parentIds: [sourceId],
          projectId,
        };
        binding.setNodes((nodes) => [...nodes, result]);
        binding.select?.([result.id]);
        return true;
      } finally {
        finish(key, job);
      }
    },
    async createCollage(
      ids: string[],
      getWidth: (node: CanvasNode) => number,
      getHeight: (node: CanvasNode) => number,
      imaging = { load: loadCollageImage, render: renderImageCollage },
    ) {
      if (!active()) return false;
      const selected = new Set(ids);
      const sources = binding
        .getNodes()
        .filter(
          (node) =>
            selected.has(node.id) &&
            ['Image', 'Upload Image'].includes(node.type) &&
            typeof node.resultUrl === 'string' &&
            node.resultUrl,
        );
      if (sources.length < 2) {
        api.report('请至少选择两张图片，再执行拼图。');
        return false;
      }
      const key = 'collage';
      if (jobs.has(key)) {
        api.report('拼图正在处理中，请稍候。');
        return false;
      }
      const job = start(key),
        current = () => {
          if (!active() || jobs.get(key) !== job) return false;
          const urls = new Map(binding.getNodes().map((node) => [node.id, node.resultUrl]));
          return sources.every((source) => urls.get(source.id) === source.resultUrl);
        };
      try {
        let decodedPixels = 0,
          next = 0;
        const load = async (node: CanvasNode) => {
          const image = await imaging.load(node.resultUrl as string, job.abort.signal);
          decodedPixels += image.naturalWidth * image.naturalHeight;
          if (decodedPixels > 64_000_000)
            throw new Error('所选图片总像素过大，请减少图片数量后重试。');
          return {
            image,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            centerX: node.x + getWidth(node) / 2,
            centerY: node.y + getHeight(node) / 2,
            visualHeight: getHeight(node),
          };
        };
        const items: Array<Awaited<ReturnType<typeof load>>> = Array(sources.length);
        await Promise.all(
          Array.from({ length: Math.min(4, sources.length) }, async () => {
            while (next < sources.length && current() && !job.abort.signal.aborted) {
              const index = next++;
              items[index] = await load(sources[index]);
            }
          }),
        );
        if (!current()) return false;
        const result = imaging.render(items);
        const url = await api.uploadData(result.data, 'image', '拼图', projectId, job.abort.signal);
        if (!current()) return false;
        const latest = sources.map((source) =>
          binding.getNodes().find((node) => node.id === source.id)!,
        );
        const node: CanvasNode = {
          id: api.createId(),
          type: 'Upload Image',
          x: Math.max(...latest.map((node) => node.x + getWidth(node))) + 140,
          y: Math.min(...latest.map((node) => node.y)),
          title: '拼图',
          prompt: '拼图',
          status: 'success',
          model: 'Upload',
          resultUrl: url,
          resultAspectRatio: `${result.width}/${result.height}`,
          aspectRatio: nearestAspectRatio(result.width, result.height),
          parentIds: sources.map((node) => node.id),
          projectId,
        };
        binding.setNodes((nodes) => [...nodes, node]);
        binding.select?.([node.id]);
        return true;
      } catch (error) {
        if (current()) api.report(`拼图生成失败：${message(error)}`);
        return false;
      } finally {
        job.abort.abort();
        finish(key, job);
      }
    },
    async saveCroppedImages(
      sourceId: string,
      outputs: Array<{ data: string; width: number; height: number; row: number; column: number }>,
      getWidth: (node: CanvasNode) => number,
      getHeight: (node: CanvasNode) => number,
      onProgress?: (count: number) => void,
    ) {
      const original = binding.getNodes().find((node) => node.id === sourceId);
      if (!active() || !original) throw new Error('原图片已不在当前画布。');
      if (
        !outputs.length ||
        outputs.length > 25 ||
        outputs.some(
          (output) =>
            ![output.width, output.height].every((value) => Number.isInteger(value) && value > 0) ||
            ![output.row, output.column].every(
              (value) => Number.isInteger(value) && value >= 0 && value < 5,
            ),
        )
      )
        throw new Error('裁切结果无效，请重新选择区域。');
      const key = 'crop:' + sourceId;
      if (jobs.has(key)) throw new Error('裁切图片正在保存，请稍候。');
      const job = start(key),
        current = () =>
          active() &&
          jobs.get(key) === job &&
          binding
            .getNodes()
            .some((node) => node.id === sourceId && node.resultUrl === original.resultUrl);
      try {
        const saved: Array<{ node: CanvasNode; row: number; column: number }> = [];
        for (const [index, output] of outputs.entries()) {
          if (!current()) return false;
          const title = outputs.length > 1 ? `裁切 ${index + 1}` : '裁切';
          const url = await api.uploadData(
            output.data,
            'image',
            title,
            projectId,
            job.abort.signal,
          );
          if (!current()) return false;
          saved.push({
            row: output.row,
            column: output.column,
            node: {
              id: api.createId(),
              type: 'Upload Image',
              x: 0,
              y: 0,
              title,
              prompt: title,
              status: 'success',
              model: 'Upload',
              resultUrl: url,
              resultAspectRatio: `${output.width}/${output.height}`,
              aspectRatio: nearestAspectRatio(output.width, output.height),
              parentIds: [sourceId],
              projectId,
            },
          });
          onProgress?.(saved.length);
        }
        if (!current()) return false;
        const source = binding.getNodes().find((node) => node.id === sourceId)!;
        const originX = source.x + getWidth(source) + 100;
        let y = source.y;
        for (const row of [...new Set(saved.map((item) => item.row))].sort((a, b) => a - b)) {
          const line = saved.filter((item) => item.row === row).sort((a, b) => a.column - b.column);
          let x = originX,
            maxHeight = 0;
          for (const item of line) {
            item.node.x = x;
            item.node.y = y;
            x += getWidth(item.node) + 40;
            maxHeight = Math.max(maxHeight, getHeight(item.node));
          }
          y += maxHeight + 40;
        }
        const nodes = saved.map((item) => item.node);
        binding.setNodes((latest) => [...latest, ...nodes]);
        binding.select?.(nodes.map((node) => node.id));
        return true;
      } finally {
        finish(key, job);
      }
    },
    async saveComposite(
      sourceId: string,
      data: string,
      layout: Record<string, unknown>,
      sourceWidth: number,
    ) {
      if (!active()) throw new Error('当前画布已关闭，未保存合成图片。');
      if (!binding.getNodes().some((node) => node.id === sourceId))
        throw new Error('原合成节点已删除。');
      const key = 'composite:' + sourceId;
      if (jobs.has(key)) throw new Error('合成图片正在保存，请稍候。');
      const job = start(key),
        id = api.createId();
      const current = () =>
        active() &&
        jobs.get(key) === job &&
        binding.getNodes().some((node) => node.id === sourceId);
      try {
        const url = await api.uploadData(data, 'image', '拼合', projectId, job.abort.signal);
        if (!current()) return false;
        const metadata = await api.inspect(url, 'image').catch(() => ({}));
        if (!current()) return false;
        let applied = false;
        binding.setNodes((nodes) => {
          const source = nodes.find((node) => node.id === sourceId);
          if (!source) return nodes;
          applied = true;
          return [
            ...nodes.map((node) =>
              node.id === sourceId ? { ...node, compositeLayout: layout } : node,
            ),
            {
              id,
              type: 'Upload Image',
              x: source.x + sourceWidth + 100,
              y: source.y,
              title: '拼合',
              prompt: '拼合',
              status: 'success',
              model: 'Upload',
              resultUrl: url,
              aspectRatio: '1:1',
              ...metadata,
              parentIds: [sourceId],
              projectId,
            },
          ];
        });
        if (applied) binding.select?.([id]);
        return applied;
      } finally {
        finish(key, job);
      }
    },
    async trimAudio(sourceId: string, startTime: number, endTime: number) {
      if (!active()) return false;
      const source = binding.getNodes().find((node) => node.id === sourceId);
      if (
        !source ||
        typeof source.resultUrl !== 'string' ||
        !source.resultUrl ||
        source.uploadPending ||
        /^(blob|data):/i.test(source.resultUrl) ||
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        startTime < 0 ||
        endTime <= startTime
      )
        return false;
      const id = api.createId(),
        job = start(id);
      const node: CanvasNode = {
        id,
        type: 'Upload Audio',
        x: source.x + Math.max(365, Number(source.width) || 0) + 100,
        y: source.y,
        title: '裁切音频',
        prompt: `裁切音频 (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`,
        status: 'loading',
        parentIds: [sourceId],
        model: 'AudioTrim',
        aspectRatio: '16:9',
        resolution: '1080p',
      };
      insert(node, job);
      const timer = setTimeout(
        () => job.abort.abort(new DOMException('裁切请求超时，请重试', 'TimeoutError')),
        90_000,
      );
      try {
        const completed = await complete(node, job, 'audio', () =>
          api.trimAudio(
            {
              audioUrl: source.resultUrl as string,
              projectId: projectId || 'default',
              startTime,
              endTime,
            },
            job.abort.signal,
          ),
        );
        if (completed && active()) binding.select?.([id]);
        return completed;
      } finally {
        clearTimeout(timer);
      }
    },
    async importAsset(
      kind: MediaKind,
      url: string,
      prompt: string,
      viewport: CanvasViewport,
      generated: boolean,
      done: () => void,
    ) {
      if (!active()) return;
      const metadata = await api.inspect(url, kind).catch(() => ({}) as MediaMetadata);
      if (!active()) return;
      const node: CanvasNode = {
        id: api.createId(),
        type:
          generated && kind !== 'audio' ? (kind === 'video' ? 'Video' : 'Image') : nodeType(kind),
        x: (window.innerWidth / 2 - viewport.x) / viewport.zoom - 170,
        y: (window.innerHeight / 2 - viewport.y) / viewport.zoom - 150,
        prompt,
        ...(!generated ? { title: prompt } : {}),
        status: 'success',
        resultUrl: url,
        model: 'Upload',
        aspectRatio: kind === 'audio' ? (generated ? '4:1' : '1:1') : '16:9',
        resolution: kind === 'video' ? '720p' : '1K',
        projectId,
        ...metadata,
      };
      binding.setNodes((nodes) => [...nodes, node]);
      done();
    },
    dispose() {
      // Cleanup may run after leaving the canvas. It may end this document's
      // placeholders, but never touch a different document loaded into the store.
      if (binding.getProjectId() === projectId) {
        binding.setNodes((nodes) =>
          nodes.map((node) =>
            jobs.get(node.id)?.token === node.mediaOperationId && jobs.has(node.id)
              ? interruptedMediaNode(node)
              : node,
          ),
        );
      }
      disposed = true;
      for (const job of jobs.values()) {
        job.abort.abort();
        if (job.preview) api.revokePreview(job.preview);
      }
      jobs.clear();
    },
  };
}

function useMediaOwner<T extends MediaOptions>(hooks: Hooks, options: T) {
  const live = hooks.useRef(options);
  live.current = options;
  const owner = hooks.useRef<ReturnType<typeof createCanvasMedia> | null>(null);
  hooks.useEffect(() => {
    if (!options.enabled) return;
    const current = createCanvasMedia({
      getNodes: () => live.current.getNodes(),
      getProjectId: () => live.current.projectId,
      isActive: () => live.current.enabled,
      setNodes: (value) => live.current.setNodes(value),
      select: (value) => live.current.setSelectedNodeIds?.(value),
    });
    owner.current = current;
    return () => {
      current.dispose();
      if (owner.current === current) owner.current = null;
    };
  }, [options.enabled, options.projectId]);
  return { owner, live };
}
export function useCanvasSnapshots(hooks: Hooks, options: MediaOptions) {
  const { owner } = useMediaOwner(hooks, options);
  return {
    handleVideoSnapshot: (id: string, data: string) =>
      owner.current?.snapshot(id, [{ data, title: '视频截图', offset: 0 }]),
    handleVideoFirstLastSnapshot: (id: string, first: string, last: string) =>
      owner.current?.snapshot(id, [
        { data: first, title: '视频首帧', offset: -150 },
        { data: last, title: '视频尾帧', offset: 150 },
      ]),
  };
}
export function useCanvasAudioTrim(hooks: Hooks, options: MediaOptions) {
  const { owner } = useMediaOwner(hooks, options);
  return {
    handleAudioTrim: (id: string, start: number, end: number) =>
      owner.current?.trimAudio(id, start, end),
  };
}

const assetCategories = ASSET_CATEGORIES;
export function useCanvasAssets(hooks: Hooks, options: MediaOptions) {
  const { owner, live } = useMediaOwner(hooks, options);
  const [isOpen, setOpen] = hooks.useState(false);
  const [snapshot, setSnapshot] = hooks.useState<CanvasNode | null>(null);
  const [categories, setCategories] = hooks.useState(assetCategories);
  const dialogEpochRef = hooks.useRef(0);
  hooks.useEffect(() => {
    dialogEpochRef.current++;
    setOpen(false);
    setSnapshot(null);
    return () => {
      dialogEpochRef.current++;
    };
  }, [options.projectId, options.enabled]);
  const viewport = () => live.current.viewport ?? { x: 0, y: 0, zoom: 1 };
  const handleOpenCreateAsset = (id: string) => {
    const node = live.current.getNodes().find((item) => item.id === id);
    if (
      !live.current.enabled ||
      !node ||
      !['Image', 'Video', 'Audio', 'Upload Image', 'Upload Video', 'Upload Audio'].includes(
        node.type,
      ) ||
      node.uploadPending
    )
      return;
    setSnapshot({ ...node });
    setOpen(true);
    const epoch = ++dialogEpochRef.current;
    void fetch('/api/library')
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json();
        if (epoch !== dialogEpochRef.current) return;
        const extra = Array.isArray(result)
          ? result.map((item) => assetCategory(String(item.category || '')))
          : [];
        setCategories([...new Set([...assetCategories, ...extra])]);
      })
      .catch(() => {
        /* The default categories remain usable offline. */
      });
  };
  const handleSaveAssetToLibrary = async (name: string, category: string, ownership = '') => {
    if (!snapshot?.resultUrl || snapshot.uploadPending || !live.current.enabled) return;
    const meta = Object.fromEntries(
      [
        'title',
        'prompt',
        'model',
        'imageModel',
        'videoModel',
        'audioModel',
        'textModel',
        'imageMode',
        'videoMode',
        'audioMode',
        'aspectRatio',
        'resultAspectRatio',
        'resolution',
      ].map((key) => [key, snapshot[key] || (key === 'title' || key === 'prompt' ? name : '')]),
    );
    const duration = Number(snapshot.videoDuration ?? snapshot.duration);
    await readMediaResponse(
      await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: snapshot.resultUrl,
          name,
          category,
          ownership,
          meta: {
            ...meta,
            nodeType: snapshot.type,
            sourceType: snapshot.type.startsWith('Upload') ? 'upload' : 'generated',
            duration: Number.isFinite(duration) ? duration : null,
          },
        }),
      }),
    );
  };
  return {
    isCreateAssetModalOpen: isOpen,
    setIsCreateAssetModalOpen: (value: React.SetStateAction<boolean>) => {
      dialogEpochRef.current++;
      setOpen(value);
    },
    nodeToSnapshot: snapshot,
    assetCategories: categories,
    handleOpenCreateAsset,
    handleSaveAssetToLibrary,
    handleSelectAsset: (
      category: string,
      url: string,
      prompt: string,
      first: () => void,
      second: () => void,
    ) =>
      owner.current?.importAsset(
        category === 'videos' ? 'video' : category === 'audios' ? 'audio' : 'image',
        url,
        prompt,
        viewport(),
        true,
        () => {
          first();
          second();
        },
      ),
    handleLibrarySelect: (url: string, kind: MediaKind, first: () => void, second: () => void) =>
      owner.current?.importAsset(kind, url, 'Asset Library Item', viewport(), false, () => {
        first();
        second();
      }),
    handleContextUpload: (files: ArrayLike<File>) =>
      owner.current?.upload(files, live.current.contextMenu ?? { x: 0, y: 0 }, viewport()),
    handleClipboardImagePaste: (files: ArrayLike<File>, point: { x: number; y: number }) =>
      owner.current?.upload(files, point, viewport()),
    handleReplaceMedia: (id: string, file: File) => owner.current?.replace(id, file),
  };
}

export function useCanvasCompositeSave(
  hooks: Hooks,
  options: MediaOptions & { getNodeWidth(node: CanvasNode): number },
) {
  const { owner, live } = useMediaOwner(hooks, options);
  const scope = hooks.useMemo(() => ({}), [options.projectId, options.enabled]);
  const scopeRef = hooks.useRef<object | null>(null);
  hooks.useEffect(() => {
    scopeRef.current = scope;
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [scope]);
  const projectId = options.projectId;
  return async (id: string, data: string, layout: Record<string, unknown>) => {
    if (
      scopeRef.current !== scope ||
      !options.enabled ||
      !live.current.enabled ||
      live.current.projectId !== projectId
    )
      throw new Error('原画布会话已结束，合成图片未保存。');
    const source = live.current.getNodes().find((node) => node.id === id),
      current = owner.current;
    if (!source || !current) throw new Error('合成节点已不在当前画布。');
    const saved = await current.saveComposite(id, data, layout, options.getNodeWidth(source));
    if (!saved) throw new Error('画布或合成内容已变化，本次结果未写回。');
  };
}

/** Captures the initiating project lifetime; closing the editor is owned by its save promise. */
export function useCanvasImageEditSave(
  hooks: Hooks,
  options: MediaOptions & { title: string; getNodeWidth(node: CanvasNode): number },
) {
  const { owner, live } = useMediaOwner(hooks, options);
  const scope = hooks.useMemo(() => ({}), [options.projectId, options.enabled]);
  const scopeRef = hooks.useRef<object | null>(null);
  hooks.useEffect(() => {
    scopeRef.current = scope;
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [scope]);
  const projectId = options.projectId;
  return async (id: string, data: string, dimensions?: { width: number; height: number }) => {
    if (
      scopeRef.current !== scope ||
      !options.enabled ||
      !live.current.enabled ||
      live.current.projectId !== projectId
    )
      throw new Error('原画布会话已结束，图片未保存。');
    const current = owner.current;
    if (!current) throw new Error('当前画布尚未就绪。');
    const saved = await current.saveEditedImage(
      id,
      data,
      options.title,
      options.getNodeWidth,
      dimensions,
    );
    if (!saved) throw new Error('画布或原图片已变化，本次结果未写回。');
  };
}

/** A grid is one canvas edit; no partial node insertion occurs before all local uploads finish. */
export function useCanvasCropSave(
  hooks: Hooks,
  options: MediaOptions & {
    getNodeWidth(node: CanvasNode): number;
    getNodeHeight(node: CanvasNode): number;
  },
) {
  const { owner, live } = useMediaOwner(hooks, options);
  const scope = hooks.useMemo(() => ({}), [options.projectId, options.enabled]),
    scopeRef = hooks.useRef<object | null>(null);
  hooks.useEffect(() => {
    scopeRef.current = scope;
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [scope]);
  const projectId = options.projectId;
  return async (
    id: string,
    outputs: Parameters<ReturnType<typeof createCanvasMedia>['saveCroppedImages']>[1],
    onProgress?: (count: number) => void,
  ) => {
    if (
      scopeRef.current !== scope ||
      !options.enabled ||
      !live.current.enabled ||
      live.current.projectId !== projectId
    )
      throw new Error('原画布会话已结束，裁切图片未保存。');
    if (!owner.current) throw new Error('当前画布尚未就绪。');
    const saved = await owner.current.saveCroppedImages(
      id,
      outputs,
      options.getNodeWidth,
      options.getNodeHeight,
      onProgress,
    );
    if (!saved) throw new Error('画布或原图片已变化，本次结果未写回。');
  };
}

export function useCanvasCollage(
  hooks: Hooks,
  options: MediaOptions & {
    selectedNodeIds: string[];
    getNodeWidth(node: CanvasNode): number;
    getNodeHeight(node: CanvasNode): number;
  },
) {
  const { owner, live } = useMediaOwner(hooks, options);
  return () => {
    const current = live.current;
    return owner.current?.createCollage(
      current.selectedNodeIds,
      current.getNodeWidth,
      current.getNodeHeight,
    );
  };
}
