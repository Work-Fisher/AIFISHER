import crypto from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rmdir,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import {
  preparePrivateRecoveryRoot,
  quarantinePrivateRecoveryEntry,
  removeQuarantinedFlatDirectory,
} from './privateRecoveryDirectory.js';

const TYPE_DIRECTORIES = Object.freeze({
  image: 'images',
  mask: 'images',
  video: 'videos',
  audio: 'audios',
});
const SAFE_RUN_ID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

export class WorkflowAssetError extends Error {
  constructor(message, code = 'INVALID_WORKFLOW_ASSET', status = 400) {
    super(message);
    this.name = 'WorkflowAssetError';
    this.code = code;
    this.status = status;
  }
}

function safeSegment(value, label) {
  const normalized = String(value || '');
  if (
    !normalized
    || normalized.length > 255
    || normalized === '.'
    || normalized === '..'
    || /[\\/\0\r\n]/.test(normalized)
  ) {
    throw new WorkflowAssetError(`${label}无效`, 'INVALID_WORKFLOW_ASSET_REFERENCE');
  }
  return normalized;
}

function isInsideOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameFileVersion(left, right) {
  const stableIdentity = [left?.dev, left?.ino, right?.dev, right?.ino]
    .every((value) => Number.isFinite(value))
    && left.ino !== 0
    && right.ino !== 0;
  const identityMatches = stableIdentity
    ? left.dev === right.dev && left.ino === right.ino
    : true;
  return identityMatches
    && left?.size === right?.size
    && left?.mtimeMs === right?.mtimeMs
    && left?.ctimeMs === right?.ctimeMs;
}

async function hashAndSnapshot(filePath, maximumBytes, { initialInfo, snapshotPath } = {}) {
  const source = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let target = null;
  let succeeded = false;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    const before = await source.stat();
    if (!before.isFile() || (initialInfo && !sameFileVersion(initialInfo, before))) {
      throw new WorkflowAssetError('素材在校验期间发生变化', 'WORKFLOW_ASSET_INTEGRITY_ERROR', 409);
    }
    if (snapshotPath) target = await open(snapshotPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > maximumBytes) {
        throw new WorkflowAssetError('素材超过工作流暂存限制', 'WORKFLOW_ASSET_SIZE_LIMIT', 413);
      }
      hash.update(buffer.subarray(0, bytesRead));
      if (target) {
        let written = 0;
        while (written < bytesRead) {
          const result = await target.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          );
          if (result.bytesWritten <= 0) {
            throw new WorkflowAssetError(
              '素材私有快照写入失败',
              'WORKFLOW_ASSET_SNAPSHOT_WRITE_FAILED',
              500,
            );
          }
          written += result.bytesWritten;
        }
      }
      position += bytesRead;
    }
    const after = await source.stat();
    if (!sameFileVersion(before, after)) {
      throw new WorkflowAssetError('素材在校验期间发生变化', 'WORKFLOW_ASSET_INTEGRITY_ERROR', 409);
    }
    await target?.sync();
    succeeded = true;
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await target?.close().catch(() => undefined);
    await source.close().catch(() => undefined);
    if (!succeeded && snapshotPath) await rm(snapshotPath, { force: true }).catch(() => undefined);
  }
}

export async function recoverWorkflowAssetSnapshots(snapshotRoot) {
  const { root, realRoot } = await preparePrivateRecoveryRoot(snapshotRoot);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!SAFE_RUN_ID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const quarantined = await quarantinePrivateRecoveryEntry({
      root,
      realRoot,
      entryName: entry.name,
    });
    await removeQuarantinedFlatDirectory({ directory: quarantined, realRoot });
  }
}

export class WorkflowAssetResolver {
  constructor({
    libraryDirectory,
    snapshotRoot,
    maximumBytes = 4 * 1024 * 1024 * 1024,
  }) {
    this.libraryDirectory = path.resolve(libraryDirectory);
    this.mediaDirectory = path.resolve(libraryDirectory, 'media');
    this.snapshotRoot = snapshotRoot ? path.resolve(snapshotRoot) : null;
    if (this.snapshotRoot && isInsideOrEqual(this.libraryDirectory, this.snapshotRoot)) {
      throw new Error('Workflow asset snapshots must be stored outside the public library');
    }
    this.maximumBytes = maximumBytes;
  }

