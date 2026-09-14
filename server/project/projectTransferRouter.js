import crypto from 'node:crypto';
import fs from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import * as tar from 'tar';

const ARCHIVE_FORMAT = 'fisherai-project';
const LIBRARY_ARCHIVE_FORMAT = 'fisherai-library';
const ARCHIVE_VERSION = 1;
const DEFAULT_MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 20_000;

class ProjectTransferError extends Error {
  constructor(message, status = 400, code = 'INVALID_PROJECT_ARCHIVE') {
    super(message);
    this.name = 'ProjectTransferError';
    this.status = status;
    this.code = code;
  }
}

function sanitizeDownloadName(value) {
  return String(value || 'project')
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim() || 'project';
}

function normalizeArchivePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/\/+$/, '');
}

function isAllowedArchiveEntry(entryPath) {
  const normalized = normalizeArchivePath(entryPath);
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..' || part === '')) return false;
  return (
    normalized === 'manifest.json' ||
    normalized === 'workflow.json' ||
    normalized === 'media' ||
    normalized.startsWith('media/')
  );
}

function isAllowedLibraryArchiveEntry(entryPath) {
  const normalized = normalizeArchivePath(entryPath);
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..' || part === '')) return false;
  return (
    normalized === 'manifest.json' ||
    normalized === 'catalog.json' ||
    normalized === 'files' ||
    normalized === 'files/media' ||
    normalized.startsWith('files/media/') ||
    normalized === 'files/assets' ||
    normalized.startsWith('files/assets/') ||
    normalized === 'files/prompts' ||
    normalized.startsWith('files/prompts/') ||
    normalized === 'files/workflows' ||
    normalized.startsWith('files/workflows/')
  );
}

function isAllowedArchiveType(type) {
  return type === 'File' || type === 'Directory';
}

function isSafePathSegment(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  );
}

function validateLibraryCatalog(manifest, catalog) {
  if (!Array.isArray(catalog?.workflows) || !Array.isArray(catalog?.folders)) {
    throw new ProjectTransferError('整库备份目录无效');
  }
  if (
    Number(manifest?.workflowCount) !== catalog.workflows.length ||
    Number(manifest?.folderCount) !== catalog.folders.length
  ) {
    throw new ProjectTransferError('整库备份清单数量与目录不一致');
  }

  const folderIds = new Set();
  for (const folder of catalog.folders) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder) || !folder.id) {
      throw new ProjectTransferError('整库备份包含无效文件夹');
    }
    if (folderIds.has(folder.id)) {
      throw new ProjectTransferError(`整库备份包含重复文件夹标识：${folder.id}`);
    }
    folderIds.add(folder.id);
  }
  for (const folder of catalog.folders) {
    if (folder.parentId && !folderIds.has(folder.parentId)) {
      throw new ProjectTransferError(`整库备份文件夹的父级不存在：${folder.id}`);
    }
  }

  const workflowIds = new Set();
  for (const workflow of catalog.workflows) {
    if (
      !workflow ||
      typeof workflow !== 'object' ||
      Array.isArray(workflow) ||
      !isSafePathSegment(workflow.id) ||
      !Array.isArray(workflow.nodes) ||
      !Array.isArray(workflow.groups)
    ) {
      throw new ProjectTransferError('整库备份包含无效工作流');
    }
    if (workflowIds.has(workflow.id)) {
      throw new ProjectTransferError(`整库备份包含重复工作流标识：${workflow.id}`);
    }
    if (workflow.folderId && !folderIds.has(workflow.folderId)) {
      throw new ProjectTransferError(`整库备份工作流的文件夹不存在：${workflow.id}`);
    }
    workflowIds.add(workflow.id);
  }
}

