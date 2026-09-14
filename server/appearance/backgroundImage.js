import sharp from 'sharp';

export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
export const MAX_BACKGROUND_PIXELS = 32_000_000;
export const MAX_BACKGROUND_EDGE = 4096;

export class BackgroundError extends Error {
  constructor(message, status = 400, code = 'INVALID_BACKGROUND') {
    super(message);
    this.name = 'BackgroundError';
    this.status = status;
    this.code = code;
  }
}

const invalid = () => new BackgroundError('图片已损坏或不是有效的 JPG、PNG、WebP 静态图片。', 415);
const animated = () => new BackgroundError('画布背景只支持静态图片，请选择 JPG、PNG 或静态 WebP。', 415, 'ANIMATED_BACKGROUND');

// Inspect container signatures before invoking a decoder. APNG is checked explicitly:
// some PNG decoders expose only its first frame and omit the animation metadata.
function inspectContainer(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length) throw invalid();
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw animated();
      offset += length + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    if (!ended || offset !== bytes.length) throw invalid();
    return { mime: 'image/png', format: 'png' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (offset + 8 + length > bytes.length) throw invalid();
      if (type === 'ANIM' || type === 'ANMF'
        || (type === 'VP8X' && length > 0 && (bytes[offset + 8] & 2))) throw animated();
      offset += 8 + length + (length % 2);
    }
    if (offset !== bytes.length) throw invalid();
    return { mime: 'image/webp', format: 'webp' };
  }
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { mime: 'image/jpeg', format: 'jpeg' };
  }
  throw invalid();
}

export async function normalizeBackgroundImage(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw invalid();
  if (bytes.length > MAX_BACKGROUND_BYTES) {
    throw new BackgroundError('背景图片不能超过 20 MiB。', 413, 'BACKGROUND_TOO_LARGE');
  }
  const container = inspectContainer(bytes);
  if (mimeType !== container.mime) throw invalid();
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_BACKGROUND_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== container.format || !metadata.width || !metadata.height) throw invalid();
    if ((metadata.pages ?? 1) !== 1) throw animated();
    if (metadata.width * metadata.height > MAX_BACKGROUND_PIXELS) {
      throw new BackgroundError('背景图片不能超过 3200 万像素。', 413, 'BACKGROUND_TOO_MANY_PIXELS');
    }
    // rotate() applies EXIF orientation; no withMetadata/keepMetadata call is intentional.
    const result = await image.rotate()
      .resize({ width: MAX_BACKGROUND_EDGE, height: MAX_BACKGROUND_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .timeout({ seconds: 20 })
      .toBuffer({ resolveWithObject: true });
    if (!result.data.length || result.data.length > MAX_BACKGROUND_BYTES) {
      throw new BackgroundError('处理后的背景图片过大，请选择较小的图片。', 413, 'BACKGROUND_TOO_LARGE');
    }
    return { bytes: result.data, width: result.info.width, height: result.info.height };
  } catch (error) {
    if (error instanceof BackgroundError) throw error;
    if (/timeout|timed out/i.test(error.message ?? '')) {
      throw new BackgroundError('图片处理超时，请选择较小的图片后重试。', 504, 'BACKGROUND_PROCESSING_TIMEOUT');
    }
    if (/pixel limit/i.test(error.message ?? '')) {
      throw new BackgroundError('背景图片不能超过 3200 万像素。', 413, 'BACKGROUND_TOO_MANY_PIXELS');
    }
    throw invalid();
  }
}
