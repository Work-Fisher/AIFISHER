import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import path from 'node:path';

const CONFIG = Object.freeze({
  image: Object.freeze({
    storageType: 'images',
    defaultExtension: '.png',
    maximumBytes: 50 * 1024 * 1024,
    extensions: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']),
  }),
  video: Object.freeze({
    storageType: 'videos',
    defaultExtension: '.mp4',
    maximumBytes: 2 * 1024 * 1024 * 1024,
    extensions: new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']),
  }),
  audio: Object.freeze({
    storageType: 'audios',
    defaultExtension: '.mp3',
    maximumBytes: 500 * 1024 * 1024,
    extensions: new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac', '.webm']),
  }),
});

const EXTENSIONS = Object.freeze({
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.webp': { kind: 'image', mimeType: 'image/webp' },
  '.gif': { kind: 'image', mimeType: 'image/gif' },
  '.bmp': { kind: 'image', mimeType: 'image/bmp' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4' },
  '.mov': { kind: 'video', mimeType: 'video/quicktime' },
  '.mkv': { kind: 'video', mimeType: 'video/x-matroska' },
  '.m4v': { kind: 'video', mimeType: 'video/x-m4v' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac' },
});

const MIME_TYPES = Object.freeze({
  'image/png': { kind: 'image', extension: '.png' },
  'image/jpeg': { kind: 'image', extension: '.jpg' },
  'image/jpg': { kind: 'image', extension: '.jpg' },
  'image/webp': { kind: 'image', extension: '.webp' },
  'image/gif': { kind: 'image', extension: '.gif' },
  'image/bmp': { kind: 'image', extension: '.bmp' },
  'video/mp4': { kind: 'video', extension: '.mp4' },
  'video/quicktime': { kind: 'video', extension: '.mov' },
  'video/webm': { kind: 'video', extension: '.webm' },
  'video/x-matroska': { kind: 'video', extension: '.mkv' },
  'video/x-m4v': { kind: 'video', extension: '.m4v' },
  'audio/mpeg': { kind: 'audio', extension: '.mp3' },
  'audio/mp3': { kind: 'audio', extension: '.mp3' },
  'audio/wav': { kind: 'audio', extension: '.wav' },
  'audio/x-wav': { kind: 'audio', extension: '.wav' },
  'audio/mp4': { kind: 'audio', extension: '.m4a' },
  'audio/m4a': { kind: 'audio', extension: '.m4a' },
  'audio/x-m4a': { kind: 'audio', extension: '.m4a' },
  'audio/ogg': { kind: 'audio', extension: '.ogg' },
  'audio/aac': { kind: 'audio', extension: '.aac' },
  'audio/flac': { kind: 'audio', extension: '.flac' },
  'audio/webm': { kind: 'audio', extension: '.webm' },
});

export class MediaArtifactError extends Error {
  constructor(message, code = 'MEDIA_ARTIFACT_UNSUPPORTED') {
    super(message);
    this.name = 'MediaArtifactError';
    this.code = code;
  }
}

function normalizedContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function declaredEvidence(value) {
  const normalized = normalizedContentType(value).replace(/^\./, '');
  if (['image', 'images', 'mask', 'frame'].includes(normalized)) return { kind: 'image' };
  if (['video', 'videos'].includes(normalized)) return { kind: 'video' };
  if (['audio', 'audios'].includes(normalized)) return { kind: 'audio' };
  if (MIME_TYPES[normalized]) {
    return { ...MIME_TYPES[normalized], mimeType: normalized };
  }
  if (normalized === 'webm') {
    return { kind: 'video', extension: '.webm', mimeType: 'video/webm' };
  }
  const extension = normalized ? `.${normalized}` : '';
  return EXTENSIONS[extension] ? { extension, ...EXTENSIONS[extension] } : {};
}

function kindFromDeclaredType(value) {
  return declaredEvidence(value).kind || null;
}

function extensionEvidence(filename, declaredKind) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (extension === '.webm') {
    return {
      extension,
      kind: declaredKind === 'audio' ? 'audio' : 'video',
      mimeType: declaredKind === 'audio' ? 'audio/webm' : 'video/webm',
    };
  }
  return extension ? { extension, ...EXTENSIONS[extension] } : { extension: '' };
}

function isAdtsHeader(buffer) {
  if (buffer.length < 7) return false;
  const protectionAbsent = (buffer[1] & 0x01) === 0x01;
  const headerLength = protectionAbsent ? 7 : 9;
  if (
    buffer[0] !== 0xff
    || (buffer[1] & 0xf6) !== 0xf0
    || buffer.length < headerLength
    || ((buffer[2] & 0x3c) >> 2) > 12
  ) return false;
  const frameLength = ((buffer[3] & 0x03) << 11) | (buffer[4] << 3) | (buffer[5] >> 5);
  return frameLength >= headerLength;
}

function isMpegLayerThreeHeader(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || (buffer[1] & 0xe0) !== 0xe0) return false;
  const version = (buffer[1] >> 3) & 0x03;
  const layer = (buffer[1] >> 1) & 0x03;
  const bitrateIndex = buffer[2] >> 4;
  const sampleRateIndex = (buffer[2] >> 2) & 0x03;
  return version !== 1 && layer === 1 && bitrateIndex !== 15 && sampleRateIndex !== 3;
}

