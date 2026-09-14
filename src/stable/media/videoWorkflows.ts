export type VideoWorkflowType = 'minimax-h3-t2va';

export type MiniMaxH3Mode = 't2va' | 'i2va' | 'fl2va' | 'l2va' | 'ref2va';

export type VideoWorkflowRequest = {
  projectId: string;
  nodeId?: string;
  text: string;
  mode: MiniMaxH3Mode;
  imageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  aspectRatio: string;
  megapixels: number;
  duration: number;
  seed?: number;
};

export type VideoCapability = {
  workflowType: VideoWorkflowType;
  title: string;
  category: 'minimax-h3';
  outputType: 'videos';
  requiredInputs: string[];
};

export type VideoWorkflowResult = {
  success: true;
  url: string;
  asset?: Record<string, unknown>;
};

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(result?.error ? String(result.error) : `本地视频工作流失败 (${response.status})`);
  }
  return result;
}

export function createVideoWorkflowClient(fetcher: typeof fetch = globalThis.fetch) {
  return {
    async getCapabilities(): Promise<VideoCapability[]> {
      const result = await fetcher('/api/comfy/capabilities?outputType=videos').then(
        (response) => readJson<{ capabilities: VideoCapability[] }>(response),
      );
      return result.capabilities;
    },
    run(
      workflowType: VideoWorkflowType,
      request: VideoWorkflowRequest,
    ): Promise<VideoWorkflowResult> {
      return fetcher(`/api/comfy/${encodeURIComponent(workflowType)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }).then((response) => readJson<VideoWorkflowResult>(response));
    },
  };
}

export type VideoWorkflowClient = ReturnType<typeof createVideoWorkflowClient>;

declare global {
  interface Window {
    __FISHERAI_VIDEO_WORKFLOWS__?: VideoWorkflowClient;
  }
}

export function installVideoWorkflows(
  client = createVideoWorkflowClient(),
): VideoWorkflowClient {
  window.__FISHERAI_VIDEO_WORKFLOWS__ = client;
  return client;
}
