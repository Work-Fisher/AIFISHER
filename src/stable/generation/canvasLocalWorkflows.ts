import type * as React from 'react';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import { buildMiniMaxH3Request } from '../media/minimaxH3';
import {
  createVideoWorkflowClient,
  type VideoWorkflowClient,
  type VideoWorkflowRequest,
} from '../media/videoWorkflows';

const interruptedMessage =
  '本地工作流结果未确认，请先检查 ComfyUI 任务和素材库；不会自动重新生成。';
export function interruptedLocalWorkflowNode<T extends Record<string, unknown>>(node: T): T {
  if (!node.localWorkflowOperationId) return node;
  return {
    ...node,
    localWorkflowOperationId: undefined,
    status: 'error',
    errorMessage: interruptedMessage,
  };
}
interface Binding {
  getNodes(): CanvasNode[];
  getProjectId(): string | undefined;
  isActive(): boolean;
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  setSelectedNodeIds(ids: string[]): void;
}
interface Runtime {
  createId(): string;
  run(request: VideoWorkflowRequest): ReturnType<VideoWorkflowClient['run']>;
}
const retiredHandlers = [
  'handleChangeAngleGenerate',
  'handleUpscaleGenerate',
  'handleQwenInpaintGenerate',
  'handleQwenOutpaintGenerate',
  'handleQwenPoseGenerate',
  'handleZImageTurboT2IGenerate',
  'handleKleinT2IGenerate',
  'handleKleinI2IGenerate',
  'handleKleinM2IGenerate',
  'handleKleinIS2IGenerate',
  'handleAuxPreprocessorGenerate',
  'handleKleinOutpaintGenerate',
  'handleVoxCPM2CloneGenerate',
  'handleVoxCPM2VoiceDesignGenerate',
  'handleIndexTTS2VectorEmoCloneGenerate',
  'handleIndexTTS2VectorMultiEmoCloneGenerate',
  'handleIndexTTS2AudioEmoCloneGenerate',
  'handleIndexTTS2AudioMultiEmoCloneGenerate',
  'handleQwen3TTSGenerate',
  'handleQwen3CloneGenerate',
  'handleQwen3VoiceDesignGenerate',
  'handleSam3InteractiveGenerate',
  'handleSam3TextGenerate',
  'handleSam3PointGenerate',
] as const;

