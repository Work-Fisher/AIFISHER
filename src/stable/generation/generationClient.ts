type Result = Record<string, unknown>;
async function responseBody(response: Response): Promise<Result> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Result) : {};
}
async function submit(
  kind: 'image' | 'video' | 'audio' | 'text',
  request: Record<string, unknown>,
): Promise<Result> {
  const response = await window.fetch(`/api/generate-${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      window.__FISHERAI_GENERATION_SCHEDULER__?.decorateRequest(request) ?? request,
    ),
  });
  const result = await responseBody(response);
  if (!response.ok)
    throw Object.assign(
      new Error(typeof result.error === 'string' ? result.error : '生成请求未能完成。'),
      {
        code:
          typeof result.code === 'string'
            ? result.code
            : response.status >= 500
              ? 'GENERATION_OBSERVATION_INTERRUPTED'
              : 'GENERATION_FAILED',
        status: response.status,
      },
    );
  return result;
}
const unconfirmed = () =>
  Object.assign(new Error('结果尚未确认，正在核对原任务。'), {
    code: 'GENERATION_OBSERVATION_INTERRUPTED',
  });
/** A response is observed once. Neither transport loss nor malformed JSON replays a submission. */
async function generateMedia(
  kind: 'image' | 'video' | 'audio',
  request: Record<string, unknown>,
): Promise<string | string[]> {
  const result = await submit(kind, request);
  const urls = Array.isArray(result.resultUrls)
    ? result.resultUrls.filter(
        (url): url is string => typeof url === 'string' && Boolean(url.trim()),
      )
    : [];
  if (urls.length) return urls;
  if (typeof result.resultUrl === 'string' && result.resultUrl.trim()) return result.resultUrl;
  throw unconfirmed();
}
export const generateImage = (request: Record<string, unknown>) => generateMedia('image', request);
export const generateVideo = (request: Record<string, unknown>) => generateMedia('video', request);
export const generateAudio = (request: Record<string, unknown>) => generateMedia('audio', request);
export async function generateText(
  request: Record<string, unknown>,
): Promise<Result & { text: string }> {
  const result = await submit('text', request);
  if (typeof result.text !== 'string' || !result.text) throw unconfirmed();
  return { ...result, text: result.text };
}
export async function getGenerationConcurrency(
  modelName: string,
  mode: string,
  signal?: AbortSignal,
): Promise<{ blocked: boolean; modelId?: string; inFlight: number; maxConcurrent: number }> {
  const query = new URLSearchParams({ modelName, mode });
  const response = await window.fetch(
    `/api/generation-concurrency?${query}`,
    ...(signal ? [{ signal }] : []),
  );
  const result = await responseBody(response);
  if (!response.ok || typeof result.blocked !== 'boolean')
    throw new Error(typeof result.error === 'string' ? result.error : '并发状态查询失败');
  return {
    blocked: result.blocked,
    modelId: typeof result.modelId === 'string' ? result.modelId : undefined,
    inFlight: Number(result.inFlight) || 0,
    maxConcurrent: Number(result.maxConcurrent) || 0,
  };
}
