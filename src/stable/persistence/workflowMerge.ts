export type WorkflowRecord = Record<string, unknown>;

export class WorkflowConflictError extends Error {
  readonly code = 'REVISION_CONFLICT';
  constructor(readonly field: string) {
    super('另一窗口也修改了相同内容，当前编辑仍保留，但尚未保存。');
  }
}

function record(value: unknown): value is WorkflowRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sameWorkflowValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) => sameWorkflowValue(value, right[index]))
    );
  if (record(left) && record(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameWorkflowValue(left[key], right[key]))
    );
  }
  return false;
}

function byId(items: unknown[], path: string): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const item of items) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || result.has(item.id))
      throw new WorkflowConflictError(path);
    result.set(item.id, item);
  }
  return result;
}

function mergeItems(base: unknown[], local: unknown[], remote: unknown[], path: string): unknown[] {
  const b = byId(base, path),
    l = byId(local, path),
    r = byId(remote, path);
  const merged = new Map<string, unknown>();
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const value = mergeValue(b.get(id), l.get(id), r.get(id), `${path}.${id}`);
    if (value !== undefined) merged.set(id, value);
  }
  const common = [...b.keys()].filter((id) => l.has(id) && r.has(id));
  const commonIds = new Set(common);
  const localOrder = [...l.keys()].filter((id) => commonIds.has(id));
  const remoteOrder = [...r.keys()].filter((id) => commonIds.has(id));
  const localReordered = !sameWorkflowValue(common, localOrder);
  if (
    localReordered &&
    !sameWorkflowValue(common, remoteOrder) &&
    !sameWorkflowValue(localOrder, remoteOrder)
  )
    throw new WorkflowConflictError(`${path}.order`);
  const order = localReordered ? [...l.keys(), ...r.keys()] : [...r.keys(), ...l.keys()];
  return [...new Set(order)].filter((id) => merged.has(id)).map((id) => merged.get(id));
}

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string): unknown {
  if (sameWorkflowValue(local, base)) return remote;
  if (sameWorkflowValue(remote, base) || sameWorkflowValue(local, remote)) return local;
  if (
    (path === 'nodes' || path === 'groups') &&
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(remote)
  )
    return mergeItems(base, local, remote, path);
  if (record(base) && record(local) && record(remote)) {
    const entries = [
      ...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]),
    ]
      .map(
        (key) =>
          [
            key,
            mergeValue(base[key], local[key], remote[key], path ? `${path}.${key}` : key),
          ] as const,
      )
      .filter(([, value]) => value !== undefined);
    return Object.fromEntries(entries);
  }
  throw new WorkflowConflictError(path);
}

/** Merge against the document that was actually loaded, never just a newer revision number. */
export function mergeWorkflow(
  base: WorkflowRecord,
  local: WorkflowRecord,
  remote: WorkflowRecord,
): WorkflowRecord {
  const metadata = new Set([
    'id',
    'revision',
    'createdAt',
    'updatedAt',
    'lastSavedAt',
    'lastSavedBy',
    'coverUrl',
    'createBackup',
  ]);
  const withoutMetadata = (value: WorkflowRecord) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)));
  const merged = mergeValue(
    withoutMetadata(base),
    withoutMetadata(local),
    withoutMetadata(remote),
    '',
  ) as WorkflowRecord;
  return {
    ...Object.fromEntries(Object.entries(remote).filter(([key]) => metadata.has(key))),
    ...merged,
    id: remote.id,
    revision: remote.revision,
    lastSavedAt: local.lastSavedAt,
    lastSavedBy: local.lastSavedBy,
    coverUrl: local.coverUrl ?? remote.coverUrl,
    createBackup: local.createBackup,
  };
}
