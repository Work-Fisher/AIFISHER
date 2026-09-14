/** Persisted browser jobs cannot retain a revoked object URL or an endless spinner. */
export function interruptedMediaNode<T extends Record<string, unknown>>(node: T): T {
  if (!node.mediaOperationId && !node.uploadPending) return node;
  const retainedUrl =
    typeof node.resultUrl === 'string' && !node.resultUrl.startsWith('blob:')
      ? node.resultUrl
      : undefined;
  return {
    ...node,
    status: retainedUrl && node.status === 'success' ? 'success' : 'error',
    resultUrl: retainedUrl,
    uploadPending: undefined,
    mediaOperationId: undefined,
    errorMessage: '素材处理结果未确认，请检查素材库或重新选择文件。',
  };
}
