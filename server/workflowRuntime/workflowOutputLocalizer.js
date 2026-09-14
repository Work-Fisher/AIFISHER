import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MediaArtifactError,
  resolveMediaArtifact,
} from '../media/mediaArtifact.js';
import { createMediaMetadataProbe, MediaProbeError } from '../media/mediaMetadataProbe.js';
import { WorkflowOutputError } from './workflowOutputs.js';
import { isComfyPreviewNode, isSavedComfyFile } from './comfySavedOutputs.js';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';
import { inspectWorkflowMedia, prepareWorkflowCompatibility, convertedIntegrity } from './workflowMediaCompatibility.js';
import {
  preparePrivateRecoveryRoot,
  quarantinePrivateRecoveryEntry,
  removeQuarantinedFlatDirectory,
} from './privateRecoveryDirectory.js';

const BUNDLED_FFMPEG_PATH = path.join(RUNTIME_PATHS.BIN_DIR, 'ffmpeg.exe');
const MAXIMUM_MEDIA_BYTES = resolveMediaArtifact({ declaredType: 'video' }).maximumBytes;

function safeSegment(value, label) {
  const normalized = String(value || '');
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.length > 255
    || /[\\/\0\r\n]/.test(normalized)
  ) {
    throw new WorkflowOutputError(`${label}无效`, 'INVALID_OUTPUT_REFERENCE');
  }
  return normalized;
}

function assertSafeInlineStrings(value, depth = 0) {
  if (depth > 32) {
    throw new WorkflowOutputError('工作流内联输出嵌套过深', 'UNSAFE_INLINE_OUTPUT');
  }
  if (typeof value === 'string') {
    const pathLike = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/))[^\s"'<>]*/i;
    const credentialLike = /(?:\b(?:api[_ -]?key|authorization|bearer|token|secret|password)\b\s*[:=]\s*\S+|\b(?:sk|rk|pk)[-_][A-Za-z0-9._-]{12,})/i;
    if (pathLike.test(value) || credentialLike.test(value)) {
      throw new WorkflowOutputError('工作流内联输出包含本机路径或凭证', 'UNSAFE_INLINE_OUTPUT');
    }
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      let url;
      try {
        url = new URL(match[0]);
      } catch {
        throw new WorkflowOutputError('工作流内联输出包含无效 URL', 'UNSAFE_INLINE_OUTPUT');
      }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())) {
        throw new WorkflowOutputError('工作流内联输出包含外部 URL', 'UNSAFE_INLINE_OUTPUT');
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeInlineStrings(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assertSafeInlineStrings(key, depth + 1);
    assertSafeInlineStrings(child, depth + 1);
  }
}

function responseStream(body) {
  if (!body) throw new WorkflowOutputError('工作流输出响应为空', 'OUTPUT_LOCALIZE_FAILED');
  return typeof body.getReader === 'function' ? Readable.fromWeb(body) : body;
}

function retryableDownloadError(error) {
  return Boolean(error?.retryable)
    || ['RUNNINGHUB_OUTPUT_DOWNLOAD_FAILED', 'RUNNINGHUB_REQUEST_TIMEOUT', 'RUNNINGHUB_UNAVAILABLE']
      .includes(error?.code);
}

async function downloadCandidate({
  client,
  candidate,
  temporaryPath,
  maximumBytes,
  signal,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  // RunningHub can publish the task result before its CDN object is readable.
  // Retrying this download is safe: it never resubmits the paid workflow task.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(temporaryPath, { force: true });
      const response = await client.openOutput(candidate.handle, { signal });
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        await response.body?.cancel?.().catch(() => undefined);
        throw new WorkflowOutputError('工作流输出超过本地化限制', 'OUTPUT_SIZE_LIMIT', 413);
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      let prefix = Buffer.alloc(0);
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maximumBytes) {
            callback(new WorkflowOutputError('工作流输出超过本地化限制', 'OUTPUT_SIZE_LIMIT', 413));
            return;
          }
          if (prefix.length < 512) prefix = Buffer.concat([prefix, buffer]).subarray(0, 512);
          hash.update(buffer);
          callback(null, buffer);
        },
      });
      await pipeline(
        responseStream(response.body),
        meter,
        fs.createWriteStream(temporaryPath, { flags: 'wx' }),
      );
      return { bytes, sha256: hash.digest('hex'), contentType, prefix };
    } catch (error) {
      if (signal?.aborted || attempt === 3 || !retryableDownloadError(error)) throw error;
      await wait(400 * (2 ** (attempt - 1)));
    }
  }
  throw new WorkflowOutputError('工作流输出下载失败', 'OUTPUT_LOCALIZE_FAILED');
}

