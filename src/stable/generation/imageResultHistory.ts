const MAX_IMAGE_RESULT_HISTORY = 20;

export type ImageResultHistoryNode = {
  resultUrl?: unknown;
  resultUrls?: unknown;
};

export type ImageResultHistoryUpdate = {
  resultUrl?: string;
  currentResultCount: number;
  resultUrls: string[];
};

export type ImageResultHistoryAdapter = {
  merge: (
    node: ImageResultHistoryNode,
    generatedUrls: readonly unknown[],
  ) => ImageResultHistoryUpdate;
};

function uniqueUrls(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }

  return urls;
}

export function mergeImageResultHistory(
  node: ImageResultHistoryNode,
  generatedUrls: readonly unknown[],
): ImageResultHistoryUpdate {
  const generated = uniqueUrls(generatedUrls);
  const previous = uniqueUrls([
    node.resultUrl,
    ...(Array.isArray(node.resultUrls) ? node.resultUrls : []),
  ]);
  const resultUrls = uniqueUrls([...generated, ...previous]).slice(0, MAX_IMAGE_RESULT_HISTORY);

  return {
    resultUrl: generated[0] || previous[0],
    currentResultCount: generated.length,
    resultUrls,
  };
}

declare global {
  interface Window {
    __FISHERAI_IMAGE_RESULT_HISTORY__?: ImageResultHistoryAdapter;
  }
}

export function installImageResultHistory(target: Window = window): ImageResultHistoryAdapter {
  if (target.__FISHERAI_IMAGE_RESULT_HISTORY__) {
    return target.__FISHERAI_IMAGE_RESULT_HISTORY__;
  }

  const adapter: ImageResultHistoryAdapter = {
    merge: mergeImageResultHistory,
  };
  target.__FISHERAI_IMAGE_RESULT_HISTORY__ = adapter;
  return adapter;
}
