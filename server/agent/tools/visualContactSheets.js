import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { resolveInspectionSource } from './mediaInspection.js';

/** Preserve all references when a provider accepts fewer images by grouping numbered previews. */
export async function fitVisualReferences(media, allowed, { libraryDirectory, projectId }) {
  if (!media.length || !allowed || media.length <= allowed) return media;
  const perSheet = Math.ceil(media.length / allowed), result = [];
  for (let offset = 0; offset < media.length; offset += perSheet) {
    const batch = media.slice(offset, offset + perSheet), columns = Math.min(4, batch.length), rows = Math.ceil(batch.length / columns);
    const tiles = [];
    for (const [index, item] of batch.entries()) {
      const raw = item.base64 || item.url;
      let buffer;
      if (raw.startsWith('/library/media/')) {
        const file = await resolveInspectionSource(libraryDirectory, projectId, raw, 'image');
        buffer = await readFile(file);
      } else buffer = Buffer.from(raw.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      const image = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(512, 384, { fit: 'contain', background: '#181818' }).jpeg().toBuffer();
      const left = index % columns * 512, top = Math.floor(index / columns) * 416;
      tiles.push({ input: image, left, top });
      tiles.push({ input: Buffer.from(`<svg width="512" height="32"><rect width="512" height="32" fill="#181818"/><text x="12" y="23" font-size="20" fill="white">${offset + index + 1}</text></svg>`), left, top: top + 384 });
    }
    const buffer = await sharp({ create: { width: columns * 512, height: rows * 416, channels: 3, background: '#181818' } }).composite(tiles).jpeg({ quality: 85 }).toBuffer();
    result.push({ type: 'image', url: `data:image/jpeg;base64,${buffer.toString('base64')}` });
  }
  return result;
}