async function inspectOptimizedMp4(filePath, maximumBytes) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(filePath)) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) {
      throw new WorkflowOutputError('优化后的视频超过本地化限制', 'OUTPUT_SIZE_LIMIT', 413);
    }
    if (prefix.length < 16) prefix = Buffer.concat([prefix, buffer]).subarray(0, 16);
    hash.update(buffer);
  }
  let artifact;
  try {
    artifact = resolveMediaArtifact({
      filename: filePath,
      declaredType: 'video',
      contentType: 'video/mp4',
      prefix,
      requireRecognizedContent: true,
    });
  } catch {
    throw new WorkflowOutputError('优化后的视频格式无效', 'OUTPUT_TYPE_MISMATCH');
  }
  if (artifact.kind !== 'video') {
    throw new WorkflowOutputError('优化后的视频格式无效', 'OUTPUT_TYPE_MISMATCH');
  }
  return { bytes, sha256: hash.digest('hex'), contentType: 'video/mp4' };
}

export async function optimizeMp4ForStreaming({
  inputPath,
  outputPath,
  maximumBytes,
  signal,
  metadata = {},
  spawnProcess = spawn,
}) {
  if (signal?.aborted) throw new WorkflowOutputError('视频优化已取消', 'OUTPUT_LOCALIZE_FAILED');
  await new Promise((resolve, reject) => {
    const child = spawnProcess(BUNDLED_FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-y',
      '-i', inputPath,
      '-map', '0:V:0',
      '-map', '0:a:0?',
      ...(metadata.videoCodec === 'h264' && ['yuv420p', 'yuvj420p'].includes(metadata.pixelFormat)
        ? ['-c:v', 'copy']
        : ['-c:v', 'libopenh264', '-b:v', String(Math.max(2_000_000, Math.min(50_000_000, (metadata.width || 1920) * (metadata.height || 1080) * 4))),
          '-vf', 'format=yuv420p,pad=ceil(iw/2)*2:ceil(ih/2)*2']),
      ...(metadata.audioCodec === 'aac' || !metadata.audioCodec
        ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']),
      '-movflags', '+faststart',
      '-f', 'mp4',
      outputPath,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
    timer.unref?.();
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stderr?.resume();
    child.once('error', () => finish(() => reject(
      new WorkflowOutputError('无法启动随包 FFmpeg 优化视频', 'OUTPUT_STREAM_OPTIMIZE_FAILED'),
    )));
    child.once('close', (code) => finish(() => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new WorkflowOutputError(
        '视频快速起播优化失败',
        'OUTPUT_STREAM_OPTIMIZE_FAILED',
      ));
    }));
  });
  return inspectOptimizedMp4(outputPath, maximumBytes);
}

function inlineOutput(candidate) {
  const serialized = JSON.stringify(candidate.value);
  const bytes = Buffer.byteLength(serialized || '', 'utf8');
  if (bytes > 1024 * 1024) {
    throw new WorkflowOutputError('文本或 JSON 输出超过 1 MiB', 'OUTPUT_SIZE_LIMIT', 413);
  }
  assertSafeInlineStrings(candidate.value);
  if (bytes > 64 * 1024) {
    throw new WorkflowOutputError('文本或 JSON 输出超过 64 KiB', 'OUTPUT_SIZE_LIMIT', 413);
  }
  return {
    nodeId: candidate.nodeId,
    classType: candidate.classType,
    outputKey: candidate.outputKey,
    outputIndex: candidate.outputIndex,
    mediaKind: candidate.mediaKind,
    value: candidate.value,
  };
}

