import { buildAssetUrl, normalizeAsset, listMediaAssets } from './mediaAssetListing.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import sharp from 'sharp';
import { ExternalUrlPolicyError, fetchExternalUrl } from '../security/externalUrlPolicy.js';
import { MediaArtifactError, resolveMediaArtifact } from './mediaArtifact.js';
import { createMediaMetadataProbe, MediaProbeError } from './mediaMetadataProbe.js';

const MEDIA_TYPES = new Set(['images', 'videos', 'audios']);
const DEFAULT_UPLOAD_MAX_BYTES = Object.freeze(Object.fromEntries(
  [...MEDIA_TYPES].map((type) => [
    type,
    resolveMediaArtifact({ declaredType: type }).maximumBytes,
  ]),
));

class MediaAssetError extends Error {
  constructor(message, status = 400, code = 'INVALID_MEDIA_ASSET') {
    super(message);
    this.name = 'MediaAssetError';
    this.status = status;
    this.code = code;
  }
}

function assertMediaType(type) {
  if (!MEDIA_TYPES.has(type)) {
    throw new MediaAssetError('Invalid asset type');
  }
}

function assertSafeSegment(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new MediaAssetError(`${label} 无效`);
  }
  return value;
}

function sanitizeExtension(filename, type) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  const expected = resolveMediaArtifact({ declaredType: type });
  if (!extension) return expected.extension;
  let artifact;
  try {
    artifact = resolveMediaArtifact({ filename, declaredType: type });
  } catch {
    artifact = null;
  }
  if (!artifact || artifact.kind !== expected.kind || artifact.extension !== extension) {
    throw new MediaAssetError('上传素材扩展名与类型不匹配', 415, 'UNSUPPORTED_MEDIA_EXTENSION');
  }
  return extension;
}

function assertUploadFilename(filename) {
  if (
    typeof filename !== 'string'
    || !filename
    || filename.length > 255
    || filename.includes('/')
    || filename.includes('\\')
    || /[\r\n\0]/.test(filename)
  ) {
    throw new MediaAssetError('上传文件名无效');
  }
  return filename;
}

function decodeUploadFilename(value, type) {
  let filename;
  try {
    const extension = resolveMediaArtifact({ declaredType: type }).extension;
    filename = decodeURIComponent(String(value || `upload${extension}`));
  } catch {
    throw new MediaAssetError('上传文件名编码无效');
  }
  return assertUploadFilename(filename);
}

async function statImportSource(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new MediaAssetError('导入文件路径无效', 400, 'IMPORT_PATH_INVALID');
  }
  let stats;
  try {
    stats = await stat(value);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new MediaAssetError('导入文件不存在', 404, 'IMPORT_FILE_NOT_FOUND');
    }
    throw new MediaAssetError('导入文件无法读取', 400, 'IMPORT_FILE_UNREADABLE');
  }
  if (!stats.isFile()) throw new MediaAssetError('导入路径不是文件', 400, 'IMPORT_FILE_INVALID');
  return { path: value, size: stats.size };
}

function assertUploadContentType(contentType, type) {
  const expected = resolveMediaArtifact({ declaredType: type });
  let artifact;
  try {
    artifact = resolveMediaArtifact({ contentType });
  } catch {
    artifact = null;
  }
  if (!artifact || artifact.kind !== expected.kind || artifact.evidence !== 'mime') {
    throw new MediaAssetError('上传素材 Content-Type 与类型不匹配', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

function assertProbedMediaType(probed, type) {
  const expected = resolveMediaArtifact({ declaredType: type });
  let artifact;
  try {
    artifact = resolveMediaArtifact({ contentType: probed?.mimeType });
  } catch {
    artifact = null;
  }
  const hasRequiredShape = type !== 'images' || (probed?.width > 0 && probed?.height > 0);
  if (!artifact || artifact.kind !== expected.kind || !hasRequiredShape) {
    throw new MediaAssetError('上传文件内容与素材类型不匹配', 415, 'INVALID_MEDIA_CONTENT');
  }
}

function extensionFromContentType(contentType, type) {
  try {
    const expected = resolveMediaArtifact({ declaredType: type });
    const artifact = resolveMediaArtifact({ contentType, declaredType: type });
    return artifact.kind === expected.kind ? artifact.extension : expected.extension;
  } catch (error) {
    if (!(error instanceof MediaArtifactError)) throw error;
    return resolveMediaArtifact({ declaredType: type }).extension;
  }
}

function isSupportedMediaFilename(filename, type) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!extension) return false;
  try {
    const expected = resolveMediaArtifact({ declaredType: type });
    const artifact = resolveMediaArtifact({ filename, declaredType: type });
    return artifact.kind === expected.kind && artifact.extension === extension;
  } catch {
    return false;
  }
}

function metadataPath(directory, id) {
  return path.join(directory, `${id}.json`);
}

function parseCompatibilityDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;

  const mimeType = matches[1];
  if (mimeType.startsWith('video/')) {
    return { buffer: Buffer.from(matches[2], 'base64'), extension: '.mp4', type: 'videos' };
  }
  if (mimeType.startsWith('audio/')) {
    return { buffer: Buffer.from(matches[2], 'base64'), extension: '.mp3', type: 'audios' };
  }
  return {
    buffer: Buffer.from(matches[2], 'base64'),
    extension: mimeType === 'image/jpeg' ? '.jpg' : '.png',
    type: 'images',
  };
}

