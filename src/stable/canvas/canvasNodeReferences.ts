/** Known graph references share one remapping path across copying and importing. */
export function remapCanvasNodeReferences(
  node: Record<string, unknown>,
  resolve: (id: string) => string | undefined,
): Record<string, unknown> {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const value = (id: unknown) => typeof id === 'string' && id ? resolve(id) : undefined;
  const patch: Record<string, unknown> = {};
  for (const key of ['midjourneyReferenceNodeIds', 'comfyInputs']) {
    if (node[key] !== undefined) patch[key] = Object.fromEntries(
      Object.entries(record(node[key])).flatMap(([role, id]) => {
        const mapped = value(id);
        return mapped ? [[role, mapped]] : [];
      }),
    );
  }
  for (const key of ['linkedVideoNodeId', 'sourceWorkflowNodeId'])
    if (node[key] !== undefined) patch[key] = value(node[key]);
  if (Array.isArray(node.frameInputs)) patch.frameInputs = node.frameInputs.flatMap(input => {
    const frame = record(input), mapped = value(frame.nodeId);
    return mapped ? [{ ...frame, nodeId: mapped }] : [];
  });
  if (node.comfyOutputs !== undefined) patch.comfyOutputs = Object.fromEntries(
    Object.entries(record(node.comfyOutputs)).map(([key, ids]) => [key, Array.isArray(ids) ? ids.map(value).filter(Boolean) : []]),
  );
  if (node.compositeLayout !== undefined) patch.compositeLayout = Object.fromEntries(
    Object.entries(record(node.compositeLayout)).flatMap(([id, layout]) => {
      const mapped = value(id);
      return mapped ? [[mapped, structuredClone(layout)]] : [];
    }),
  );
  return patch;
}
