export type SettingsRequestOptions = { signal?: AbortSignal };

/** Bounds both headers and body, including transports that ignore abort. Never replays writes. */
export async function requestSettingsJson<T>(
  fetcher: typeof fetch,
  url: string,
  label: string,
  options: SettingsRequestOptions = {},
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    const reason = options.signal?.reason ?? new DOMException('已取消', 'AbortError');
    rejectAbort(reason);
    controller.abort(reason);
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => {
    const reason = new Error(`${label.replace(/失败$/, '')}超时，请核对配置后重试。`);
    rejectAbort(reason);
    controller.abort(reason);
  }, timeoutMs);
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        const response = await fetcher(url, { ...init, signal: controller.signal });
        const body = await response.json();
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!response.ok)
          throw new Error(
            typeof body?.error === 'string' ? body.error : `${label} (${response.status})`,
          );
        return body as T;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

export const LEGACY_RUNNINGHUB_FIELDS = [
  ['RUNNINGHUB_BASE_URL', 'API Base URL'],
  ['RUNNINGHUB_IMAGE_WEBAPP_ID', 'Image WebApp ID'],
  ['RUNNINGHUB_IMAGE_WORKFLOW_ID', 'Image Workflow ID'],
  ['RUNNINGHUB_IMAGE_PROMPT_NODE_ID', 'Image Prompt Node ID'],
  ['RUNNINGHUB_IMAGE_INPUT_NODE_ID', 'Image Input Node ID'],
  ['RUNNINGHUB_VIDEO_WEBAPP_ID', 'Video WebApp ID'],
  ['RUNNINGHUB_VIDEO_WORKFLOW_ID', 'Video Workflow ID'],
  ['RUNNINGHUB_VIDEO_PROMPT_NODE_ID', 'Video Prompt Node ID'],
  ['RUNNINGHUB_VIDEO_INPUT_NODE_ID', 'Video Input Node ID'],
] as const;
