export type StoryboardCharacter = {
  name: string;
  description?: string;
};

export type StoryboardReference = {
  name: string;
  category?: 'Character' | 'Scene' | 'Item' | 'Style' | 'Other';
  url: string;
};

export type StoryboardScene = {
  sceneNumber: number;
  description: string;
  cameraAngle: string;
  cameraMovement: string;
  lighting: string;
  mood: string;
};

type ProjectRequest = {
  projectId: string;
};

export type BrainstormRequest = ProjectRequest & {
  genre?: string;
  characterDescriptions?: StoryboardCharacter[];
  referenceImages?: StoryboardReference[];
};

export type OptimizeStoryRequest = ProjectRequest & {
  story: string;
  characterNames?: string[];
};

export type GenerateScriptsRequest = ProjectRequest & {
  story: string;
  sceneCount: number;
  characterDescriptions?: StoryboardCharacter[];
  referenceImages?: StoryboardReference[];
};

export type GenerateCompositeRequest = ProjectRequest & {
  scripts: StoryboardScene[];
  styleAnchor?: string;
  characterDNA?: Record<string, string>;
  referenceImages?: StoryboardReference[];
};

export type GenerateScriptsResult = {
  scripts: StoryboardScene[];
  styleAnchor: string;
  characterDNA: Record<string, string>;
};

type ErrorBody = {
  error?: unknown;
  code?: unknown;
  retryable?: unknown;
};

export class StoryboardClientError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(message: string, code: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'StoryboardClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & ErrorBody;
  if (!response.ok) {
    throw new StoryboardClientError(
      body.error ? String(body.error) : `故事板请求失败 (${response.status})`,
      body.code ? String(body.code) : 'STORYBOARD_REQUEST_FAILED',
      response.status,
      body.retryable === true,
    );
  }
  return body;
}

function postJson<T>(fetcher: typeof fetch, url: string, body: unknown): Promise<T> {
  return fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => readJson<T>(response));
}

export function createStoryboardClient(fetcher: typeof fetch = globalThis.fetch) {
  return {
    brainstorm(input: BrainstormRequest) {
      return postJson<{ story: string }>(
        fetcher,
        '/api/storyboard/brainstorm-story',
        input,
      );
    },

    optimize(input: OptimizeStoryRequest) {
      return postJson<{ optimizedStory: string }>(
        fetcher,
        '/api/storyboard/optimize-story',
        input,
      );
    },

    generateScripts(input: GenerateScriptsRequest) {
      return postJson<GenerateScriptsResult>(
        fetcher,
        '/api/storyboard/generate-scripts',
        input,
      );
    },

    generateComposite(input: GenerateCompositeRequest) {
      return postJson<{ imageUrl: string; layout: string }>(
        fetcher,
        '/api/storyboard/generate-composite',
        input,
      );
    },
  };
}

export type StoryboardClient = ReturnType<typeof createStoryboardClient>;

declare global {
  interface Window {
    __FISHERAI_STORYBOARD__?: StoryboardClient;
  }
}

export function installStoryboardClient(
  client = createStoryboardClient(),
): StoryboardClient {
  window.__FISHERAI_STORYBOARD__ = client;
  return client;
}
