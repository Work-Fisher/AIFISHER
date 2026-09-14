import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';

class MediaEditingError extends Error {
  constructor(message, status = 400, code = 'INVALID_MEDIA_EDIT') {
    super(message);
    this.name = 'MediaEditingError';
    this.status = status;
    this.code = code;
  }
}

const bundledFfmpegPath = path.join(RUNTIME_PATHS.BIN_DIR, 'ffmpeg.exe');

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
    throw new MediaEditingError(`${label}无效`);
  }
  return value;
}

function resolveProjectAsset(libraryDirectory, projectId, type, assetUrl) {
  const prefix = `/library/media/${encodeURIComponent(projectId)}/${type}/`;
  const decodedUrl = decodeURIComponent(String(assetUrl || '').split(/[?#]/)[0]);
  const decodedPrefix = decodeURIComponent(prefix);
  if (!decodedUrl.startsWith(decodedPrefix)) {
    throw new MediaEditingError('素材不属于当前项目', 403, 'CROSS_PROJECT_MEDIA');
  }
  const filename = assertSafeSegment(decodedUrl.slice(decodedPrefix.length), '素材文件名');
  const filePath = path.join(libraryDirectory, 'media', projectId, type, filename);
  if (!fs.existsSync(filePath)) {
    throw new MediaEditingError('素材不存在', 404, 'MEDIA_NOT_FOUND');
  }
  return filePath;
}

function normalizeInteger(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new MediaEditingError(`${label}无效`);
  }
  return number;
}

function normalizeTime(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new MediaEditingError(`${label}无效`);
  }
  return number;
}

function normalizeGuides(guides, count, label) {
  const expectedLength = count - 1;
  const normalized = guides == null
    ? Array.from({ length: expectedLength }, (_, index) => (index + 1) / count)
    : guides.map(Number);
  if (
    normalized.length !== expectedLength ||
    normalized.some((guide, index) =>
      !Number.isFinite(guide) ||
      guide <= 0 ||
      guide >= 1 ||
      (index > 0 && guide <= normalized[index - 1]),
    )
  ) {
    throw new MediaEditingError(`${label}无效`);
  }
  return normalized;
}

function buildGridRanges(size, guides, gap) {
  const boundaries = [0, ...guides.map((guide) => Math.round(guide * size)), size];
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const insetStart = index === 0 ? 0 : Math.ceil(gap / 2);
    const insetEnd = index === boundaries.length - 2 ? 0 : Math.floor(gap / 2);
    const left = start + insetStart;
    const width = end - insetEnd - left;
    if (width < 1) throw new MediaEditingError('宫格间距超过单格尺寸');
    return { start: left, size: width };
  });
}

async function writeImageAsset({
  libraryDirectory,
  projectId,
  sourceUrl,
  operation,
  image,
  extraMetadata = {},
}) {
  const id = crypto.randomUUID();
  const filename = `${id}.png`;
  const directory = path.join(libraryDirectory, 'media', projectId, 'images');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  await image.png().toFile(filePath);
  const metadata = await sharp(filePath).metadata();
  const asset = {
    id,
    filename,
    projectId,
    type: 'images',
    url: `/library/media/${encodeURIComponent(projectId)}/images/${encodeURIComponent(filename)}`,
    createdAt: new Date().toISOString(),
    favorite: false,
    prompt: {
      crop: '图片裁切',
      grid: '图片宫格拆分',
      annotation: '图片标注',
    }[operation] || '图片编辑',
    model: 'AIFISHER 媒体编辑',
    operation,
    sourceUrl,
    sourceUrls: [sourceUrl],
    sourceStatus: 'available',
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || 'png',
    mimeType: 'image/png',
    ...extraMetadata,
  };
  await writeFile(path.join(directory, `${id}.json`), JSON.stringify(asset, null, 2), 'utf8');
  return asset;
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(String(value || ''));
  if (!match) throw new MediaEditingError('标注结果必须是 PNG 图片');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) {
    throw new MediaEditingError('标注结果大小无效', 413, 'ANNOTATION_TOO_LARGE');
  }
  return buffer;
}

