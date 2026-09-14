export interface AgentReference {
  nodeId: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  base64?: string;
}

/** One bounded read owns its fetch, response body and FileReader until completion. */
export async function readAgentImage(
  input: Blob | string,
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<{ url: string; base64: string }> {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const controller = new AbortController();
  let reader: FileReader | undefined;
  let rejectAbort: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    controller.abort();
    reader?.abort();
    rejectAbort(new DOMException('图片读取已取消', 'AbortError'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    rejectAbort(new Error('图片读取超时，请重试。'));
    controller.abort();
    reader?.abort();
  }, 15_000);
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        let blob: Blob;
        if (typeof input === 'string') {
          const response = await fetcher(input, { signal: controller.signal });
          if (!response.ok) throw new Error('参考图片读取失败，请重新选择图片。');
          blob = await response.blob();
        } else blob = input;
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        if (!blob.size) throw new Error('图片为空，请重新选择图片。');
        return await new Promise<{ url: string; base64: string }>((resolve, reject) => {
          reader = new FileReader();
          reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
          reader.onabort = () => reject(new DOMException('已取消', 'AbortError'));
          reader.onload = () => {
            const url = String(reader?.result ?? '');
            const comma = url.indexOf(',');
            if (comma < 0) reject(new Error('图片读取失败，请重试。'));
            else resolve({ url, base64: url.slice(comma + 1) });
          };
          reader.readAsDataURL(blob);
        });
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    controller.abort();
    if (reader) {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    }
  }
}

export function mergeAgentReferences(
  selected: readonly { nodeId: string; url: string }[],
  manual: readonly AgentReference[],
  removed: ReadonlySet<string>,
): AgentReference[] {
  const references = new Map<string, AgentReference>();
  for (const reference of [...selected, ...manual]) {
    if (reference.nodeId && reference.url && !removed.has(reference.nodeId) && !references.has(reference.nodeId))
      references.set(reference.nodeId, { ...reference, type: 'image' });
  }
  return [...references.values()];
}