function magicEvidence(buffer) {
  if (!buffer || buffer.length < 4) return null;
  const ascii = buffer.toString('ascii', 0, Math.min(buffer.length, 16));
  const hex = buffer.subarray(0, 16).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return { kind: 'image', extension: '.png', mimeType: 'image/png' };
  if (hex.startsWith('ffd8ff')) return { kind: 'image', extension: '.jpg', mimeType: 'image/jpeg' };
  if (ascii.startsWith('GIF8')) return { kind: 'image', extension: '.gif', mimeType: 'image/gif' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return { kind: 'image', extension: '.webp', mimeType: 'image/webp' };
  }
  if (hex.startsWith('424d')) return { kind: 'image', extension: '.bmp', mimeType: 'image/bmp' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') {
    return { kind: 'audio', extension: '.wav', mimeType: 'audio/wav' };
  }
  if (isAdtsHeader(buffer)) {
    return { kind: 'audio', extension: '.aac', mimeType: 'audio/aac' };
  }
  if (ascii.startsWith('ID3') || isMpegLayerThreeHeader(buffer)) {
    return { kind: 'audio', extension: '.mp3', mimeType: 'audio/mpeg' };
  }
  if (ascii.startsWith('OggS')) return { kind: 'audio', extension: '.ogg', mimeType: 'audio/ogg' };
  if (ascii.startsWith('fLaC')) return { kind: 'audio', extension: '.flac', mimeType: 'audio/flac' };
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12).trim().toLowerCase();
    if (brand.startsWith('m4a')) return { kind: 'audio', extension: '.m4a', mimeType: 'audio/mp4' };
    return { container: 'iso-base-media' };
  }
  if (hex.startsWith('1a45dfa3')) return { container: 'ebml' };
  return null;
}

function publicArtifact(kind, extension, mimeType, evidence) {
  const config = CONFIG[kind];
  return {
    kind,
    storageType: config.storageType,
    extension,
    mimeType,
    maximumBytes: config.maximumBytes,
    evidence,
  };
}