async function copyNewTree(sourceDirectory, targetDirectory, createdPaths) {
  if (!fs.existsSync(sourceDirectory)) return;
  if (!fs.existsSync(targetDirectory)) {
    await mkdir(targetDirectory, { recursive: true });
    createdPaths.push(targetDirectory);
  }

  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyNewTree(sourcePath, targetPath, createdPaths);
    } else if (entry.isFile() && !fs.existsSync(targetPath)) {
      await cp(sourcePath, targetPath, { force: false, errorOnExist: true });
      createdPaths.push(targetPath);
    }
  }
}

async function removeCreatedPaths(createdPaths) {
  const uniquePaths = [...new Set(createdPaths)].sort((a, b) => b.length - a.length);
  for (const createdPath of uniquePaths) {
    await rm(createdPath, { recursive: true, force: true });
  }
}

function rewriteProjectMediaReferences(value, sourceId, targetId) {
  if (typeof value === 'string') {
    return value.replaceAll(
      `/library/media/${sourceId}/`,
      `/library/media/${targetId}/`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteProjectMediaReferences(item, sourceId, targetId));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      rewriteProjectMediaReferences(item, sourceId, targetId),
    ]),
  );
}

async function createProjectArchive({ workflow, mediaDirectory }) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fisherai-project-backup-'));
  const stagingDirectory = path.join(temporaryDirectory, 'staging');
  const archivePath = path.join(temporaryDirectory, 'project.fisherai');

  try {
    await mkdir(stagingDirectory, { recursive: true });
    await writeFile(
      path.join(stagingDirectory, 'manifest.json'),
      JSON.stringify(
        {
          format: ARCHIVE_FORMAT,
          version: ARCHIVE_VERSION,
          createdAt: new Date().toISOString(),
          project: { id: workflow.id, title: workflow.title || 'Untitled' },
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(stagingDirectory, 'workflow.json'),
      JSON.stringify(workflow, null, 2),
      'utf8',
    );

    const sourceMediaDirectory = path.join(mediaDirectory, workflow.id);
    if (fs.existsSync(sourceMediaDirectory)) {
      await cp(sourceMediaDirectory, path.join(stagingDirectory, 'media'), { recursive: true });
    }

    const entries = ['manifest.json', 'workflow.json'];
    if (fs.existsSync(path.join(stagingDirectory, 'media'))) entries.push('media');
    await tar.create(
      {
        cwd: stagingDirectory,
        file: archivePath,
        gzip: true,
        portable: true,
      },
      entries,
    );

    return { archivePath, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function createLibraryArchive({ store, libraryDirectory }) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fisherai-library-backup-'));
  const stagingDirectory = path.join(temporaryDirectory, 'staging');
  const filesDirectory = path.join(stagingDirectory, 'files');
  const archivePath = path.join(temporaryDirectory, 'library.fisherai-library');

  try {
    await mkdir(filesDirectory, { recursive: true });
    const catalog = await store.exportLibraryCatalog();
    await writeFile(
      path.join(stagingDirectory, 'manifest.json'),
      JSON.stringify(
        {
          format: LIBRARY_ARCHIVE_FORMAT,
          version: ARCHIVE_VERSION,
          createdAt: new Date().toISOString(),
          workflowCount: catalog.workflows.length,
          folderCount: catalog.folders.length,
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(stagingDirectory, 'catalog.json'),
      JSON.stringify(catalog, null, 2),
      'utf8',
    );

    for (const directoryName of ['media', 'assets', 'prompts', 'workflows']) {
      const sourceDirectory = path.join(libraryDirectory, directoryName);
      if (!fs.existsSync(sourceDirectory)) continue;
      await cp(sourceDirectory, path.join(filesDirectory, directoryName), {
        recursive: true,
        filter(sourcePath) {
          const relativePath = path.relative(sourceDirectory, sourcePath);
          return !relativePath.split(path.sep).includes('.thumbnails');
        },
      });
    }

    const entries = ['manifest.json', 'catalog.json'];
    if (fs.existsSync(filesDirectory)) entries.push('files');
    await tar.create(
      {
        cwd: stagingDirectory,
        file: archivePath,
        gzip: true,
        portable: true,
      },
      entries,
    );
    return { archivePath, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function receiveArchive(request, archivePath, maxArchiveBytes) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > maxArchiveBytes) {
    throw new ProjectTransferError('项目备份文件过大', 413, 'ARCHIVE_TOO_LARGE');
  }

  let receivedBytes = 0;
  const sizeGuard = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxArchiveBytes) {
        callback(new ProjectTransferError('项目备份文件过大', 413, 'ARCHIVE_TOO_LARGE'));
        return;
      }
      callback(null, chunk);
    },
  });

  await pipeline(request, sizeGuard, fs.createWriteStream(archivePath, { flags: 'wx' }));
  if (receivedBytes === 0) {
    throw new ProjectTransferError('项目备份文件为空');
  }
}

// The desktop page names a local archive; it is read in place, never copied, so the same
// size limit applies to the file itself.
async function statLocalArchive(value, maxArchiveBytes) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new ProjectTransferError('项目备份路径无效', 400, 'ARCHIVE_PATH_INVALID');
  }
  let stats;
  try {
    stats = await stat(value);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new ProjectTransferError('项目备份文件不存在', 404, 'ARCHIVE_NOT_FOUND');
    }
    throw new ProjectTransferError('无法读取项目备份文件');
  }
  if (!stats.isFile()) throw new ProjectTransferError('项目备份路径不是文件', 400, 'ARCHIVE_PATH_INVALID');
  if (stats.size > maxArchiveBytes) {
    throw new ProjectTransferError('项目备份文件过大', 413, 'ARCHIVE_TOO_LARGE');
  }
  if (stats.size === 0) throw new ProjectTransferError('项目备份文件为空');
  return value;
}

