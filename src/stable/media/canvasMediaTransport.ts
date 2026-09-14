import { fileUploadBody, localFilePath } from '../desktop/localFileUpload';

export type MediaKind = 'image' | 'video' | 'audio';
const extensions: Record<MediaKind, string[]> = {
  image: ['jpeg', 'jpg', 'png', 'webp', 'bmp'],
  video: ['m4v', 'mov', 'mp4', 'webm', 'mkv'],
  audio: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'],
};
export function classifyMedia(file: Pick<File, 'name' | 'size'>): MediaKind {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kind = (Object.keys(extensions) as MediaKind[]).find((key) =>
    extensions[key].includes(extension),
  );
  if (!kind) throw new Error('暂不支持此文件格式。视频支持 MP4、MOV、M4V、WebM 和 MKV。');
  const limit = { image: 50 * 1024 ** 2, video: 2 * 1024 ** 3, audio: 500 * 1024 ** 2 }[kind];
  if (file.size > limit)
    throw new Error('文件大小超过上限（视频 2 GB、音频 500 MB、图片 50 MB）。');
  return kind;
}
export async function readMediaResponse(response: Response): Promise<Record<string, unknown>> {
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof result?.error === 'string' ? result.error : `素材请求失败 (${response.status})`,
    );
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('素材接口返回无效数据');
  return result;
}
export function mediaResultUrl(result: Record<string, unknown>): string {
  if (typeof result.url !== 'string' || !result.url.trim())
    throw new Error('素材接口返回缺少文件地址');
  return result.url;
}
export async function uploadMediaFile(
  file: File,
  projectId?: string | null,
  nodeId?: string | null,
  signal?: AbortSignal,
) {
  const kind = classifyMedia(file);
  const path = localFilePath(file);
  if (path) {
    const response = await fetch(`/api/assets/import/${kind}s`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        projectId: projectId || 'default',
        ...(nodeId ? { nodeId } : {}),
        filename: file.name,
      }),
    });
    return mediaResultUrl(await readMediaResponse(response));
  }
  const contentType = file.type.startsWith(`${kind}/`)
    ? file.type
    : { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' }[kind];
  const response = await fetch(`/api/assets/upload/${kind}s`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': contentType,
      'x-filename': encodeURIComponent(file.name),
      'x-project-id': projectId || '',
      'x-node-id': nodeId || '',
    },
    ...fileUploadBody(file),
  });
  return mediaResultUrl(await readMediaResponse(response));
}
export async function uploadMediaData(
  data: string,
  kind: MediaKind = 'image',
  prompt = '',
  projectId?: string | null,
  signal?: AbortSignal,
) {
  if (!data.startsWith('data:')) return data;
  return mediaResultUrl(
    await readMediaResponse(
      await fetch(`/api/assets/${kind}s`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-project-id': projectId || '' },
        body: JSON.stringify({ data, prompt, projectId: projectId || null }),
      }),
    ),
  );
}