export function resolveMediaArtifact({
  filename,
  declaredType,
  contentType,
  prefix,
  probedKind,
  requireRecognizedContent = false,
} = {}) {
  const declared = declaredEvidence(declaredType);
  const declaredKind = declared.kind || null;
  const extension = extensionEvidence(filename, declaredKind);
  const normalizedMimeType = normalizedContentType(contentType);
  const mime = MIME_TYPES[normalizedMimeType] || null;
  const magic = magicEvidence(prefix);
  const inspectedKind = kindFromDeclaredType(probedKind);
  if (requireRecognizedContent && !magic) {
    throw new MediaArtifactError('媒体文件内容无法识别', 'MEDIA_ARTIFACT_CONTENT_INVALID');
  }

  const kind = magic?.kind || inspectedKind || mime?.kind || extension.kind || declaredKind;
  if (!kind || !CONFIG[kind]) {
    throw new MediaArtifactError('不支持的媒体类型');
  }
  const config = CONFIG[kind];
  const containerExtension = magic?.container === 'iso-base-media'
    ? (kind === 'audio' ? '.m4a' : '.mp4')
    : magic?.container === 'ebml'
      ? '.webm'
      : null;
  const containerMimeType = magic?.container === 'iso-base-media'
    ? (kind === 'audio' ? 'audio/mp4' : 'video/mp4')
    : magic?.container === 'ebml'
      ? (kind === 'audio' ? 'audio/webm' : 'video/webm')
      : null;
  const canonicalExtension = magic?.extension
    || (config.extensions.has(extension.extension) ? extension.extension : null)
    || containerExtension
    || (mime?.kind === kind && config.extensions.has(mime.extension) ? mime.extension : null)
    || (declared.kind === kind && config.extensions.has(declared.extension) ? declared.extension : null)
    || config.defaultExtension;
  const canonicalMimeType = magic?.mimeType
    || (mime?.kind === kind ? normalizedMimeType : null)
    || (config.extensions.has(extension.extension) ? extension.mimeType : null)
    || containerMimeType
    || (declared.kind === kind ? declared.mimeType : null)
    || EXTENSIONS[canonicalExtension]?.mimeType
    || `${kind}/${canonicalExtension.slice(1)}`;
  const evidence = magic?.kind
    ? 'magic'
    : inspectedKind
      ? 'ffprobe'
      : mime?.kind
        ? 'mime'
        : extension.kind
          ? 'extension'
          : 'declared';
  return publicArtifact(kind, canonicalExtension, canonicalMimeType, evidence);
}

async function readPrefix(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function inspectMediaArtifact({
  filePath,
  filename,
  declaredType,
  contentType,
  prefix,
  probeMediaMetadata,
} = {}) {
  const header = prefix || await readPrefix(filePath);
  const initial = resolveMediaArtifact({
    filename,
    declaredType,
    contentType,
    prefix: header,
    requireRecognizedContent: true,
  });
  const magic = magicEvidence(header);
  const declaredKind = kindFromDeclaredType(declaredType);
  const extensionKind = extensionEvidence(filename, declaredKind).kind;
  const mimeKind = MIME_TYPES[normalizedContentType(contentType)]?.kind || null;
  const kindHints = new Set([magic?.kind, mimeKind, extensionKind, declaredKind].filter(Boolean));
  const ambiguousContainer = Boolean(magic?.container);
  const requiresProbe = Boolean(
    probeMediaMetadata
    && !magic?.kind
    && (ambiguousContainer || kindHints.size > 1)
    && [...kindHints].some((kind) => kind === 'video' || kind === 'audio'),
  );
  if (!requiresProbe) return initial;

  for (const kind of ['video', 'audio']) {
    try {
      const metadata = await probeMediaMetadata(filePath, CONFIG[kind].storageType);
      return {
        ...resolveMediaArtifact({
          filename,
          declaredType,
          contentType,
          prefix: header,
          probedKind: kind,
          requireRecognizedContent: true,
        }),
        metadata,
      };
    } catch (error) {
      if (error?.code !== 'MEDIA_STREAM_NOT_FOUND') throw error;
    }
  }
  throw new MediaArtifactError('媒体文件中没有可用的音视频流', 'MEDIA_ARTIFACT_CONTENT_INVALID');
}
