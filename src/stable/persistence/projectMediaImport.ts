import type { ProjectDocument } from './canvasProjectDocument';

type RecordValue = Record<string, unknown>;
type Source = { projectId: string; type: string; filename?: string; assetId?: string };
type Asset = { id: string; projectId: string; url: string };
type CopyAsset = (source: Source, projectId: string) => Promise<Asset>;
const kinds: Record<string, string> = { image: 'images', video: 'videos', audio: 'audios', images: 'images', videos: 'videos', audios: 'audios' };

async function copyAsset(source: Source, projectId: string): Promise<Asset> {
  const response = await window.fetch('/api/assets/copy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, source }),
  });
  const result = await response.json();
  if (!response.ok || !result.asset?.id || result.asset.projectId !== projectId)
    throw new Error(result.error || '项目素材复制失败。');
  return result.asset;
}

/** Rehome only actual media fields. Prompt text and unknown extension data are
 * preserved. The caller commits the graph only after all copies have succeeded. */
export async function prepareProjectMedia(
  document: ProjectDocument, projectId: string, valid: () => boolean = () => true,
  transfer: CopyAsset = copyAsset,
): Promise<ProjectDocument> {
  const result: ProjectDocument = JSON.parse(JSON.stringify(document));
  const copied = new Map<string, Promise<Asset>>();
  const copy = (source: Source) => {
    if (!valid()) throw new Error('项目导入已取消。');
    const key = JSON.stringify(source);
    if (!copied.has(key)) copied.set(key, transfer(source, projectId));
    return copied.get(key)!;
  };
  const localUrl = async (value: unknown) => {
    if (typeof value !== 'string') return null;
    const match = /^\/library\/media\/([^/]+)\/(images|videos|audios)\/([^/?#]+)(?:[?#].*)?$/.exec(value);
    if (!match) return null;
    const owner = decodeURIComponent(match[1]);
    if (owner === projectId) return null;
    return copy({ projectId: owner, type: match[2], filename: decodeURIComponent(match[3]) });
  };
  const reference = async (record: RecordValue, owner: string, type?: string) => {
    const sourceProject = typeof record.projectId === 'string' ? record.projectId : owner;
    if (typeof record.assetId === 'string' && sourceProject && sourceProject !== projectId && type) {
      const asset = await copy({ projectId: sourceProject, type, assetId: record.assetId });
      record.assetId = asset.id;
      record.projectId = projectId;
    }
  };
  const mediaRecord = async (record: RecordValue, owner: string, type?: string): Promise<void> => {
    let primary: Asset | null = null;
    for (const key of ['resultUrl', 'url', 'lastFrame', 'lastFrameUrl', 'coverUrl']) {
      const asset = await localUrl(record[key]);
      if (!asset) continue;
      record[key] = asset.url;
      if (key === 'resultUrl' || key === 'url') primary = asset;
    }
    if (primary) {
      if (record.assetId) record.assetId = primary.id;
      record.projectId = projectId;
      delete record.networkUrl;
    } else await reference(record, owner, type);
    for (const key of ['resultUrls', 'urls']) {
      const urls = record[key];
      if (!Array.isArray(urls)) continue;
      for (let i = 0; i < urls.length; i++) {
        const asset = await localUrl(urls[i]);
        if (asset) urls[i] = asset.url;
      }
    }
    const children = [record.result, ...['resultHistory', 'workflowOutputs', 'outputs'].flatMap(key => Array.isArray(record[key]) ? record[key] : [])];
    for (const child of children) {
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        const item = child as RecordValue;
        await mediaRecord(item, owner, kinds[String(item.mediaKind || item.mediaType || item.type)] || type);
      }
    }
  };
  const parameters = async (value: unknown, owner: string): Promise<void> => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) await parameters(item, owner);
      return;
    }
    const record = value as RecordValue;
    if (record.assetId && typeof record.type === 'string' && kinds[record.type])
      await mediaRecord(record, owner, kinds[record.type]);
    else for (const item of Object.values(record)) await parameters(item, owner);
  };
  for (const node of result.nodes) {
    const owner = String(node.projectId || document.id || '');
    await mediaRecord(node, owner, kinds[node.type.replace(/^Upload /, '').toLowerCase()]);
    await parameters(node.parameterValues, owner);
  }
  const cover = await localUrl(result.coverUrl);
  if (cover) result.coverUrl = cover.url;
  return result;
}
