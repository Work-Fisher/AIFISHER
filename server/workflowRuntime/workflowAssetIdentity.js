/** Asset IDs are unique within a project's media type, not across the library. */
export function workflowAssetKey(reference) {
  return JSON.stringify([
    String(reference?.projectId || ''),
    String(reference?.type || ''),
    String(reference?.assetId || ''),
  ]);
}