/** Only MiniMax remains a dedicated local workflow; imported workflows own their own runs. */
export function createCanvasLocalWorkflows(binding: Binding, runtime: Runtime) {
  const projectId = binding.getProjectId();
  const pending = new Map<string, string>();
  let disposed = false;
  const active = () => !disposed && binding.isActive() && binding.getProjectId() === projectId;
  const retired = (id: string) => {
    if (!active()) return;
    binding.setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              status: 'error',
              errorMessage: '此内置工作流已停用。请从本地工作流导入对应 ComfyUI API JSON 后运行。',
            }
          : node,
      ),
    );
  };
  return {
    ...(Object.fromEntries(retiredHandlers.map((name) => [name, retired])) as Record<
      (typeof retiredHandlers)[number],
      (id: string) => void
    >),
    async handleMiniMaxH3T2VAGenerate(id: string) {
      if (!active() || pending.has(id)) return;
      const source = binding.getNodes().find((node) => node.id === id);
      if (!source || source.comfyMode !== 'minimax-h3-t2va' || source.localWorkflowOperationId)
        return;
      let request: VideoWorkflowRequest;
      try {
        if (!projectId) throw new Error('请先保存当前项目，再运行本地工作流。');
        request = buildMiniMaxH3Request(binding.getNodes(), source, projectId);
      } catch (error) {
        binding.setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  status: 'error',
                  errorMessage: error instanceof Error ? error.message : 'MiniMax H3 输入无效',
                }
              : node,
          ),
        );
        return;
      }
      const token = runtime.createId(),
        outputId = runtime.createId();
      pending.set(id, token);
      const output: CanvasNode = {
        id: outputId,
        projectId,
        type: 'Upload Video',
        x: source.x + 1020,
        y: source.y,
        prompt: request.text,
        status: 'loading',
        progress: 10,
        parentIds: [id],
        model: 'MiniMax H3',
        aspectRatio: request.aspectRatio,
        resolution: `${request.megapixels} MP`,
        duration: request.duration,
        videoDuration: request.duration,
        localWorkflowOperationId: token,
      };
      binding.setNodes((nodes) => [
        ...nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                status: 'loading',
                localWorkflowOperationId: token,
                errorMessage: undefined,
              }
            : node,
        ),
        output,
      ]);
      binding.setSelectedNodeIds([outputId]);
      const publish = (patch: Partial<CanvasNode>, sourcePatch: Partial<CanvasNode>) => {
        if (!active() || pending.get(id) !== token) return;
        binding.setNodes((nodes) =>
          nodes.map((node) => {
            if (node.localWorkflowOperationId !== token) return node;
            if (node.id === outputId)
              return { ...node, ...patch, localWorkflowOperationId: undefined };
            if (node.id === id)
              return { ...node, ...sourcePatch, localWorkflowOperationId: undefined };
            return node;
          }),
        );
      };
      try {
        const result = await runtime.run(request);
        if (!result.success || typeof result.url !== 'string' || !result.url)
          throw new TypeError(interruptedMessage);
        publish(
          {
            status: 'success',
            resultUrl: result.url,
            progress: 100,
            networkUrl: null,
            errorMessage: undefined,
          },
          { status: 'idle', errorMessage: undefined },
        );
      } catch (error) {
        const message =
          error instanceof TypeError ||
          error instanceof SyntaxError ||
          (error instanceof Error && error.name === 'AbortError')
            ? interruptedMessage
            : error instanceof Error
              ? error.message
              : interruptedMessage;
        publish(
          { status: 'error', errorMessage: message },
          { status: 'error', errorMessage: message },
        );
      } finally {
        if (pending.get(id) === token) pending.delete(id);
      }
    },
    dispose() {
      if (!disposed && binding.getProjectId() === projectId) {
        const tokens = new Set(pending.values());
        binding.setNodes((nodes) =>
          nodes.map((node) =>
            tokens.has(String(node.localWorkflowOperationId))
              ? interruptedLocalWorkflowNode(node)
              : node,
          ),
        );
      }
      disposed = true;
      pending.clear();
    },
  };
}

interface Options {
  getNodes(): CanvasNode[];
  setNodes: Binding['setNodes'];
  setSelectedNodeIds: Binding['setSelectedNodeIds'];
  projectId?: string;
  enabled: boolean;
}
export function useCanvasLocalWorkflows(
  hooks: Pick<typeof React, 'useRef' | 'useEffect'>,
  options: Options,
  createId: () => string,
) {
  const live = hooks.useRef(options);
  live.current = options;
  const owner = hooks.useRef<ReturnType<typeof createCanvasLocalWorkflows> | null>(null);
  hooks.useEffect(() => {
    if (!options.enabled) return;
    const controller = createCanvasLocalWorkflows(
      {
        getNodes: () => live.current.getNodes(),
        getProjectId: () => live.current.projectId,
        isActive: () => live.current.enabled,
        setNodes: (update) => live.current.setNodes(update),
        setSelectedNodeIds: (ids) => live.current.setSelectedNodeIds(ids),
      },
      {
        createId,
        run: (request) =>
          (window.__FISHERAI_VIDEO_WORKFLOWS__ ?? createVideoWorkflowClient()).run(
            'minimax-h3-t2va',
            request,
          ),
      },
    );
    owner.current = controller;
    return () => {
      controller.dispose();
      if (owner.current === controller) owner.current = null;
    };
  }, [options.enabled, options.projectId, createId]);
  return {
    ...Object.fromEntries(
      retiredHandlers.map((name) => [name, (id: string) => owner.current?.[name]?.(id)]),
    ),
    handleMiniMaxH3T2VAGenerate: (id: string) => owner.current?.handleMiniMaxH3T2VAGenerate(id),
  };
}