async function validateArchive(
  archivePath,
  maxArchiveEntries,
  {
    isAllowedEntry = isAllowedArchiveEntry,
    requiredEntries = ['manifest.json', 'workflow.json'],
    label = '项目备份',
  } = {},
) {
  let entryCount = 0;
  let validationError = null;
  const seenEntries = new Set();

  try {
    await tar.list({
      file: archivePath,
      strict: true,
      onentry(entry) {
        entryCount += 1;
        const entryPath = normalizeArchivePath(entry.path);
        if (!validationError && entryCount > maxArchiveEntries) {
          validationError = new ProjectTransferError(
            '项目备份文件包含过多文件',
            413,
            'TOO_MANY_ENTRIES',
          );
        } else if (
          !validationError &&
          (!isAllowedEntry(entryPath) || !isAllowedArchiveType(entry.type))
        ) {
          validationError = new ProjectTransferError(`${label}包含不安全条目：${entryPath}`);
        } else if (!validationError && seenEntries.has(entryPath)) {
          validationError = new ProjectTransferError(`${label}包含重复条目：${entryPath}`);
        }
        seenEntries.add(entryPath);
      },
    });
  } catch (error) {
    if (error instanceof ProjectTransferError) throw error;
    throw new ProjectTransferError('无法读取项目备份文件');
  }

  if (validationError) throw validationError;

  const missingEntries = requiredEntries.filter((entry) => !seenEntries.has(entry));
  if (missingEntries.length > 0) {
    throw new ProjectTransferError(`${label}缺少 ${missingEntries.join(' 或 ')}`);
  }
}

async function readProjectArchive({ archivePath, extractionDirectory, maxArchiveEntries }) {
  await validateArchive(archivePath, maxArchiveEntries);
  await mkdir(extractionDirectory, { recursive: true });
  try {
    await tar.extract({
      cwd: extractionDirectory,
      file: archivePath,
      preservePaths: false,
      strict: true,
      filter(entryPath, entry) {
        return isAllowedArchiveEntry(entryPath) && isAllowedArchiveType(entry.type);
      },
    });
  } catch {
    throw new ProjectTransferError('项目备份解压失败');
  }

  let manifest;
  let workflow;
  try {
    manifest = JSON.parse(await readFile(path.join(extractionDirectory, 'manifest.json'), 'utf8'));
    workflow = JSON.parse(await readFile(path.join(extractionDirectory, 'workflow.json'), 'utf8'));
  } catch {
    throw new ProjectTransferError('项目备份中的 JSON 已损坏');
  }

  if (manifest?.format !== ARCHIVE_FORMAT || manifest?.version !== ARCHIVE_VERSION) {
    throw new ProjectTransferError('不支持的 AIFISHER 项目备份版本');
  }
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new ProjectTransferError('项目备份中的工作流无效');
  }
  if (!workflow.id || manifest?.project?.id !== workflow.id) {
    throw new ProjectTransferError('项目备份标识不一致');
  }

  return { manifest, workflow };
}

