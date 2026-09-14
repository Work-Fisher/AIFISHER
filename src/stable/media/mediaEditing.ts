export type CompareConfig = {
  beforeUrl: string;
  afterUrl: string;
  position: number;
  angle: number;
};

export type MediaEditState = {
  annotation?: unknown;
  mask?: unknown;
  compare?: CompareConfig;
};

type CropRequest = {
  projectId: string;
  imageUrl: string;
  rect: { x: number; y: number; width: number; height: number };
};

type GridRequest = {
  projectId: string;
  imageUrl: string;
  columns: number;
  rows: number;
  columnGuides?: number[];
  rowGuides?: number[];
  horizontalGap?: number;
  verticalGap?: number;
};

type VideoFrameRequest = {
  projectId: string;
  videoUrl: string;
  times: number[];
  roles?: Array<'first' | 'last' | 'screenshot'>;
};

type VideoTrimRequest = {
  projectId: string;
  videoUrl: string;
  startTime: number;
  endTime: number;
};

type AudioTrimRequest = {
  projectId: string;
  audioUrl: string;
  startTime: number;
  endTime: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeCompareConfig(config: CompareConfig): CompareConfig {
  const finiteAngle = Number.isFinite(config.angle) ? config.angle : 0;
  return {
    beforeUrl: config.beforeUrl,
    afterUrl: config.afterUrl,
    position: clamp(config.position, 0, 1),
    angle: ((finiteAngle % 360) + 360) % 360,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const result = await response.json();
  if (!response.ok) {
    const message = typeof result === 'object' && result && 'error' in result
      ? String(result.error)
      : `媒体编辑请求失败 (${response.status})`;
    throw new Error(message);
  }
  return result;
}

export function createMediaEditingClient(fetcher: typeof fetch = globalThis.fetch) {
  const post = (url: string, body: unknown) => fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(readJson);

  return {
    cropImage: (request: CropRequest) => post('/api/media/images/crop', request),
    splitImageGrid: (request: GridRequest) => post('/api/media/images/grid', request),
    saveAnnotation: (request: {
      projectId: string;
      sourceUrl: string;
      dataUrl: string;
      mode?: 'draw' | 'mask' | 'erase';
      strokes?: unknown[];
    }) => post('/api/media/images/annotation', request),
    extractVideoFrames: (request: VideoFrameRequest) => post('/api/media/videos/frames', request),
    trimVideo: (request: VideoTrimRequest) => post('/api/trim-video', request),
    trimAudio: (request: AudioTrimRequest) => post('/api/trim-audio', request),
    saveEdit: (projectId: string, nodeId: string, state: MediaEditState) => fetcher(
      `/api/media/edits/${encodeURIComponent(projectId)}/${encodeURIComponent(nodeId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      },
    ).then(readJson),
    loadEdit: (projectId: string, nodeId: string) => fetcher(
      `/api/media/edits/${encodeURIComponent(projectId)}/${encodeURIComponent(nodeId)}`,
    ).then(readJson),
  };
}

export type MediaEditingClient = ReturnType<typeof createMediaEditingClient>;

declare global {
  interface Window {
    __FISHERAI_MEDIA_EDITING__?: MediaEditingClient;
  }
}

export function installMediaEditing(client = createMediaEditingClient()): MediaEditingClient {
  window.__FISHERAI_MEDIA_EDITING__ = client;
  return client;
}