async function probeImage(filePath, type) {
  if (type !== 'images') return {};
  const metadata = await sharp(filePath).metadata();
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || null,
    mimeType: metadata.format ? `image/${metadata.format === 'jpg' ? 'jpeg' : metadata.format}` : null,
  };
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function readAssetMetadata(directory, id) {
  try {
    return JSON.parse(await readFile(metadataPath(directory, id), 'utf8'));
  } catch {
    return null;
  }
}

async function writeAssetMetadata(directory, metadata) {
  await writeFile(metadataPath(directory, metadata.id), JSON.stringify(metadata, null, 2), 'utf8');
}

async function streamUpload(openSource, targetPath, maxBytes, declaredLength = 0) {
  if (declaredLength > maxBytes) {
    throw new MediaAssetError('上传素材超过大小限制', 413, 'UPLOAD_TOO_LARGE');
  }
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new MediaAssetError('上传素材超过大小限制', 413, 'UPLOAD_TOO_LARGE'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(openSource(), meter, fs.createWriteStream(targetPath, { flags: 'wx' }));
  return { bytes, sha256: hash.digest('hex') };
}

async function readResponseBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new MediaAssetError('外部素材超过本地化大小限制', 413, 'REMOTE_ASSET_TOO_LARGE');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new MediaAssetError('外部素材超过本地化大小限制', 413, 'REMOTE_ASSET_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function findAssetByHash(directory, sha256) {
  if (!fs.existsSync(directory)) return null;
  for (const filename of fs.readdirSync(directory)) {
    if (!filename.endsWith('.json')) continue;
    const metadata = await readAssetMetadata(directory, path.basename(filename, '.json'));
    if (
      metadata?.sha256 === sha256 &&
      metadata.filename &&
      fs.existsSync(path.join(directory, metadata.filename))
    ) {
      return metadata;
    }
  }
  return null;
}

function collectProjectMediaReferences(workflow, projectId) {
  const references = new Set();
  const prefix = `/library/media/${projectId}/`;
  const visit = (value) => {
    if (typeof value === 'string') {
      let normalized = value;
      try {
        normalized = decodeURIComponent(value);
      } catch {
        // Keep the original string when it is not URL encoded.
      }
      const index = normalized.indexOf(prefix);
      if (index >= 0) {
        const relative = normalized.slice(index + prefix.length).split(/[?#]/)[0];
        const parts = relative.split('/');
        if (parts.length >= 2 && MEDIA_TYPES.has(parts[0])) {
          references.add(`${parts[0]}/${parts.at(-1)}`);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(workflow);
  return references;
}

async function scanOrphanedProjectMedia(mediaDirectory, projectId, workflow) {
  const references = collectProjectMediaReferences(workflow, projectId);
  const items = [];
  for (const type of MEDIA_TYPES) {
    const directory = path.join(mediaDirectory, projectId, type);
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      if (!isSupportedMediaFilename(filename, type)) continue;
      if (references.has(`${type}/${filename}`)) continue;
      const id = path.basename(filename, path.extname(filename));
      const metaFilename = `${id}.json`;
      const fileStats = await stat(path.join(directory, filename));
      items.push({
        type,
        filename,
        metaFilename: fs.existsSync(path.join(directory, metaFilename)) ? metaFilename : null,
        bytes: fileStats.size,
      });
    }
  }
  return items;
}

function manifestPath(trashDirectory, projectId, batchId) {
  return path.join(trashDirectory, projectId, batchId, 'manifest.json');
}

async function readCleanupManifest(trashDirectory, projectId, batchId) {
  try {
    return JSON.parse(await readFile(manifestPath(trashDirectory, projectId, batchId), 'utf8'));
  } catch {
    throw new MediaAssetError('清理记录不存在', 404, 'CLEANUP_BATCH_NOT_FOUND');
  }
}

export function createMediaAssetRouter({
  libraryDirectory,
  workflowStore,
  metadataProbe,
  fetchImpl = globalThis.fetch,
  resolveHost,
  maxExternalBytes = 100 * 1024 * 1024,
  maxUploadBytes = DEFAULT_UPLOAD_MAX_BYTES,
  logger = console,
}) {
  const router = express.Router();
  const importJson = express.json({ limit: '16kb', strict: true });
  const mediaDirectory = path.join(libraryDirectory, 'media');
  const trashDirectory = path.join(libraryDirectory, '.trash');
  const probeBundledMedia = createMediaMetadataProbe();
  const probeMetadata = metadataProbe || ((filePath, type) => (
    type === 'images' ? probeImage(filePath, type) : probeBundledMedia(filePath, type)
  ));
  const requestExternal = async (value, options) => {
    try {
      return await fetchExternalUrl(value, { fetchImpl, resolveHost, ...options });
    } catch (error) {
      if (error instanceof ExternalUrlPolicyError) {
        throw new MediaAssetError(error.message, error.status, error.code);
      }
      throw error;
    }
  };
  const moveToRecoverableTrash = async (projectId, relativePaths) => {
    const batchId = `${Date.now()}-${crypto.randomUUID()}`;
    const batchDirectory = path.join(trashDirectory, projectId, batchId);
    const moved = [];
    try {
      for (const relativePath of relativePaths) {
        const sourcePath = path.join(mediaDirectory, projectId, relativePath);
        const targetPath = path.join(batchDirectory, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await rename(sourcePath, targetPath);
        moved.push(relativePath);
      }
      const manifest = {
        format: 'fisherai-cleanup-trash',
        version: 1,
        batchId,
        projectId,
        createdAt: new Date().toISOString(),
        files: moved.map((relativePath) => relativePath.split(path.sep).join('/')),
      };
      await writeFile(
        manifestPath(trashDirectory, projectId, batchId),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      return { batchId, moved };
    } catch (error) {
      for (const relativePath of moved.reverse()) {
        const sourcePath = path.join(batchDirectory, relativePath);
        const targetPath = path.join(mediaDirectory, projectId, relativePath);
        if (!fs.existsSync(sourcePath)) continue;
        await mkdir(path.dirname(targetPath), { recursive: true });
        await rename(sourcePath, targetPath);
      }
      await rm(batchDirectory, { recursive: true, force: true });
      throw error;
    }
  };

  // One pipeline for request bodies and local files: same size limit, content probe,
  // quarantine and response.
  async function storeUploadedAsset({ type, projectId, nodeId, originalName, openSource, declaredLength }) {
    let temporaryPath = null;
    let quarantinedPath = null;
    let quarantinedMetadataPath = null;
    try {
      const extension = sanitizeExtension(originalName, type);
      const id = crypto.randomUUID();
      const filename = `${id}${extension}`;
      const directory = path.join(mediaDirectory, projectId, type);
      await mkdir(directory, { recursive: true });
      temporaryPath = path.join(directory, `.${id}.uploading`);
      const filePath = path.join(directory, filename);
      const uploadLimit = Number(maxUploadBytes[type]) || 0;
      const streamed = await streamUpload(openSource, temporaryPath, uploadLimit, declaredLength);
      await rename(temporaryPath, filePath);
      temporaryPath = null;
      quarantinedPath = filePath;
      let probed;
      try {
        probed = await probeMetadata(filePath, type);
        assertProbedMediaType(probed, type);
      } catch (error) {
        if (error instanceof MediaAssetError) throw error;
        if (error instanceof MediaProbeError) {
          throw new MediaAssetError(error.message, error.status, error.code);
        }
        throw new MediaAssetError('上传文件内容无法识别', 415, 'INVALID_MEDIA_CONTENT');
      }
      const metadata = {
        id,
        filename,
        nodeId,
        prompt: originalName,
        model: 'Upload',
        mode: '',
        aspectRatio: probed.width && probed.height ? `${probed.width}:${probed.height}` : 'Auto',
        resolution: probed.width && probed.height ? `${probed.width}x${probed.height}` : 'Auto',
        cost: 0,
        createdAt: new Date().toISOString(),
        favorite: false,
        ...streamed,
        ...probed,
      };
      quarantinedMetadataPath = metadataPath(directory, id);
      await writeAssetMetadata(directory, metadata);
      quarantinedPath = null;
      quarantinedMetadataPath = null;
      return { success: true, url: buildAssetUrl(projectId, type, filename), asset: normalizeAsset(metadata, projectId, type) };
    } catch (error) {
      if (temporaryPath) await rm(temporaryPath, { force: true });
      if (quarantinedPath) await rm(quarantinedPath, { force: true });
      if (quarantinedMetadataPath) await rm(quarantinedMetadataPath, { force: true });
      throw error;
    }
  }

  function sendUploadError(res, error) {
    const status = error instanceof MediaAssetError ? error.status : 500;
    if (status >= 500) logger.error('Binary upload error:', error);
    res.status(status).json({ error: error?.message || 'Failed to save asset', code: error?.code });
  }

  router.post('/assets/upload/:type', async (req, res) => {
    try {
      const type = req.params.type;
      assertMediaType(type);
      const projectId = assertSafeSegment(String(req.headers['x-project-id'] || 'default'), '项目标识');
      const nodeId = req.headers['x-node-id'] ? String(req.headers['x-node-id']) : null;
      assertUploadContentType(req.headers['content-type'], type);
      const originalName = decodeUploadFilename(req.headers['x-filename'], type);
      res.json(await storeUploadedAsset({
        type,
        projectId,
        nodeId,
        originalName,
        openSource: () => req,
        declaredLength: Number(req.headers['content-length'] || 0),
      }));
    } catch (error) {
      sendUploadError(res, error);
    }
  });

  // The desktop page names a local file instead of sending its bytes: Electron's protocol
  // handler would read a request body into the main process in one piece (ADR-0035).
  router.post('/assets/import/:type', importJson, async (req, res) => {
    try {
      const type = req.params.type;
      assertMediaType(type);
      const projectId = assertSafeSegment(String(req.body?.projectId || 'default'), '项目标识');
      const nodeId = req.body?.nodeId ? String(req.body.nodeId) : null;
      const source = await statImportSource(req.body?.path);
      const originalName = assertUploadFilename(req.body?.filename ?? path.basename(source.path));
      res.json(await storeUploadedAsset({
        type,
        projectId,
        nodeId,
        originalName,
        openSource: () => fs.createReadStream(source.path),
        declaredLength: source.size,
      }));
    } catch (error) {
      sendUploadError(res, error);
    }
  });

  router.post('/assets/metadata/repair', async (req, res) => {
    try {
      const projectId = assertSafeSegment(String(req.body?.projectId || ''), '项目标识');
      let scanned = 0;
      let repaired = 0;
      let failed = 0;
      const errors = [];

      for (const type of MEDIA_TYPES) {
        const directory = path.join(mediaDirectory, projectId, type);
        if (!fs.existsSync(directory)) continue;
        for (const filename of fs.readdirSync(directory)) {
          const extension = path.extname(filename).toLowerCase();
          if (!isSupportedMediaFilename(filename, type)) continue;
          scanned += 1;
          const filePath = path.join(directory, filename);
          const id = path.basename(filename, extension);
          try {
            const existing = (await readAssetMetadata(directory, id)) || {};
            const [fileStats, fingerprint, probed] = await Promise.all([
              stat(filePath),
              hashFile(filePath),
              probeMetadata(filePath, type),
            ]);
            const metadata = {
              id,
              filename,
              nodeId: existing.nodeId || null,
              prompt: existing.prompt || filename,
              model: existing.model || 'Imported',
              mode: typeof existing.mode === 'string' ? existing.mode : '',
              aspectRatio:
                existing.aspectRatio ||
                (probed.width && probed.height ? `${probed.width}:${probed.height}` : 'Auto'),
              resolution:
                existing.resolution ||
                (probed.width && probed.height ? `${probed.width}x${probed.height}` : 'Auto'),
              cost: Number(existing.cost) || 0,
              createdAt: existing.createdAt || fileStats.birthtime.toISOString(),
              favorite: existing.favorite === true,
              ...existing,
              ...fingerprint,
              ...probed,
            };
            await writeAssetMetadata(directory, metadata);
            repaired += 1;
          } catch (error) {
            failed += 1;
            errors.push({ filename, error: error?.message || 'Metadata probe failed' });
          }
        }
      }

      res.json({ success: true, scanned, repaired, failed, errors });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Repair asset metadata error:', error);
      res.status(status).json({ error: error?.message || 'Repair metadata failed', code: error?.code });
    }
  });

  router.post('/assets/external/check', async (req, res) => {
    try {
      const { response } = await requestExternal(req.body?.url, {
        method: 'HEAD',
        timeoutMs: 8_000,
      });
      res.json({
        reachable: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type') || null,
        contentLength: Number(response.headers.get('content-length') || 0) || null,
      });
    } catch (error) {
      if (error instanceof MediaAssetError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      res.json({ reachable: false, status: null, error: error?.message || '外部素材不可访问' });
    }
  });

  // Copies stay inside the authenticated user's media root. Imported documents
  // cannot use arbitrary paths, symlinks or Windows alternate data streams.
  router.post('/assets/copy', async (req, res) => {
    try {
      const segment = (value) => {
        assertSafeSegment(value, '素材路径');
        if (/[<>:"|?*]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32) || /[. ]$/.test(value))
          throw new MediaAssetError('素材路径无效');
        return value;
      };
      const projectId = segment(req.body?.projectId);
      const source = req.body?.source;
      const sourceProject = segment(source?.projectId);
      const type = source?.type;
      assertMediaType(type);
      const root = await realpath(mediaDirectory);
      const contained = async (candidate) => {
        const resolved = await realpath(candidate);
        const relative = path.relative(root, resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new MediaAssetError('素材路径超出当前用户目录');
        return resolved;
      };
      const sourceDirectory = await contained(path.join(root, sourceProject, type));
      let filename = source.filename;
      if (!filename) {
        const id = segment(source.assetId);
        await contained(metadataPath(sourceDirectory, id));
        filename = (await readAssetMetadata(sourceDirectory, id))?.filename;
      }
      segment(filename);
      const extension = sanitizeExtension(filename, type);
      const sourcePath = await contained(path.join(sourceDirectory, filename));
      if (!(await stat(sourcePath)).isFile()) throw new MediaAssetError('素材不是文件');
      const { sha256, bytes } = await hashFile(sourcePath);
      // Check each existing ancestor before creating a child, including junctions.
      const projectDirectory = path.join(root, projectId);
      await mkdir(projectDirectory, { recursive: true });
      await contained(projectDirectory);
      const directory = path.join(projectDirectory, type);
      await mkdir(directory, { recursive: true });
      await contained(directory);
      const existing = await findAssetByHash(directory, sha256);
      if (existing) {
        await contained(path.join(directory, segment(existing.filename)));
        return res.json({ success: true, deduplicated: true, asset: normalizeAsset(existing, projectId, type) });
      }
      const id = crypto.randomUUID();
      const targetFilename = `${id}${extension}`;
      const target = path.join(directory, targetFilename);
      await copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
      const metadata = {
        id, filename: targetFilename, bytes, sha256,
        prompt: filename, model: 'Project import', cost: 0,
        createdAt: new Date().toISOString(), favorite: false,
      };
      try {
        await writeAssetMetadata(directory, metadata);
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }
      return res.status(201).json({ success: true, deduplicated: false, asset: normalizeAsset(metadata, projectId, type) });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : error?.code === 'ENOENT' ? 404 : 500;
      return res.status(status).json({ error: status === 404 ? '原项目素材不存在，请重新上传素材。' : '项目素材复制失败，请检查素材是否有效。' });
    }
  });

  router.post('/assets/localize', async (req, res) => {
    try {
      const projectId = assertSafeSegment(String(req.body?.projectId || ''), '项目标识');
      const type = String(req.body?.type || '');
      assertMediaType(type);
      const { response, url: sourceUrl } = await requestExternal(req.body?.url, {
        method: 'GET',
        timeoutMs: 30_000,
      });
      if (!response.ok) {
        throw new MediaAssetError(
          `外部素材不可访问（HTTP ${response.status}）`,
          502,
          'REMOTE_ASSET_UNAVAILABLE',
        );
      }
      const buffer = await readResponseBody(response, maxExternalBytes);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const directory = path.join(mediaDirectory, projectId, type);
      await mkdir(directory, { recursive: true });
      const existing = await findAssetByHash(directory, sha256);
      if (existing) {
        const sourceUrls = Array.from(
          new Set([...(Array.isArray(existing.sourceUrls) ? existing.sourceUrls : []), sourceUrl.href]),
        );
        const nextMetadata = { ...existing, sourceUrls, sourceStatus: 'available' };
        await writeAssetMetadata(directory, nextMetadata);
        return res.json({
          success: true,
          deduplicated: true,
          asset: normalizeAsset(nextMetadata, projectId, type),
        });
      }

      const urlExtension = path.extname(sourceUrl.pathname).toLowerCase();
      const extension = isSupportedMediaFilename(sourceUrl.pathname, type)
        ? urlExtension
        : extensionFromContentType(response.headers.get('content-type'), type);
      const id = crypto.randomUUID();
      const filename = `${id}${extension}`;
      const filePath = path.join(directory, filename);
      await writeFile(filePath, buffer, { flag: 'wx' });
      const probed = await probeMetadata(filePath, type);
      const metadata = {
        id,
        filename,
        nodeId: req.body?.nodeId ? String(req.body.nodeId) : null,
        prompt: path.basename(sourceUrl.pathname) || filename,
        model: 'External URL',
        mode: '',
        aspectRatio: probed.width && probed.height ? `${probed.width}:${probed.height}` : 'Auto',
        resolution: probed.width && probed.height ? `${probed.width}x${probed.height}` : 'Auto',
        cost: 0,
        createdAt: new Date().toISOString(),
        favorite: false,
        bytes: buffer.length,
        sha256,
        sourceUrl: sourceUrl.href,
        sourceUrls: [sourceUrl.href],
        sourceStatus: 'available',
        ...probed,
      };
      await writeAssetMetadata(directory, metadata);
      res.status(201).json({
        success: true,
        deduplicated: false,
        asset: normalizeAsset(metadata, projectId, type),
      });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500 && !(error instanceof MediaAssetError)) {
        logger.error('Localize external asset error:', error);
      }
      res.status(status).json({
        error: error?.message || '外部素材本地化失败',
        code: error?.code || 'REMOTE_ASSET_LOCALIZE_FAILED',
      });
    }
  });

  router.post('/assets/:type', async (req, res) => {
    try {
      assertMediaType(req.params.type);
      const parsed = parseCompatibilityDataUrl(req.body?.data);
      if (!parsed) {
        return res.status(500).json({ error: 'Failed to save asset' });
      }

      const projectId = assertSafeSegment(
        String(req.body?.projectId || req.headers['x-project-id'] || 'default'),
        '项目标识',
      );
      const id = crypto.randomUUID();
      const filename = `${id}${parsed.extension}`;
      const directory = path.join(mediaDirectory, projectId, parsed.type);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, filename), parsed.buffer);
      await writeAssetMetadata(directory, {
        id,
        filename,
        nodeId: null,
        prompt: req.body?.prompt || '',
        type: parsed.type,
        model: 'System',
        mode: '',
        aspectRatio: 'Auto',
        resolution: 'Auto',
        cost: 0,
        createdAt: new Date().toISOString(),
      });

      res.json({ success: true, url: buildAssetUrl(projectId, parsed.type, filename) });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Save asset error:', error);
      res.status(status).json({ error: error?.message || 'Failed to save asset', code: error?.code });
    }
  });

  router.get('/assets/:type', async (req, res) => {
    try {
      const type = req.params.type;
      assertMediaType(type);
      const requestedProjectId = String(req.query.projectId || '');
      const limit = Math.max(0, Number.parseInt(String(req.query.limit || '0'), 10) || 0);
      const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0);
      const projectId = requestedProjectId && requestedProjectId !== 'undefined' && requestedProjectId !== 'null'
        ? assertSafeSegment(requestedProjectId, '项目标识') : null;
      res.json(await listMediaAssets({
        libraryDirectory, type, projectId, limit, offset,
        favoriteOnly: String(req.query.favorite || '') === 'true',
      }));
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('List assets error:', error);
      res.status(status).json({ error: error?.message || 'List assets failed', code: error?.code });
    }
  });

  router.patch('/assets/:type/:id/favorite', async (req, res) => {
    try {
      const type = req.params.type;
      assertMediaType(type);
      const projectId = assertSafeSegment(String(req.query.projectId || ''), '项目标识');
      const id = assertSafeSegment(req.params.id, '素材标识');
      const directory = path.join(mediaDirectory, projectId, type);
      const metadata = await readAssetMetadata(directory, id);
      if (!metadata?.filename || !fs.existsSync(path.join(directory, metadata.filename))) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      const nextMetadata = { ...metadata, favorite: req.body?.favorite === true };
      await writeAssetMetadata(directory, nextMetadata);
      res.json({ success: true, asset: normalizeAsset(nextMetadata, projectId, type) });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Favorite asset error:', error);
      res.status(status).json({ error: error?.message || 'Favorite asset failed', code: error?.code });
    }
  });

  router.delete('/assets/:type/:id', async (req, res) => {
    try {
      const type = req.params.type;
      assertMediaType(type);
      const id = assertSafeSegment(req.params.id, '素材标识');
      const requestedProjectId = String(req.query.projectId || '');
      let directory = null;

      if (requestedProjectId) {
        const projectId = assertSafeSegment(requestedProjectId, '项目标识');
        const projectDirectory = path.join(mediaDirectory, projectId, type);
        if (fs.existsSync(metadataPath(projectDirectory, id))) directory = projectDirectory;
      }

      if (!directory && fs.existsSync(mediaDirectory)) {
        for (const projectId of fs.readdirSync(mediaDirectory)) {
          const projectDirectory = path.join(mediaDirectory, projectId, type);
          if (fs.existsSync(metadataPath(projectDirectory, id))) {
            directory = projectDirectory;
            break;
          }
        }
      }

      if (!directory) {
        const legacyDirectory = path.join(libraryDirectory, type);
        if (fs.existsSync(metadataPath(legacyDirectory, id))) directory = legacyDirectory;
      }

      if (!directory) return res.status(404).json({ error: 'Asset not found' });

      const metadata = await readAssetMetadata(directory, id);
      if (metadata?.filename) {
        try {
          const filename = assertSafeSegment(String(metadata.filename), '素材文件名');
          await rm(path.join(directory, filename), { force: true });
        } catch {
          // Corrupt legacy metadata must not allow deleting outside its asset directory.
        }
      }
      await rm(metadataPath(directory, id), { force: true });
      res.json({ success: true });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Delete asset error:', error);
      res.status(status).json({ error: error?.message || 'Delete asset failed', code: error?.code });
    }
  });

  router.post('/assets/:type/:id/trash', async (req, res) => {
    try {
      const type = req.params.type;
      assertMediaType(type);
      const projectId = assertSafeSegment(String(req.query.projectId || ''), '项目标识');
      const id = assertSafeSegment(req.params.id, '素材标识');
      const directory = path.join(mediaDirectory, projectId, type);
      const metadata = await readAssetMetadata(directory, id);
      if (!metadata?.filename) {
        throw new MediaAssetError('素材不存在', 404, 'ASSET_NOT_FOUND');
      }
      const filename = assertSafeSegment(String(metadata.filename), '素材文件名');
      if (!fs.existsSync(path.join(directory, filename))) {
        throw new MediaAssetError('素材不存在', 404, 'ASSET_NOT_FOUND');
      }
      // “删除素材记录”只影响素材选择器，不能破坏已有画布节点保存的媒体 URL。
      // 真正的二进制文件由项目无引用清理在读取最新工作流后处理。
      const { batchId, moved } = await moveToRecoverableTrash(projectId, [
        path.join(type, `${id}.json`),
      ]);
      res.json({
        success: true,
        deletedCount: moved.length,
        batchId,
        recoverable: true,
        retainedMedia: true,
      });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Trash asset error:', error);
      res.status(status).json({ error: error?.message || 'Trash asset failed', code: error?.code });
    }
  });

  router.post('/workflows/:id/cleanup', async (req, res) => {
    try {
      if (!workflowStore) {
        throw new MediaAssetError('工作流存储不可用', 503, 'WORKFLOW_STORE_UNAVAILABLE');
      }
      const projectId = assertSafeSegment(req.params.id, '项目标识');
      const workflow = await workflowStore.getWorkflowById(projectId);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
      const items = await scanOrphanedProjectMedia(mediaDirectory, projectId, workflow);
      const pendingDelete = items.flatMap((item) =>
        item.metaFilename ? [item.filename, item.metaFilename] : [item.filename],
      );
      if (req.body?.preview === true) {
        return res.json({ success: true, pendingDelete, items, recoverable: true });
      }
      if (items.length === 0) {
        return res.json({ success: true, deletedCount: 0, batchId: null });
      }

      const relativePaths = items.flatMap((item) =>
        [item.filename, item.metaFilename]
          .filter(Boolean)
          .map((filename) => path.join(item.type, filename)),
      );
      const { batchId, moved } = await moveToRecoverableTrash(projectId, relativePaths);
      res.json({ success: true, deletedCount: moved.length, batchId, recoverable: true });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Cleanup project error:', error);
      res.status(status).json({ error: error?.message || 'Cleanup project failed', code: error?.code });
    }
  });

  router.get('/workflows/:id/cleanup/trash', async (req, res) => {
    try {
      const projectId = assertSafeSegment(req.params.id, '项目标识');
      const projectTrash = path.join(trashDirectory, projectId);
      if (!fs.existsSync(projectTrash)) return res.json([]);
      const batches = [];
      for (const entry of fs.readdirSync(projectTrash, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const manifest = await readCleanupManifest(trashDirectory, projectId, entry.name);
          batches.push({
            batchId: manifest.batchId,
            projectId,
            createdAt: manifest.createdAt,
            itemCount: manifest.files.length,
          });
        } catch {
          // Ignore incomplete batches; execution rolls them back when possible.
        }
      }
      batches.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
      res.json(batches);
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('List cleanup trash error:', error);
      res.status(status).json({ error: error?.message || 'List cleanup trash failed', code: error?.code });
    }
  });

  router.post('/workflows/:id/cleanup/restore', async (req, res) => {
    try {
      const projectId = assertSafeSegment(req.params.id, '项目标识');
      const batchId = assertSafeSegment(String(req.body?.batchId || ''), '清理批次');
      const manifest = await readCleanupManifest(trashDirectory, projectId, batchId);
      const conflicts = manifest.files.filter((relativePath) =>
        fs.existsSync(path.join(mediaDirectory, projectId, relativePath)),
      );
      if (conflicts.length > 0) {
        throw new MediaAssetError('目标位置已有同名素材，未执行恢复', 409, 'CLEANUP_RESTORE_CONFLICT');
      }
      let restoredCount = 0;
      for (const relativePath of manifest.files) {
        const sourcePath = path.join(trashDirectory, projectId, batchId, relativePath);
        const targetPath = path.join(mediaDirectory, projectId, relativePath);
        if (!fs.existsSync(sourcePath)) continue;
        await mkdir(path.dirname(targetPath), { recursive: true });
        await rename(sourcePath, targetPath);
        restoredCount += 1;
      }
      await rm(path.join(trashDirectory, projectId, batchId), { recursive: true, force: true });
      res.json({ success: true, restoredCount });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Restore cleanup trash error:', error);
      res.status(status).json({ error: error?.message || 'Restore cleanup failed', code: error?.code });
    }
  });

  router.delete('/workflows/:id/cleanup/trash/:batchId', async (req, res) => {
    try {
      const projectId = assertSafeSegment(req.params.id, '项目标识');
      const batchId = assertSafeSegment(req.params.batchId, '清理批次');
      await readCleanupManifest(trashDirectory, projectId, batchId);
      await rm(path.join(trashDirectory, projectId, batchId), { recursive: true, force: true });
      res.json({ success: true });
    } catch (error) {
      const status = error instanceof MediaAssetError ? error.status : 500;
      if (status >= 500) logger.error('Purge cleanup trash error:', error);
      res.status(status).json({ error: error?.message || 'Purge cleanup failed', code: error?.code });
    }
  });

  return router;
}

export { MediaAssetError };
