import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fetchExternalUrl } from '../security/externalUrlPolicy.js';

export function coverUrlFromInfo(info) {
  for (const value of [info?.coverUrl, info?.cover, info?.coverImage, info?.thumbnailUrl, info?.thumbnail, info?.webappCover, info?.imageUrl]) {
    const candidate = typeof value === 'string' ? value : value?.url;
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

// Optional artwork must never prevent importing the runnable workflow.
export async function downloadRunningHubCover(info, libraryDirectory, fetchRemote = fetchExternalUrl) {
  const url = coverUrlFromInfo(info);
  if (!url) return null;
  try {
    const { response } = await fetchRemote(url, { timeoutMs: 10000, maxRedirects: 2 });
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) return null;
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) throw new Error('cover too large');
      chunks.push(chunk);
    }
    const cover = await sharp(Buffer.concat(chunks), { limitInputPixels: 32000000 }).rotate().resize({ width: 768, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const filename = `${crypto.createHash('sha256').update(cover).digest('hex')}.webp`;
    const root = path.join(libraryDirectory, 'media', 'workflow-covers', 'images');
    await mkdir(root, { recursive: true }); await writeFile(path.join(root, filename), cover);
    return `/library/media/workflow-covers/images/${filename}`;
  } catch { return null; }
}

export async function readRunningHubPageCover(baseUrl, webAppId, fetchPage = fetchExternalUrl) {
  if (!/^https:\/\/www\.runninghub\.(cn|ai)$/.test(baseUrl) || !/^\d+$/.test(webAppId)) return null;
  try {
    const { response } = await fetchPage(`${baseUrl}/ai-detail/${webAppId}`, { timeoutMs: 10000, maxRedirects: 0 });
    if (!response.ok) return null;
    let html = ''; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw new Error('page too large'); html += Buffer.from(chunk).toString('utf8'); }
    const match = /class="[^"]*cover-stage[^"]*"[^>]*>[\s\S]{0,1500}?<(?:img|video)[^>]*(?:src|poster)="([^"]+)"/i.exec(html);
    return match?.[1]?.replace(/&amp;/g, '&') || null;
  } catch { return null; }
}