  async resolve(reference, { stagedValue, snapshotRunId, maximumBytes } = {}) {
    const projectId = safeSegment(reference?.projectId, '项目标识');
    const assetId = safeSegment(reference?.assetId, '素材标识');
    const type = String(reference?.type || '');
    const typeDirectory = TYPE_DIRECTORIES[type];
    if (!typeDirectory) {
      throw new WorkflowAssetError('素材类型无效', 'INVALID_WORKFLOW_ASSET_TYPE');
    }
    const directory = path.resolve(this.mediaDirectory, projectId, typeDirectory);
    const metadataFilePath = path.resolve(directory, `${assetId}.json`);
    if (!isInsideOrEqual(directory, metadataFilePath)) {
      throw new WorkflowAssetError('素材路径超出项目目录', 'WORKFLOW_ASSET_PATH_ESCAPE', 403);
    }

    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataFilePath, 'utf8'));
    } catch {
      throw new WorkflowAssetError('项目素材不存在', 'ASSET_NOT_FOUND', 404);
    }
    if (String(metadata?.id || '') !== assetId) {
      throw new WorkflowAssetError('素材元数据标识不匹配', 'WORKFLOW_ASSET_INTEGRITY_ERROR', 409);
    }
    const filename = safeSegment(metadata.filename, '素材文件名');
    const filePath = path.resolve(directory, filename);
    if (!isInsideOrEqual(directory, filePath)) {
      throw new WorkflowAssetError('素材路径超出项目目录', 'WORKFLOW_ASSET_PATH_ESCAPE', 403);
    }
    const [directoryRoot, resolvedFile, fileInfo] = await Promise.all([
      realpath(directory).catch(() => null),
      realpath(filePath).catch(() => null),
      lstat(filePath).catch(() => null),
    ]);
    if (
      !directoryRoot
      || !resolvedFile
      || !fileInfo?.isFile()
      || fileInfo.isSymbolicLink()
      || !isInsideOrEqual(directoryRoot, resolvedFile)
    ) {
      throw new WorkflowAssetError('素材文件无效或已经移动', 'ASSET_NOT_FOUND', 404);
    }
    let snapshotPath = null;
    let snapshotDirectory = null;
    if (snapshotRunId !== undefined) {
      const runId = String(snapshotRunId || '');
      if (!this.snapshotRoot || !SAFE_RUN_ID.test(runId)) {
        throw new WorkflowAssetError('素材快照运行标识无效', 'INVALID_WORKFLOW_ASSET_REFERENCE');
      }
      await mkdir(this.snapshotRoot, { recursive: true });
      const rootInfo = await lstat(this.snapshotRoot);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        throw new WorkflowAssetError('素材快照目录无效', 'WORKFLOW_ASSET_PATH_ESCAPE', 403);
      }
      snapshotDirectory = path.resolve(this.snapshotRoot, runId);
      if (path.dirname(snapshotDirectory) !== this.snapshotRoot) {
        throw new WorkflowAssetError('素材快照路径无效', 'WORKFLOW_ASSET_PATH_ESCAPE', 403);
      }
      await mkdir(snapshotDirectory, { recursive: true });
      const snapshotDirectoryInfo = await lstat(snapshotDirectory);
      if (!snapshotDirectoryInfo.isDirectory() || snapshotDirectoryInfo.isSymbolicLink()) {
        throw new WorkflowAssetError('素材快照目录无效', 'WORKFLOW_ASSET_PATH_ESCAPE', 403);
      }
      snapshotPath = path.join(
        snapshotDirectory,
        `${crypto.randomUUID()}${path.extname(filename).toLowerCase() || '.bin'}`,
      );
    }
    const effectiveMaximumBytes = Math.min(
      this.maximumBytes,
      Number.isFinite(Number(maximumBytes)) && Number(maximumBytes) > 0
        ? Number(maximumBytes)
        : this.maximumBytes,
    );
    const integrity = await hashAndSnapshot(resolvedFile, effectiveMaximumBytes, {
      initialInfo: fileInfo,
      snapshotPath,
    });
    if (metadata.sha256 && metadata.sha256 !== integrity.sha256) {
      if (snapshotPath) await rm(snapshotPath, { force: true });
      throw new WorkflowAssetError('素材内容完整性校验失败', 'WORKFLOW_ASSET_INTEGRITY_ERROR', 409);
    }
    const disposeSnapshot = snapshotPath
      ? async () => {
        await rm(snapshotPath, { force: true });
        await rmdir(snapshotDirectory).catch(() => undefined);
      }
      : undefined;
    return {
      assetId,
      projectId,
      type,
      filePath: snapshotPath || resolvedFile,
      filename,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
      value: stagedValue || `__FISHERAI_ASSET__/${assetId}`,
      ...(disposeSnapshot ? { disposeSnapshot } : {}),
    };
  }
}