async function readLibraryArchive({ archivePath, extractionDirectory, maxArchiveEntries }) {
  await validateArchive(archivePath, maxArchiveEntries, {
    isAllowedEntry: isAllowedLibraryArchiveEntry,
    requiredEntries: ['manifest.json', 'catalog.json'],
    label: '整库备份',
  });
  await mkdir(extractionDirectory, { recursive: true });
  try {
    await tar.extract({
      cwd: extractionDirectory,
      file: archivePath,
      preservePaths: false,
      strict: true,
      filter(entryPath, entry) {
        return isAllowedLibraryArchiveEntry(entryPath) && isAllowedArchiveType(entry.type);
      },
    });
  } catch {
    throw new ProjectTransferError('整库备份解压失败');
  }

  let manifest;
  let catalog;
  try {
    manifest = JSON.parse(await readFile(path.join(extractionDirectory, 'manifest.json'), 'utf8'));
    catalog = JSON.parse(await readFile(path.join(extractionDirectory, 'catalog.json'), 'utf8'));
  } catch {
    throw new ProjectTransferError('整库备份中的 JSON 已损坏');
  }
  if (manifest?.format !== LIBRARY_ARCHIVE_FORMAT || manifest?.version !== ARCHIVE_VERSION) {
    throw new ProjectTransferError('不支持的 AIFISHER 整库备份版本');
  }
  validateLibraryCatalog(manifest, catalog);
  return { catalog, manifest };
}