function validateProjectMediaReferences(value, projectId) {
  if (typeof value === 'string' && value.startsWith('/library/media/')) {
    const expectedPrefix = `/library/media/${encodeURIComponent(projectId)}/`;
    if (!value.startsWith(expectedPrefix)) {
      throw new MediaEditingError('编辑状态引用了其他项目的素材', 403, 'CROSS_PROJECT_MEDIA');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => validateProjectMediaReferences(item, projectId));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => validateProjectMediaReferences(item, projectId));
  }
}

function editStatePath(libraryDirectory, projectId, nodeId) {
  return path.join(libraryDirectory, 'media', projectId, 'edits', `${nodeId}.json`);
}

async function defaultFfmpegRunner(job) {
  const duration = job.endTime == null ? null : job.endTime - job.startTime;
  const args = job.kind === 'video-frame'
    ? ['-y', '-ss', String(job.time), '-i', job.inputPath, '-frames:v', '1', job.outputPath]
    : job.kind === 'audio-trim'
      ? [
          '-y', '-ss', String(job.startTime), '-i', job.inputPath, '-t', String(duration),
          '-c:a', 'libmp3lame', '-q:a', '2', job.outputPath,
        ]
      : [
          '-y', '-ss', String(job.startTime), '-i', job.inputPath, '-t', String(duration),
          '-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-movflags', '+faststart', job.outputPath,
        ];
  await new Promise((resolve, reject) => {
    const child = spawn(bundledFfmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 执行失败 (${code}): ${stderr.slice(-500)}`));
    });
  });
}

async function createOutputAsset({
  libraryDirectory,
  projectId,
  type,
  extension,
  sourceUrl,
  operation,
  metadata = {},
  render,
}) {
  const id = crypto.randomUUID();
  const filename = `${id}${extension}`;
  const directory = path.join(libraryDirectory, 'media', projectId, type);
  await mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, filename);
  try {
    await render(outputPath);
    const imageMetadata = type === 'images' ? await sharp(outputPath).metadata() : {};
    const asset = {
      id,
      filename,
      projectId,
      type,
      url: `/library/media/${encodeURIComponent(projectId)}/${type}/${encodeURIComponent(filename)}`,
      createdAt: new Date().toISOString(),
      favorite: false,
      prompt: {
        'video-trim': '视频时间段导出',
        'video-frame': '视频画面提取',
        'audio-trim': '音频时间段导出',
      }[operation],
      model: 'AIFISHER 媒体编辑',
      operation,
      sourceUrl,
      sourceUrls: [sourceUrl],
      sourceStatus: 'available',
      width: imageMetadata.width || null,
      height: imageMetadata.height || null,
      ...metadata,
    };
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify(asset, null, 2), 'utf8');
    return asset;
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
}

function sendError(response, error, logger) {
  const status = error instanceof MediaEditingError ? error.status : 500;
  if (status >= 500) logger.error('Media editing error:', error);
  response.status(status).json({
    error: error?.message || '媒体编辑失败',
    code: error?.code || 'MEDIA_EDIT_FAILED',
  });
}

export function createMediaEditingRouter({
  libraryDirectory,
  ffmpegRunner = defaultFfmpegRunner,
  logger = console,
}) {
  if (!libraryDirectory) throw new Error('libraryDirectory is required');
  const router = express.Router();

  router.post('/media/images/crop', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.body?.projectId, '项目标识');
      const imageUrl = String(request.body?.imageUrl || '');
      const sourcePath = resolveProjectAsset(libraryDirectory, projectId, 'images', imageUrl);
      const sourceMetadata = await sharp(sourcePath).metadata();
      const rect = request.body?.rect || {};
      const left = normalizeInteger(rect.x, '裁切横坐标');
      const top = normalizeInteger(rect.y, '裁切纵坐标');
      const width = normalizeInteger(rect.width, '裁切宽度', 1);
      const height = normalizeInteger(rect.height, '裁切高度', 1);
      if (left + width > sourceMetadata.width || top + height > sourceMetadata.height) {
        throw new MediaEditingError('裁切区域超出图片范围');
      }
      const asset = await writeImageAsset({
        libraryDirectory,
        projectId,
        sourceUrl: imageUrl,
        operation: 'crop',
        image: sharp(sourcePath).extract({ left, top, width, height }),
        extraMetadata: { cropRect: { x: left, y: top, width, height } },
      });
      response.status(201).json({ success: true, asset });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/media/images/grid', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.body?.projectId, '项目标识');
      const imageUrl = String(request.body?.imageUrl || '');
      const sourcePath = resolveProjectAsset(libraryDirectory, projectId, 'images', imageUrl);
      const sourceMetadata = await sharp(sourcePath).metadata();
      const columns = normalizeInteger(request.body?.columns, '宫格列数', 1);
      const rows = normalizeInteger(request.body?.rows, '宫格行数', 1);
      if (columns > 10 || rows > 10 || columns * rows > 64) {
        throw new MediaEditingError('宫格数量超过限制');
      }
      const horizontalGap = normalizeInteger(request.body?.horizontalGap ?? 0, '横向间距');
      const verticalGap = normalizeInteger(request.body?.verticalGap ?? 0, '纵向间距');
      const columnGuides = normalizeGuides(request.body?.columnGuides, columns, '列分割线');
      const rowGuides = normalizeGuides(request.body?.rowGuides, rows, '行分割线');
      const columnRanges = buildGridRanges(sourceMetadata.width, columnGuides, horizontalGap);
      const rowRanges = buildGridRanges(sourceMetadata.height, rowGuides, verticalGap);
      const assets = [];
      for (let row = 0; row < rowRanges.length; row += 1) {
        for (let column = 0; column < columnRanges.length; column += 1) {
          const horizontal = columnRanges[column];
          const vertical = rowRanges[row];
          assets.push(await writeImageAsset({
            libraryDirectory,
            projectId,
            sourceUrl: imageUrl,
            operation: 'grid',
            image: sharp(sourcePath).extract({
              left: horizontal.start,
              top: vertical.start,
              width: horizontal.size,
              height: vertical.size,
            }),
            extraMetadata: {
              gridColumn: column,
              gridRow: row,
              gridColumns: columns,
              gridRows: rows,
              horizontalGap,
              verticalGap,
            },
          }));
        }
      }
      response.status(201).json({ success: true, assets });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/media/images/annotation', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.body?.projectId, '项目标识');
      const sourceUrl = String(request.body?.sourceUrl || '');
      resolveProjectAsset(libraryDirectory, projectId, 'images', sourceUrl);
      const buffer = decodePngDataUrl(request.body?.dataUrl);
      const mode = ['draw', 'mask', 'erase'].includes(request.body?.mode)
        ? request.body.mode
        : 'draw';
      const strokes = Array.isArray(request.body?.strokes) ? request.body.strokes : [];
      const asset = await writeImageAsset({
        libraryDirectory,
        projectId,
        sourceUrl,
        operation: 'annotation',
        image: sharp(buffer),
        extraMetadata: { annotationMode: mode, strokes },
      });
      response.status(201).json({ success: true, asset });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.put('/media/edits/:projectId/:nodeId', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.params.projectId, '项目标识');
      const nodeId = assertSafeSegment(request.params.nodeId, '节点标识');
      const state = {
        annotation: request.body?.annotation || null,
        mask: request.body?.mask || null,
        compare: request.body?.compare || null,
      };
      validateProjectMediaReferences(state, projectId);
      const edit = {
        projectId,
        nodeId,
        ...state,
        updatedAt: new Date().toISOString(),
      };
      const targetPath = editStatePath(libraryDirectory, projectId, nodeId);
      await mkdir(path.dirname(targetPath), { recursive: true });
      const temporaryPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(edit, null, 2), 'utf8');
      await rename(temporaryPath, targetPath);
      response.json({ success: true, edit });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.get('/media/edits/:projectId/:nodeId', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.params.projectId, '项目标识');
      const nodeId = assertSafeSegment(request.params.nodeId, '节点标识');
      const targetPath = editStatePath(libraryDirectory, projectId, nodeId);
      if (!fs.existsSync(targetPath)) {
        throw new MediaEditingError('编辑状态不存在', 404, 'EDIT_STATE_NOT_FOUND');
      }
      const edit = JSON.parse(await readFile(targetPath, 'utf8'));
      response.json({ success: true, edit });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/trim-video', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.body?.projectId || 'default', '项目标识');
      const videoUrl = String(request.body?.videoUrl || '');
      const inputPath = resolveProjectAsset(libraryDirectory, projectId, 'videos', videoUrl);
      const startTime = normalizeTime(request.body?.startTime, '开始时间');
      const endTime = normalizeTime(request.body?.endTime, '结束时间');
      if (endTime <= startTime) throw new MediaEditingError('结束时间必须晚于开始时间');
      const asset = await createOutputAsset({
        libraryDirectory,
        projectId,
        type: 'videos',
        extension: '.mp4',
        sourceUrl: videoUrl,
        operation: 'video-trim',
        metadata: { trimStart: startTime, trimEnd: endTime, duration: endTime - startTime },
        render: (outputPath) => ffmpegRunner({
          kind: 'video-trim', inputPath, outputPath, startTime, endTime,
        }),
      });
      response.json({
        success: true,
        url: asset.url,
        filename: asset.filename,
        duration: asset.duration,
        asset,
      });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/media/videos/frames', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.body?.projectId, '项目标识');
      const videoUrl = String(request.body?.videoUrl || '');
      const inputPath = resolveProjectAsset(libraryDirectory, projectId, 'videos', videoUrl);
      const times = Array.isArray(request.body?.times)
        ? request.body.times.map((time) => normalizeTime(time, '画面时间'))
        : [];
      if (times.length === 0 || times.length > 20) {
        throw new MediaEditingError('一次可提取 1 到 20 个画面');
      }
      const roles = Array.isArray(request.body?.roles) ? request.body.roles : [];
      const assets = [];
      for (let index = 0; index < times.length; index += 1) {
        const time = times[index];
        const role = ['first', 'last', 'screenshot'].includes(roles[index])
          ? roles[index]
          : 'screenshot';
        assets.push(await createOutputAsset({
          libraryDirectory,
          projectId,
          type: 'images',
          extension: '.png',
          sourceUrl: videoUrl,
          operation: 'video-frame',
          metadata: { frameTime: time, frameRole: role },
          render: (outputPath) => ffmpegRunner({
            kind: 'video-frame', inputPath, outputPath, time,
          }),
        }));
      }
      response.status(201).json({ success: true, assets });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/trim-audio', async (request, response) => {
    try {
      const projectId = assertSafeSegment(request.body?.projectId || 'default', '项目标识');
      const audioUrl = String(request.body?.audioUrl || '');
      const inputPath = resolveProjectAsset(libraryDirectory, projectId, 'audios', audioUrl);
      const startTime = normalizeTime(request.body?.startTime, '开始时间');
      const endTime = normalizeTime(request.body?.endTime, '结束时间');
      if (endTime <= startTime) throw new MediaEditingError('结束时间必须晚于开始时间');
      const asset = await createOutputAsset({
        libraryDirectory,
        projectId,
        type: 'audios',
        extension: '.mp3',
        sourceUrl: audioUrl,
        operation: 'audio-trim',
        metadata: { trimStart: startTime, trimEnd: endTime, duration: endTime - startTime },
        render: (outputPath) => ffmpegRunner({
          kind: 'audio-trim', inputPath, outputPath, startTime, endTime,
        }),
      });
      response.json({
        success: true,
        url: asset.url,
        filename: asset.filename,
        duration: asset.duration,
        asset,
      });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  return router;
}

export { MediaEditingError };
