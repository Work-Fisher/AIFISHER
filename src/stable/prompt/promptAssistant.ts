import { expandPromptTags } from './promptPresets';

export type DescribeImageInput = {
  projectId: string;
  imageUrl: string;
  prompt?: string;
};

type AssistantErrorBody = {
  error?: unknown;
  code?: unknown;
  retryable?: unknown;
};

export class PromptAssistantClientError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(message: string, code: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'PromptAssistantClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json() as T & AssistantErrorBody;
  if (!response.ok) {
    throw new PromptAssistantClientError(
      result.error ? String(result.error) : `提示词助手请求失败 (${response.status})`,
      result.code ? String(result.code) : 'PROMPT_ASSISTANT_FAILED',
      response.status,
      result.retryable === true,
    );
  }
  return result;
}

export function createPromptAssistantClient(fetcher: typeof fetch = globalThis.fetch) {
  return {
    async describeImage(input: DescribeImageInput): Promise<string> {
      const result = await fetcher('/api/prompt-assistant/describe-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then((response) => readJson<{ description: string }>(response));
      return result.description;
    },
    async optimizePrompt(prompt: string): Promise<string> {
      const expandedPrompt = expandPromptTags(String(prompt || '')).trim();
      if (!expandedPrompt) throw new Error('请输入需要优化的提示词');
      const result = await fetcher('/api/prompt-assistant/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: expandedPrompt }),
      }).then((response) => readJson<{ optimizedPrompt: string }>(response));
      return result.optimizedPrompt;
    },
  };
}

export type PromptAssistantClient = ReturnType<typeof createPromptAssistantClient>;

declare global {
  interface Window {
    __FISHERAI_PROMPT_ASSISTANT__?: PromptAssistantClient;
  }
}

export function installPromptAssistant(
  client = createPromptAssistantClient(),
): PromptAssistantClient {
  window.__FISHERAI_PROMPT_ASSISTANT__ = client;
  return client;
}
