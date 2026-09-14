import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import sharp from 'sharp';
import { MediaArtifactError, resolveMediaArtifact } from '../media/mediaArtifact.js';
import { createMediaMetadataProbe } from '../media/mediaMetadataProbe.js';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';

export const RUNNINGHUB_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
export const RUNNINGHUB_UPLOAD_TARGET_BYTES = 29 * 1024 * 1024;

const BUNDLED_FFMPEG_PATH = path.join(RUNTIME_PATHS.BIN_DIR, 'ffmpeg.exe');

export class RunningHubUploadAdapterError extends Error {
  constructor(message, code = 'RUNNINGHUB_UPLOAD_ADAPT_FAILED', status = 422) {
    super(message);
    this.name = 'RunningHubUploadAdapterError';
    this.code = code;
    this.status = status;
    this.retryable = false;
  }
}

function adaptedPath(asset, extension) {
  return path.join(path.dirname(asset.filePath), `${crypto.randomUUID()}${extension}`);
}

async function compressImage({ inputPath, outputPath, targetBytes }) {
  const metadata = await sharp(inputPath, { animated: false }).metadata();
  const sourceWidth = Number(metadata.width) || null;
  let scale = 1;
  let quality = 84;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await rm(outputPath, { force: true });
    let pipeline = sharp(inputPath, { animated: false }).rotate();
    if (sourceWidth && scale < 1) {
      pipeline = pipeline.resize({
        width: Math.max(64, Math.floor(sourceWidth * scale)),
        withoutEnlargement: true,
      });
    }
    await pipeline.webp({ quality, effort: 4 }).toFile(outputPath);
    const output = await stat(outputPath);
    if (output.size <= targetBytes) return output;
    scale *= 0.78;
    quality = Math.max(40, quality - 7);
  }

  throw new RunningHubUploadAdapterError('图片无法压缩到 RunningHub 上传限制以内');
}

function runFfmpeg(args, { signal, spawnProcess = spawn, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RunningHubUploadAdapterError('素材处理已取消', 'RUNNINGHUB_UPLOAD_ADAPT_ABORTED', 499));
      return;
    }
    let child;
    try {
      child = spawnProcess(BUNDLED_FFMPEG_PATH, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch {
      reject(new RunningHubUploadAdapterError('无法启动随包媒体处理组件'));
      return;
    }

    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => child.kill();
    const timer = setTimeout(() => child.kill(), timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    child.once('error', () => finish(() => reject(
      new RunningHubUploadAdapterError('无法启动随包媒体处理组件'),
    )));
    child.once('close', (code) => finish(() => {
      if (signal?.aborted) {
        reject(new RunningHubUploadAdapterError(
          '素材处理已取消',
          'RUNNINGHUB_UPLOAD_ADAPT_ABORTED',
          499,
        ));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new RunningHubUploadAdapterError(
          stderr ? '视频或音频压缩失败' : '随包媒体处理组件不可用',
        ));
      }
    }));
  });
}

async function compressMedia({
  inputPath,
  outputPath,
  type,
  targetBytes,
  signal,
  probeMediaMetadata = createMediaMetadataProbe(),
  spawnProcess = spawn,
}) {
  const artifact = resolveMediaArtifact({ declaredType: type });
  const metadata = await probeMediaMetadata(inputPath, artifact.storageType);
  const duration = Number(metadata.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RunningHubUploadAdapterError('无法读取视频或音频时长');
  }

  let totalBitrate = Math.max(12_000, Math.floor((targetBytes * 8 * 0.84) / duration));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rm(outputPath, { force: true });
    const audioBitrate = Math.min(192_000, Math.max(8_000, Math.floor(totalBitrate * 0.12)));
    const args = type === 'video'
      ? [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-i', inputPath,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', 'scale=min(1920\\,iw):-2',
          '-c:v', 'libopenh264',
          '-b:v', String(Math.max(32_000, Math.min(8_000_000, totalBitrate - audioBitrate))),
          '-maxrate', String(Math.max(32_000, Math.min(8_000_000, totalBitrate - audioBitrate))),
          '-bufsize', String(Math.max(64_000, Math.min(16_000_000, (totalBitrate - audioBitrate) * 2))),
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', String(audioBitrate),
          '-movflags', '+faststart',
          outputPath,
        ]
      : [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-i', inputPath,
          '-vn', '-c:a', 'aac',
          '-b:a', String(Math.min(192_000, Math.max(8_000, totalBitrate))),
          '-movflags', '+faststart',
          outputPath,
        ];
    await runFfmpeg(args, { signal, spawnProcess });
    const output = await stat(outputPath);
    if (output.size <= targetBytes) return output;
    totalBitrate = Math.max(12_000, Math.floor(totalBitrate * (targetBytes / output.size) * 0.82));
  }

  throw new RunningHubUploadAdapterError('视频或音频无法压缩到 RunningHub 上传限制以内');
}

export async function prepareRunningHubUploadAsset(asset, {
  maximumBytes = RUNNINGHUB_UPLOAD_MAX_BYTES,
  targetBytes = RUNNINGHUB_UPLOAD_TARGET_BYTES,
  signal,
  imageCompressor = compressImage,
  mediaCompressor = compressMedia,
} = {}) {
  const source = await stat(asset.filePath);
  if (source.size <= maximumBytes) return asset;

  const declaredType = asset.type === 'mask' ? 'image' : asset.type;
  let sourceArtifact;
  let targetArtifact;
  try {
    resolveMediaArtifact({ declaredType });
    sourceArtifact = resolveMediaArtifact({
      filename: asset.filename,
      declaredType,
    });
    targetArtifact = resolveMediaArtifact({
      filename: sourceArtifact.kind === 'image'
        ? 'adapted.webp'
        : sourceArtifact.kind === 'video'
          ? 'adapted.mp4'
          : 'adapted.m4a',
      declaredType: sourceArtifact.kind,
    });
  } catch (error) {
    if (!(error instanceof MediaArtifactError)) throw error;
    throw new RunningHubUploadAdapterError('RunningHub 素材类型无法压缩');
  }
  const type = sourceArtifact.kind;
  const extension = targetArtifact.extension;

  const effectiveTarget = Math.min(targetBytes, maximumBytes - 1);
  const outputPath = adaptedPath(asset, extension);
  try {
    const output = type === 'image'
      ? await imageCompressor({ inputPath: asset.filePath, outputPath, targetBytes: effectiveTarget })
      : await mediaCompressor({
          inputPath: asset.filePath,
          outputPath,
          type,
          targetBytes: effectiveTarget,
          signal,
        });
    if (!output.isFile() || output.size > effectiveTarget) {
      throw new RunningHubUploadAdapterError('素材无法压缩到 RunningHub 上传限制以内');
    }

    const disposeOriginal = asset.disposeSnapshot;
    let disposed = false;
    return {
      ...asset,
      filePath: outputPath,
      filename: `${path.parse(asset.filename).name}${extension}`,
      bytes: output.size,
      async disposeSnapshot() {
        if (disposed) return;
        disposed = true;
        await rm(outputPath, { force: true });
        await disposeOriginal?.();
      },
    };
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    await asset.disposeSnapshot?.().catch(() => undefined);
    if (error instanceof RunningHubUploadAdapterError) throw error;
    throw new RunningHubUploadAdapterError('素材无法压缩到 RunningHub 上传限制以内');
  }
}