async function writeManifestAtomic(manifestPath, manifest) {
  const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await rename(temporaryPath, manifestPath);
}

function manifestItemPaths({ libraryDirectory, projectId, item, runDirectory }) {
  let artifact;
  try {
    artifact = resolveMediaArtifact({
      filename: `artifact${String(item.extension || '')}`,
      declaredType: item.mediaKind,
    });
  } catch {
    throw new WorkflowOutputError('输出事务清单媒体类型无效', 'OUTPUT_STAGING_INTEGRITY_ERROR');
  }
  if (artifact.kind !== item.mediaKind || item.directory !== artifact.storageType) {
    throw new WorkflowOutputError('输出事务清单媒体类型无效', 'OUTPUT_STAGING_INTEGRITY_ERROR');
  }
  const assetId = safeSegment(item.assetId, '素材标识');
  const extension = String(item.extension || '').toLowerCase();
  if (artifact.extension !== extension) {
    throw new WorkflowOutputError('输出事务清单扩展名无效', 'OUTPUT_STAGING_INTEGRITY_ERROR');
  }
  const directory = path.resolve(libraryDirectory, 'media', projectId, artifact.storageType);
  const filename = `${assetId}${extension}`;
  return {
    temporaryPath: path.join(runDirectory, `${assetId}.tmp`),
    finalPath: path.join(directory, filename),
    metadataPath: path.join(directory, `${assetId}.json`),
    filename,
    directory,
  };
}

