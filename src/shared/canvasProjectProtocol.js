const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const identifier = value => text(value) && !/[\\/\0]/.test(value) && value !== '.' && value !== '..';
const nullableId = value => value === null || identifier(value);
export function validProjectControl(value) {
  if (value.action === 'projects') return exact(value, ['action', 'query', 'offset'])
    && (value.query === undefined || typeof value.query === 'string' && value.query.length <= 200)
    && (value.offset === undefined || Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= 100000);
  if (value.action !== 'project') return null;
  if (!text(value.revision, 128)) return false;
  const base = ['action', 'revision', 'operation'];
  switch (value.operation) {
    case 'save': case 'import': return exact(value, base);
    case 'create': return exact(value, [...base, 'title', 'folderId']) && text(value.title, 500) && (value.folderId === undefined || nullableId(value.folderId));
    case 'open': case 'duplicate': case 'delete': case 'export':
      return exact(value, [...base, 'projectId']) && identifier(value.projectId);
    case 'rename': return exact(value, [...base, 'projectId', 'title']) && identifier(value.projectId) && text(value.title, 500);
    case 'move': return exact(value, [...base, 'projectId', 'folderId']) && identifier(value.projectId) && nullableId(value.folderId);
    case 'createFolder': return exact(value, [...base, 'title', 'folderId']) && text(value.title, 500) && nullableId(value.folderId);
    case 'renameFolder': return exact(value, [...base, 'folderId', 'title']) && identifier(value.folderId) && text(value.title, 500);
    case 'deleteFolder': return exact(value, [...base, 'folderId']) && identifier(value.folderId);
    default: return false;
  }
}
export function projectProjectResult(value, result) {
  for (const key of ['projects', 'folders']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].length > 100) throw new Error('Invalid project catalog');
    result[key] = value[key].map(item => {
      if (!identifier(item?.id) || !text(item.title, 500) || (item.folderId !== undefined && !nullableId(item.folderId))) throw new Error('Invalid project');
      return { id: item.id, title: item.title, folderId: item.folderId ?? null };
    });
  }
  if (value.projectState !== undefined) {
    if (!['saved', 'created', 'updated', 'ready-to-open', 'awaiting-user'].includes(value.projectState)) throw new Error('Invalid project state');
    result.projectState = value.projectState;
  }
  if (value.projectRequestId !== undefined) {
    if (!identifier(value.projectRequestId)) throw new Error('Invalid project request');
    result.projectRequestId = value.projectRequestId;
  }
  if (value.projectNextOffset !== undefined) {
    if (value.projectNextOffset !== null && (!Number.isInteger(value.projectNextOffset) || value.projectNextOffset < 0)) throw new Error('Invalid pagination');
    result.projectNextOffset = value.projectNextOffset;
  }
}
export const projectControlSchema = {
  operation: { enum: ['save', 'create', 'open', 'rename', 'move', 'duplicate', 'delete', 'export', 'import', 'createFolder', 'renameFolder', 'deleteFolder'] },
  projectId: { type: 'string' }, folderId: { type: ['string', 'null'] }, title: { type: 'string', maxLength: 500 },
};