async function restoreLibraryArchive({
  archivePath,
  extractionDirectory,
  store,
  libraryDirectory,
  mediaDirectory,
  writeSnapshot,
  sanitizeNodes,
  syncFolderProjectCounts,
  maxArchiveEntries,
}) {
  const { catalog } = await readLibraryArchive({
    archivePath,
    extractionDirectory,
    maxArchiveEntries,
  });
  const existingFolders = await store.listFolders();
  const existingWorkflows = await store.listWorkflows();
  const existingFolderIds = new Set(existingFolders.map((folder) => folder.id));
  const existingWorkflowIds = new Set(existingWorkflows.map((workflow) => workflow.id));
  const folderIdMap = new Map();
  const workflowIdMap = new Map();

  for (const folder of catalog.folders) {
    if (!folder?.id) throw new ProjectTransferError('整库备份包含无效文件夹');
    folderIdMap.set(folder.id, existingFolderIds.has(folder.id) ? crypto.randomUUID() : folder.id);
  }
  for (const workflow of catalog.workflows) {
    if (!workflow?.id) throw new ProjectTransferError('整库备份包含无效工作流');
    const mediaCollision = fs.existsSync(path.join(mediaDirectory, workflow.id));
    workflowIdMap.set(
      workflow.id,
      existingWorkflowIds.has(workflow.id) || mediaCollision ? crypto.randomUUID() : workflow.id,
    );
  }

  let collisionCount = 0;
  const restoredWorkflows = catalog.workflows.map((archivedWorkflow) => {
    const targetId = workflowIdMap.get(archivedWorkflow.id);
    const collision = targetId !== archivedWorkflow.id;
    if (collision) collisionCount += 1;
    const restoredWorkflow = rewriteProjectMediaReferences(
      archivedWorkflow,
      archivedWorkflow.id,
      targetId,
    );
    restoredWorkflow.id = targetId;
    restoredWorkflow.revision = 0;
    restoredWorkflow.folderId = archivedWorkflow.folderId
      ? folderIdMap.get(archivedWorkflow.folderId) || null
      : null;
    restoredWorkflow.status = 'work';
    if (collision) {
      restoredWorkflow.title = `${restoredWorkflow.title || 'Untitled'}（迁移副本）`;
    }
    return { archivedWorkflow, restoredWorkflow, targetId };
  });

  const archivedFilesDirectory = path.join(extractionDirectory, 'files');
  const createdPaths = [];
  try {
    for (const directoryName of ['assets', 'prompts', 'workflows']) {
      await copyNewTree(
        path.join(archivedFilesDirectory, directoryName),
        path.join(libraryDirectory, directoryName),
        createdPaths,
      );
    }

    for (const { archivedWorkflow, targetId } of restoredWorkflows) {
      const sourceProjectMedia = path.join(archivedFilesDirectory, 'media', archivedWorkflow.id);
      const targetProjectMedia = path.join(mediaDirectory, targetId);
      if (fs.existsSync(sourceProjectMedia)) {
        await cp(sourceProjectMedia, targetProjectMedia, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
        createdPaths.push(targetProjectMedia);
      } else if (!fs.existsSync(targetProjectMedia)) {
        // 快照写入器可能创建该目录；失败回滚时也必须清理。
        createdPaths.push(targetProjectMedia);
      }
    }

    await store.runInTransaction(async () => {
      for (const folder of catalog.folders) {
        await store.saveFolder({
          ...folder,
          id: folderIdMap.get(folder.id),
          parentId: folder.parentId ? folderIdMap.get(folder.parentId) || null : null,
          projectCount: 0,
        });
      }

      for (const { restoredWorkflow } of restoredWorkflows) {
        const result = await store.saveWorkflow(restoredWorkflow, { sanitizeNodes });
        const savedWorkflow = await store.getWorkflowById(result.id);
        if (savedWorkflow) await writeSnapshot(savedWorkflow);
      }
      await syncFolderProjectCounts();
    });
  } catch (error) {
    await removeCreatedPaths(createdPaths);
    throw error;
  }
  return {
    workflowCount: catalog.workflows.length,
    folderCount: catalog.folders.length,
    collisionCount,
  };
}

async function restoreProjectArchive({
  archivePath,
  extractionDirectory,
  store,
  mediaDirectory,
  writeSnapshot,
  sanitizeNodes,
  syncFolderProjectCounts,
  maxArchiveEntries,
}) {
  const { workflow: archivedWorkflow } = await readProjectArchive({
    archivePath,
    extractionDirectory,
    maxArchiveEntries,
  });
  const sourceId = archivedWorkflow.id;
  const sourceMediaDirectory = path.join(extractionDirectory, 'media');
  const idExists = Boolean(await store.getWorkflowById(sourceId));
  const mediaExists = fs.existsSync(path.join(mediaDirectory, sourceId));
  const collision = idExists || mediaExists;
  const targetId = collision ? crypto.randomUUID() : sourceId;
  const targetMediaDirectory = path.join(mediaDirectory, targetId);
  const restoredWorkflow = rewriteProjectMediaReferences(archivedWorkflow, sourceId, targetId);
  restoredWorkflow.id = targetId;
  restoredWorkflow.revision = 0;
  restoredWorkflow.folderId = null;
  restoredWorkflow.status = 'work';
  if (collision) restoredWorkflow.title = `${restoredWorkflow.title || 'Untitled'}（恢复副本）`;

  let mediaMoved = false;
  try {
    if (fs.existsSync(sourceMediaDirectory)) {
      await cp(sourceMediaDirectory, targetMediaDirectory, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      mediaMoved = true;
    }

    const result = await store.saveWorkflow(restoredWorkflow, { sanitizeNodes });
    const savedWorkflow = await store.getWorkflowById(result.id);
    if (savedWorkflow) await writeSnapshot(savedWorkflow);
    await syncFolderProjectCounts();
    return { id: result.id, revision: result.revision, sourceId, collision };
  } catch (error) {
    if (mediaMoved) await rm(targetMediaDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function createProjectTransferRouter({
  store,
  libraryDirectory,
  mediaDirectory,
  writeSnapshot,
  sanitizeNodes,
  syncFolderProjectCounts,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  maxArchiveEntries = DEFAULT_MAX_ARCHIVE_ENTRIES,
  logger = console,
}) {
  const router = express.Router();
  const archivePathJson = express.json({ limit: '16kb', strict: true });
  const resolvedLibraryDirectory = libraryDirectory || path.dirname(mediaDirectory);

  router.get('/library/backup', async (_req, res) => {
    let temporaryDirectory = null;
    try {
      const archive = await createLibraryArchive({
        store,
        libraryDirectory: resolvedLibraryDirectory,
      });
      temporaryDirectory = archive.temporaryDirectory;
      const date = new Date().toISOString().slice(0, 10);
      res.type('application/vnd.fisherai.library');
      res.download(archive.archivePath, `AIFISHER-library-${date}.fisherai-library`, async (error) => {
        await rm(archive.temporaryDirectory, { recursive: true, force: true });
        if (error && !res.headersSent) {
          res.status(500).json({ error: '整库备份文件发送失败' });
        }
      });
      temporaryDirectory = null;
    } catch (error) {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
      logger.error('Create library archive error:', error);
      res.status(500).json({
        error: error?.message || '整库备份失败',
        code: error?.code || 'LIBRARY_BACKUP_FAILED',
      });
    }
  });

  router.post('/library/restore', async (req, res) => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fisherai-library-restore-'));
    const archivePath = path.join(temporaryDirectory, 'upload.fisherai-library');
    const extractionDirectory = path.join(temporaryDirectory, 'extracted');

    try {
      await receiveArchive(req, archivePath, maxArchiveBytes);
      const result = await restoreLibraryArchive({
        archivePath,
        extractionDirectory,
        store,
        libraryDirectory: resolvedLibraryDirectory,
        mediaDirectory,
        writeSnapshot,
        sanitizeNodes,
        syncFolderProjectCounts,
        maxArchiveEntries,
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      const status = error instanceof ProjectTransferError ? error.status : 500;
      if (status >= 500) logger.error('Restore library archive error:', error);
      res.status(status).json({
        error: error?.message || '整库恢复失败',
        code: error?.code || 'LIBRARY_RESTORE_FAILED',
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  router.post('/workflows/import', async (req, res) => {
    try {
      const incomingWorkflow = req.body;
      if (!incomingWorkflow || typeof incomingWorkflow !== 'object' || Array.isArray(incomingWorkflow)) {
        throw new ProjectTransferError('导入的工作流 JSON 无效');
      }

      const sourceId = typeof incomingWorkflow.id === 'string' && incomingWorkflow.id
        ? incomingWorkflow.id
        : null;
      const collision = sourceId ? Boolean(await store.getWorkflowById(sourceId)) : false;
      const targetId = !sourceId || collision ? crypto.randomUUID() : sourceId;
      const importedWorkflow = {
        ...incomingWorkflow,
        id: targetId,
        revision: 0,
        folderId: null,
        status: 'work',
        nodes: Array.isArray(incomingWorkflow.nodes) ? incomingWorkflow.nodes : [],
        groups: Array.isArray(incomingWorkflow.groups) ? incomingWorkflow.groups : [],
      };
      if (collision) {
        importedWorkflow.title = `${importedWorkflow.title || 'Untitled'}（导入副本）`;
      }

      const result = await store.saveWorkflow(importedWorkflow, { sanitizeNodes });
      const savedWorkflow = await store.getWorkflowById(result.id);
      if (savedWorkflow) await writeSnapshot(savedWorkflow);
      await syncFolderProjectCounts();
      res.status(201).json({
        success: true,
        id: result.id,
        revision: result.revision,
        sourceId,
        collision,
      });
    } catch (error) {
      const status = error instanceof ProjectTransferError ? error.status : 500;
      if (status >= 500) logger.error('Import workflow JSON error:', error);
      res.status(status).json({
        error: error?.message || '导入工作流失败',
        code: error?.code || 'WORKFLOW_IMPORT_FAILED',
      });
    }
  });

  router.post('/workflows/restore', (req, res, next) => {
    if (req.is('application/json')) archivePathJson(req, res, next);
    else next();
  }, async (req, res) => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fisherai-project-restore-'));
    const extractionDirectory = path.join(temporaryDirectory, 'extracted');

    try {
      let archivePath;
      if (req.is('application/json')) {
        archivePath = await statLocalArchive(req.body?.path, maxArchiveBytes);
      } else {
        archivePath = path.join(temporaryDirectory, 'upload.fisherai');
        await receiveArchive(req, archivePath, maxArchiveBytes);
      }
      const result = await restoreProjectArchive({
        archivePath,
        extractionDirectory,
        store,
        mediaDirectory,
        writeSnapshot,
        sanitizeNodes,
        syncFolderProjectCounts,
        maxArchiveEntries,
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      const status = error instanceof ProjectTransferError ? error.status : 500;
      if (status >= 500) logger.error('Restore project archive error:', error);
      res.status(status).json({
        error: error?.message || '恢复项目失败',
        code: error?.code || 'PROJECT_RESTORE_FAILED',
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  // Backup and restore in one request, so a copied project never passes through the page
  // or the desktop main process.
  router.post('/workflows/:id/duplicate', async (req, res) => {
    let temporaryDirectory = null;
    try {
      const workflow = await store.getWorkflowById(req.params.id);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
      const archive = await createProjectArchive({ workflow, mediaDirectory });
      temporaryDirectory = archive.temporaryDirectory;
      const result = await restoreProjectArchive({
        archivePath: archive.archivePath,
        extractionDirectory: path.join(archive.temporaryDirectory, 'extracted'),
        store,
        mediaDirectory,
        writeSnapshot,
        sanitizeNodes,
        syncFolderProjectCounts,
        maxArchiveEntries,
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      const status = error instanceof ProjectTransferError ? error.status : 500;
      if (status >= 500) logger.error('Duplicate project error:', error);
      res.status(status).json({
        error: error?.message || '复制项目失败',
        code: error?.code || 'PROJECT_DUPLICATE_FAILED',
      });
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  router.get('/workflows/:id/backup', async (req, res) => {
    let temporaryDirectory = null;
    try {
      const workflow = await store.getWorkflowById(req.params.id);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

      const archive = await createProjectArchive({ workflow, mediaDirectory });
      temporaryDirectory = archive.temporaryDirectory;
      const downloadName = `${sanitizeDownloadName(workflow.title)}_${workflow.id}.fisherai`;
      res.type('application/vnd.fisherai.project');
      res.download(archive.archivePath, downloadName, async (error) => {
        await rm(archive.temporaryDirectory, { recursive: true, force: true });
        if (error && !res.headersSent) {
          res.status(500).json({ error: '项目备份文件发送失败' });
        }
      });
      temporaryDirectory = null;
    } catch (error) {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
      logger.error('Create project archive error:', error);
      res.status(500).json({ error: error?.message || '备份项目失败' });
    }
  });

  router.get('/workflows/:id/export', async (req, res) => {
    try {
      const workflow = await store.getWorkflowById(req.params.id);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
      const downloadName = `${sanitizeDownloadName(workflow.title)}_${workflow.id}.fisherai.json`;
      res.attachment(downloadName).json(workflow);
    } catch (error) {
      logger.error('Export workflow JSON error:', error);
      res.status(500).json({ error: error?.message || '导出工作流失败' });
    }
  });

  return router;
}