export async function localizeWorkflowOutputs({
  candidates,
  executionPlan,
  client,
  libraryDirectory,
  projectId,
  runId,
  signal,
  source = 'local-comfyui-workflow',
  model = 'Local ComfyUI Workflow',
  stagingDirectory = path.resolve(libraryDirectory, '..', 'private', 'execution-workflows', 'output-staging'),
  optimizeMp4 = optimizeMp4ForStreaming,
  probeMediaMetadata = createMediaMetadataProbe(),
  wait,
  logger = console,
}) {
  const safeProjectId = safeSegment(projectId, '项目标识');
  const safeRunId = safeSegment(runId, '运行标识');
  const runDirectory = path.resolve(stagingDirectory, safeRunId);
  const stagingRoot = path.resolve(stagingDirectory);
  if (path.dirname(runDirectory) !== stagingRoot) {
    throw new WorkflowOutputError('输出暂存目录无效', 'OUTPUT_STAGING_INTEGRITY_ERROR');
  }
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(runDirectory, { recursive: false });
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const manifest = {
    schemaVersion: 1,
    runId: safeRunId,
    projectId: safeProjectId,
    state: 'staging',
    items: [],
    updatedAt: new Date().toISOString(),
  };
  await writeManifestAtomic(manifestPath, manifest);
  const staged = [];
  const temporaryPaths = [];
  const publishedPaths = [];
  const outputs = [];
  try {
    for (const candidate of candidates) {
      if (source === 'local-comfyui-workflow') {
        if (isComfyPreviewNode(candidate.classType)) continue;
        if (candidate.kind === 'file' && !isSavedComfyFile(candidate, executionPlan)) continue;
      }
      if (candidate.kind !== 'file') {
        outputs.push(inlineOutput(candidate));
        continue;
      }
      const assetId = crypto.randomUUID();
      const originalFilename = String(candidate.handle.filename || '');
      const downloadPath = path.join(runDirectory, `${assetId}.tmp`);
      temporaryPaths.push(downloadPath);
      let integrity = await downloadCandidate({
        client,
        candidate,
        temporaryPath: downloadPath,
        maximumBytes: MAXIMUM_MEDIA_BYTES,
        signal,
        wait,
      });
      let artifact;
      try {
        artifact = await inspectWorkflowMedia({
          filePath: downloadPath,
          filename: originalFilename,
          declaredType: candidate.mediaKind,
          contentType: integrity.contentType,
          prefix: integrity.prefix,
          probeMediaMetadata,
        });
      } catch (error) {
        if (error instanceof MediaArtifactError || error instanceof MediaProbeError) {
          throw new WorkflowOutputError(
            '工作流输出文件内容与媒体类型不匹配',
            'OUTPUT_TYPE_MISMATCH',
          );
        }
        throw error;
      }
      if (integrity.bytes > artifact.maximumBytes) {
        throw new WorkflowOutputError('工作流输出超过本地化限制', 'OUTPUT_SIZE_LIMIT', 413);
      }
      let localizedPath = downloadPath;
      if (artifact.kind !== 'video') {
        const compatibilityPath = `${downloadPath}.${crypto.randomUUID()}.compatible`;
        temporaryPaths.push(compatibilityPath);
        const converted = await prepareWorkflowCompatibility({ inputPath: downloadPath, outputPath: compatibilityPath,
          artifact, signal, probeMediaMetadata });
        if (converted) {
          artifact = converted;
          integrity = await convertedIntegrity(compatibilityPath, artifact.maximumBytes, artifact.mimeType);
          localizedPath = compatibilityPath;
        }
      }
      const extension = artifact.kind === 'video' ? '.mp4' : artifact.extension;
      const config = {
        directory: artifact.storageType,
        maximumBytes: artifact.maximumBytes,
      };
      const normalizedCandidate = { ...candidate, mediaKind: artifact.kind };
      const item = {
        assetId,
        mediaKind: artifact.kind,
        directory: config.directory,
        extension,
        publishedFile: false,
        publishedMetadata: false,
      };
      const paths = manifestItemPaths({
        libraryDirectory,
        projectId: safeProjectId,
        item,
        runDirectory,
      });
      await mkdir(paths.directory, { recursive: true });
      const { finalPath, metadataPath, filename: finalFilename } = paths;
      if (artifact.kind === 'video') {
        const metadata = artifact.metadata || await probeMediaMetadata(downloadPath, 'videos');
        const requiresConversion = artifact.extension !== '.mp4'
          || (metadata.videoCodec && (metadata.videoCodec !== 'h264'
            || !['yuv420p', 'yuvj420p'].includes(metadata.pixelFormat)))
          || (metadata.audioCodec && metadata.audioCodec !== 'aac');
        const optimizedPath = `${downloadPath}.${crypto.randomUUID()}.faststart.mp4`;
        temporaryPaths.push(optimizedPath);
        try {
          integrity = await optimizeMp4({
            inputPath: downloadPath,
            outputPath: optimizedPath,
            maximumBytes: config.maximumBytes,
            signal,
            metadata,
          });
          await rm(downloadPath, { force: true });
          localizedPath = optimizedPath;
        } catch (error) {
          await rm(optimizedPath, { force: true });
          if (signal?.aborted) throw error;
          if (requiresConversion) {
            throw new WorkflowOutputError('视频已生成，但转换为画布可播放格式失败，请检查本机媒体组件。原文件未在工作流端被修改。', 'OUTPUT_PLAYBACK_CONVERSION_FAILED');
          }
          logger.warn('Workflow MP4 fast-start optimization skipped', {
            code: error?.code || 'OUTPUT_STREAM_OPTIMIZE_FAILED',
          });
        }
      }
      staged.push({
        candidate: normalizedCandidate,
        config,
        assetId,
        finalFilename,
        finalPath,
        metadataPath,
        temporaryPath: localizedPath,
        integrity,
        manifestItem: item,
      });
      manifest.items.push(item);
      manifest.updatedAt = new Date().toISOString();
      await writeManifestAtomic(manifestPath, manifest);
    }

    if (staged.length === 0 && outputs.length === 0) {
      throw new WorkflowOutputError(
        '没有可保存的工作流结果。请使用保存节点并开启保存输出。',
        'OUTPUT_NOT_FOUND',
      );
    }

    for (const item of staged) {
      await rename(item.temporaryPath, item.finalPath);
      publishedPaths.push(item.finalPath);
      item.manifestItem.publishedFile = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifestAtomic(manifestPath, manifest);
      const metadata = {
        id: item.assetId,
        filename: item.finalFilename,
        nodeId: item.candidate.nodeId,
        model,
        type: item.config.directory,
        sourceRunId: safeRunId,
        sha256: item.integrity.sha256,
        bytes: item.integrity.bytes,
        source,
        createdAt: new Date().toISOString(),
      };
      await writeFile(item.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
      publishedPaths.push(item.metadataPath);
      item.manifestItem.publishedMetadata = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifestAtomic(manifestPath, manifest);
      outputs.push({
        nodeId: item.candidate.nodeId,
        classType: item.candidate.classType,
        ...(source === 'local-comfyui-workflow' ? { comfyOutput: { type: 'output', saved: true } } : {}),
        outputKey: item.candidate.outputKey,
        outputIndex: item.candidate.outputIndex,
        mediaKind: item.candidate.mediaKind,
        assetId: item.assetId,
        url: `/library/media/${encodeURIComponent(safeProjectId)}/${item.config.directory}/${encodeURIComponent(item.finalFilename)}`,
        sha256: item.integrity.sha256,
        bytes: item.integrity.bytes,
      });
    }
    manifest.state = 'published';
    manifest.updatedAt = new Date().toISOString();
    await writeManifestAtomic(manifestPath, manifest);
    return {
      outputs,
      rollback: async () => {
        await Promise.all(publishedPaths.map((filePath) => rm(filePath, { force: true })));
        await rm(runDirectory, { recursive: true, force: true });
      },
      commit: () => rm(runDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await Promise.all([
      ...temporaryPaths.map((filePath) => rm(filePath, { force: true })),
      ...publishedPaths.map((filePath) => rm(filePath, { force: true })),
    ]);
    await rm(runDirectory, { recursive: true, force: true });
    if (error instanceof WorkflowOutputError) throw error;
    throw new WorkflowOutputError('工作流输出本地化失败', 'OUTPUT_LOCALIZE_FAILED');
  }
}

export async function recoverWorkflowOutputStaging({
  stagingDirectory,
  libraryDirectory,
  runStore,
  logger = console,
}) {
  const { root: stagingRoot, realRoot } = await preparePrivateRecoveryRoot(stagingDirectory);
  const entries = await readdir(stagingRoot, { withFileTypes: true });
  const recovered = [];
  for (const entry of entries) {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(entry.name)
      || !entry.isDirectory()
      || entry.isSymbolicLink()) continue;
    let runDirectory = null;
    try {
      runDirectory = await quarantinePrivateRecoveryEntry({
        root: stagingRoot,
        realRoot,
        entryName: entry.name,
      });
      const manifest = JSON.parse(await readFile(path.join(runDirectory, 'manifest.json'), 'utf8'));
      const runId = safeSegment(manifest.runId, '运行标识');
      const projectId = safeSegment(manifest.projectId, '项目标识');
      if (runId !== entry.name || !Array.isArray(manifest.items) || manifest.items.length > 1_000) {
        throw new WorkflowOutputError('输出事务清单无效', 'OUTPUT_STAGING_INTEGRITY_ERROR');
      }
      let committed = false;
      try {
        await runStore.requireReceipt(runId);
        committed = true;
      } catch (error) {
        if (error?.code !== 'TEST_RUN_RECEIPT_NOT_FOUND') throw error;
      }
      if (!committed) {
        for (const item of manifest.items) {
          const paths = manifestItemPaths({ libraryDirectory, projectId, item, runDirectory });
          await Promise.all([
            rm(paths.finalPath, { force: true }),
            rm(paths.metadataPath, { force: true }),
          ]);
        }
      }
      await removeQuarantinedFlatDirectory({ directory: runDirectory, realRoot });
      recovered.push({ runId, action: committed ? 'committed-cleanup' : 'rolled-back' });
    } catch (error) {
      if (runDirectory) {
        await removeQuarantinedFlatDirectory({ directory: runDirectory, realRoot })
          .catch(() => undefined);
      }
      logger.error('Workflow output staging recovery failed', {
        entry: entry.name,
        code: error?.code || 'OUTPUT_STAGING_RECOVERY_FAILED',
      });
    }
  }
  return recovered;
}
