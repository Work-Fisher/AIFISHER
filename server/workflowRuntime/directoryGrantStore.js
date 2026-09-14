import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseWorkflowArtifact, WORKFLOW_LIMITS } from './workflowFormat.js';
import {
  assertWorkflowStorageIsPrivate,
  resolveWorkflowStorageDirectory,
} from './workflowStoragePaths.js';

const execFileAsync = promisify(execFile);
const SAFE_ID = /^[a-f\d-]{36}$/i;
const SAFE_RUN_ID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const DEFAULT_SCAN_LIMITS = Object.freeze({
  maxDepth: 4,
  maxFiles: 500,
  maxFileBytes: WORKFLOW_LIMITS.maxBytes,
});
const GRANT_POLICIES = Object.freeze({
  'workflow-discovery': Object.freeze(['read-json']),
  'comfy-input-cleanup': Object.freeze(['read', 'delete-owned-staged-files']),
});

export class DirectoryGrantError extends Error {
  constructor(message, code = 'DIRECTORY_GRANT_ERROR', status = 400) {
    super(message);
    this.name = 'DirectoryGrantError';
    this.code = code;
    this.status = status;
  }
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, filePath);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameFileIdentity(left, right) {
  const hasStableIdentity = [left?.dev, left?.ino, right?.dev, right?.ino]
    .every((value) => Number.isFinite(value))
    && left.ino !== 0
    && right.ino !== 0;
  if (hasStableIdentity) return left.dev === right.dev && left.ino === right.ino;
  return left?.size === right?.size
    && left?.mtimeMs === right?.mtimeMs
    && left?.ctimeMs === right?.ctimeMs;
}

async function hashFile(filePath) {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { bytes, sha256: hash.digest('hex') };
}

function safeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) {
    throw new DirectoryGrantError('工作流相对路径无效', 'INVALID_GRANTED_PATH');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new DirectoryGrantError('工作流相对路径无效', 'INVALID_GRANTED_PATH');
  }
  return parts.join(path.sep);
}

export async function selectDirectoryWithSystemDialog({
  description = '选择 ComfyUI 输入目录',
  runCommand = execFileAsync,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') {
    throw new DirectoryGrantError('当前系统暂不支持目录选择器', 'DIRECTORY_PICKER_UNAVAILABLE', 501);
  }
  const safeDescription = String(description || '选择目录')
    .replace(/[\r\n\0]/gu, ' ')
    .slice(0, 200)
    .replaceAll("'", "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.ShowInTaskbar = $false',
    '$owner.TopMost = $true',
    "$owner.Text = 'AIFISHER 画布'",
    '$owner.Width = 1',
    '$owner.Height = 1',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$dialog.Description = '${safeDescription}'`,
    '$dialog.ShowNewFolderButton = $false',
    '$owner.Show()',
    '$owner.Activate()',
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    '$owner.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('\n');
  const { stdout } = await runCommand('powershell.exe', [
    '-NoProfile',
    '-WindowStyle',
    'Hidden',
    '-STA',
    '-Command',
    script,
  ], {
    windowsHide: true,
    timeout: 2 * 60_000,
    maxBuffer: 64 * 1024,
  });
  const selected = String(stdout || '').trim();
  if (!selected) throw new DirectoryGrantError('已取消选择目录', 'DIRECTORY_PICKER_CANCELLED', 409);
  return selected;
}

export class DirectoryGrantStore {
  constructor({ libraryDirectory, storageDirectory, cleanupFileOps = {} }) {
    this.libraryDirectory = path.resolve(libraryDirectory);
    this.rootDirectory = resolveWorkflowStorageDirectory({ libraryDirectory, storageDirectory });
    this.filePath = path.join(this.rootDirectory, 'directory-grants.json');
    this.mutationLock = Promise.resolve();
    this.cleanupRename = cleanupFileOps.rename || rename;
    this.cleanupHashFile = cleanupFileOps.hashFile || hashFile;
    this.cleanupRemove = cleanupFileOps.remove || rm;
  }

  async load() {
    await mkdir(this.rootDirectory, { recursive: true });
    await assertWorkflowStorageIsPrivate({
      libraryDirectory: this.libraryDirectory,
      storageDirectory: this.rootDirectory,
    });
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(value)) return [];
      return value.map((grant) => ({
        ...grant,
        purpose: grant.purpose || 'workflow-discovery',
        access: Array.isArray(grant.access) ? grant.access : ['read-json'],
      }));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async createGrant(selectedDirectory, { purpose = 'workflow-discovery' } = {}) {
    if (!Object.hasOwn(GRANT_POLICIES, purpose)) {
      throw new DirectoryGrantError('目录授权用途无效', 'INVALID_DIRECTORY_GRANT_PURPOSE');
    }
    const previous = this.mutationLock;
    const current = previous.catch(() => undefined).then(
      () => this.createGrantUnlocked(selectedDirectory, purpose),
    );
    this.mutationLock = current;
    try {
      return await current;
    } finally {
      if (this.mutationLock === current) this.mutationLock = Promise.resolve();
    }
  }

  async createGrantUnlocked(selectedDirectory, purpose) {
    const rawSelection = String(selectedDirectory || '').trim();
    if (!rawSelection) {
      throw new DirectoryGrantError('选择的目录无效', 'INVALID_DIRECTORY_GRANT');
    }
    const selected = path.resolve(rawSelection);
    const selectedInfo = await lstat(selected).catch(() => null);
    if (!selectedInfo?.isDirectory() || selectedInfo.isSymbolicLink()) {
      throw new DirectoryGrantError('选择的目录无效或是链接目录', 'INVALID_DIRECTORY_GRANT');
    }
    const root = await realpath(selected);
    const grants = await this.load();
    const existing = grants.find((grant) =>
      grant.root.toLowerCase() === root.toLowerCase() && grant.purpose === purpose);
    if (existing) return existing;
    const grant = {
      id: crypto.randomUUID(),
      root,
      label: path.basename(root) || root,
      purpose,
      access: [...GRANT_POLICIES[purpose]],
      createdAt: new Date().toISOString(),
    };
    await writeAtomic(this.filePath, JSON.stringify([...grants, grant], null, 2));
    return grant;
  }

  async requireGrant(
    grantId,
    { purpose = 'workflow-discovery', access = 'read-json' } = {},
  ) {
    if (!SAFE_ID.test(String(grantId || ''))) {
      throw new DirectoryGrantError('目录授权标识无效', 'INVALID_DIRECTORY_GRANT');
    }
    const grant = (await this.load()).find((item) => item.id === grantId);
    if (!grant) throw new DirectoryGrantError('目录授权不存在', 'DIRECTORY_GRANT_NOT_FOUND', 404);
    if (grant.purpose !== purpose || !grant.access.includes(access)) {
      throw new DirectoryGrantError('目录授权用途或权限不匹配', 'DIRECTORY_GRANT_SCOPE_MISMATCH', 403);
    }
    const [currentRoot, rootInfo] = await Promise.all([
      realpath(grant.root).catch(() => null),
      lstat(grant.root).catch(() => null),
    ]);
    if (
      !currentRoot
      || !rootInfo?.isDirectory()
      || rootInfo.isSymbolicLink()
      || currentRoot.toLowerCase() !== grant.root.toLowerCase()
    ) {
      throw new DirectoryGrantError('授权目录已经移动或不可访问', 'DIRECTORY_GRANT_STALE', 409);
    }
    return grant;
  }

  async readGrantedFile(grantId, relativePath, { maxBytes = WORKFLOW_LIMITS.maxBytes } = {}) {
    const grant = await this.requireGrant(grantId, {
      purpose: 'workflow-discovery',
      access: 'read-json',
    });
    const safeRelative = safeRelativePath(relativePath);
    const candidate = path.resolve(grant.root, safeRelative);
    if (!isInside(grant.root, candidate)) {
      throw new DirectoryGrantError('工作流路径超出授权目录', 'GRANT_PATH_ESCAPE', 403);
    }

    const lexicalInfo = await lstat(candidate).catch(() => null);
    if (!lexicalInfo?.isFile() || lexicalInfo.isSymbolicLink() || lexicalInfo.size > maxBytes) {
      throw new DirectoryGrantError('工作流文件无效、是链接或超过大小限制', 'INVALID_GRANTED_FILE');
    }

    const resolvedBefore = await realpath(candidate).catch(() => null);
    if (!resolvedBefore || !isInside(grant.root, resolvedBefore)) {
      throw new DirectoryGrantError('工作流文件超出授权目录', 'GRANT_PATH_ESCAPE', 403);
    }
    const pathBefore = await lstat(resolvedBefore).catch(() => null);
    if (!pathBefore?.isFile() || pathBefore.isSymbolicLink() || pathBefore.size > maxBytes) {
      throw new DirectoryGrantError('工作流文件无效、是链接或超过大小限制', 'INVALID_GRANTED_FILE');
    }

    let fileHandle;
    try {
      fileHandle = await open(resolvedBefore, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const handleBefore = await fileHandle.stat();
      if (!handleBefore.isFile() || !sameFileIdentity(pathBefore, handleBefore)) {
        throw new DirectoryGrantError('读取前工作流文件发生变化', 'GRANTED_FILE_CHANGED', 409);
      }

      const chunks = [];
      let total = 0;
      let position = 0;
      while (true) {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) {
          throw new DirectoryGrantError('工作流文件超过大小限制', 'WORKFLOW_SIZE_LIMIT');
        }
        chunks.push(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const handleAfter = await fileHandle.stat();
      const [resolvedAfter, pathAfter] = await Promise.all([
        realpath(resolvedBefore).catch(() => null),
        lstat(resolvedBefore).catch(() => null),
      ]);
      if (
        !resolvedAfter
        || !pathAfter?.isFile()
        || pathAfter.isSymbolicLink()
        || !isInside(grant.root, resolvedAfter)
        || resolvedAfter.toLowerCase() !== resolvedBefore.toLowerCase()
        || !sameFileIdentity(handleAfter, pathAfter)
        || handleBefore.size !== handleAfter.size
        || handleBefore.mtimeMs !== handleAfter.mtimeMs
        || handleBefore.ctimeMs !== handleAfter.ctimeMs
        || total !== handleAfter.size
      ) {
        throw new DirectoryGrantError('读取期间工作流文件发生变化', 'GRANTED_FILE_CHANGED', 409);
      }
      const bytes = Buffer.concat(chunks, total);
      const normalizedRelative = safeRelative.split(path.sep).join('/');
      return {
        bytes,
        relativePath: normalizedRelative,
        originalPathRef: `${grant.id}:${normalizedRelative}`,
      };
    } finally {
      await fileHandle?.close();
    }
  }

  async deleteOwnedStagedFiles(grantId, runId, entries) {
    const grant = await this.requireGrant(grantId, {
      purpose: 'comfy-input-cleanup',
      access: 'delete-owned-staged-files',
    });
    const normalizedRunId = String(runId || '');
    if (!SAFE_RUN_ID.test(normalizedRunId)) {
      throw new DirectoryGrantError('运行标识无效', 'INVALID_CLEANUP_RUN');
    }
    if (!Array.isArray(entries) || entries.length > 20) {
      throw new DirectoryGrantError('待清理素材清单无效', 'INVALID_CLEANUP_LEDGER');
    }
    const expectedPrefix = `fisherai-runs/${normalizedRunId}/`;
    const handles = entries.map((entry) => String(entry?.relativeHandle || '').replaceAll('\\', '/'));
    if (
      handles.some((handle) => (
        !handle.startsWith(expectedPrefix)
        || handle.slice(expectedPrefix.length).includes('/')
        || !handle.slice(expectedPrefix.length)
        || /[\0\r\n]/.test(handle)
      ))
      || new Set(handles).size !== handles.length
      || entries.some((entry) => (
        !Number.isSafeInteger(Number(entry?.bytes))
        || Number(entry.bytes) < 0
        || !/^[a-f\d]{64}$/i.test(String(entry?.sha256 || ''))
      ))
    ) {
      throw new DirectoryGrantError(
        '只允许清理本次运行登记的 ComfyUI 暂存文件',
        'CLEANUP_LEDGER_SCOPE_MISMATCH',
        403,
      );
    }

    const results = [];
    for (let index = 0; index < handles.length; index += 1) {
      const relativeHandle = handles[index];
      const expected = entries[index];
      const candidate = path.resolve(grant.root, ...relativeHandle.split('/'));
      if (!isInside(grant.root, candidate)) {
        throw new DirectoryGrantError('清理路径超出授权目录', 'GRANT_PATH_ESCAPE', 403);
      }
      const tombstoneId = crypto.createHash('sha256')
        .update(JSON.stringify({
          runId: normalizedRunId,
          relativeHandle,
          bytes: Number(expected.bytes),
          sha256: String(expected.sha256).toLowerCase(),
        }))
        .digest('hex');
      const tombstone = path.join(path.dirname(candidate), `.fisherai-delete-${tombstoneId}`);
      const inspectFile = async (filePath) => {
        const info = await lstat(filePath).catch((error) => {
          if (error?.code === 'ENOENT') return null;
          throw error;
        });
        if (!info) return null;
        if (!info.isFile() || info.isSymbolicLink()) {
          throw new DirectoryGrantError(
            '暂存文件已被替换，拒绝清理',
            'CLEANUP_TARGET_CHANGED',
            409,
          );
        }
        const resolved = await realpath(filePath).catch(() => null);
        if (!resolved || !isInside(grant.root, resolved)) {
          throw new DirectoryGrantError('清理路径超出授权目录', 'GRANT_PATH_ESCAPE', 403);
        }
        return info;
      };
      const verifyAndRemoveTombstone = async () => {
        const actual = await this.cleanupHashFile(tombstone);
        if (
          actual.bytes !== Number(expected.bytes)
          || actual.sha256 !== String(expected.sha256).toLowerCase()
        ) {
          throw new DirectoryGrantError(
            '暂存文件内容已被替换，拒绝清理',
            'CLEANUP_TARGET_CHANGED',
            409,
          );
        }
        await this.cleanupRemove(tombstone, { force: true });
      };

      const tombstoneInfo = await inspectFile(tombstone);
      if (tombstoneInfo) {
        await verifyAndRemoveTombstone();
        results.push({ relativeHandle, state: 'deleted' });
        continue;
      }
      const info = await lstat(candidate).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (!info) {
        results.push({ relativeHandle, state: 'already-missing' });
        continue;
      }
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new DirectoryGrantError(
          '暂存文件已被替换，拒绝清理',
          'CLEANUP_TARGET_CHANGED',
          409,
        );
      }
      const resolved = await realpath(candidate).catch(() => null);
      if (!resolved || !isInside(grant.root, resolved)) {
        throw new DirectoryGrantError('清理路径超出授权目录', 'GRANT_PATH_ESCAPE', 403);
      }
      await this.cleanupRename(candidate, tombstone);
      try {
        await verifyAndRemoveTombstone();
      } catch (error) {
        if (error instanceof DirectoryGrantError && error.code === 'CLEANUP_TARGET_CHANGED') {
          await this.cleanupRename(tombstone, candidate).catch(() => undefined);
        }
        // I/O failures intentionally leave the deterministic tombstone in
        // place. A later retry can reconstruct its path from the immutable
        // ledger and continue the verified deletion.
        throw error;
      }
      results.push({ relativeHandle, state: 'deleted' });
    }
    const runDirectory = path.resolve(grant.root, 'fisherai-runs', normalizedRunId);
    // Only remove the exact run directory when it is empty. A recursive remove
    // here could erase a foreign file that was never present in the verified
    // ledger.
    await rmdir(runDirectory).catch(() => undefined);
    return {
      runId: normalizedRunId,
      deleted: results.filter((result) => result.state === 'deleted').length,
      missing: results.filter((result) => result.state === 'already-missing').length,
      results,
    };
  }

  async discover(grantId, limits = DEFAULT_SCAN_LIMITS) {
    const grant = await this.requireGrant(grantId, {
      purpose: 'workflow-discovery',
      access: 'read-json',
    });
    const candidates = [];
    const skipped = [];
    let visitedFiles = 0;

    const walk = async (directory, depth) => {
      if (depth > limits.maxDepth || visitedFiles >= limits.maxFiles) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (visitedFiles >= limits.maxFiles) break;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const entryPath = path.join(directory, entry.name);
        const info = await lstat(entryPath).catch(() => null);
        if (!info || info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
          await walk(entryPath, depth + 1);
          continue;
        }
        if (!info.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
        visitedFiles += 1;
        const relativePath = path.relative(grant.root, entryPath).split(path.sep).join('/');
        if (info.size > limits.maxFileBytes) {
          skipped.push({ relativePath, code: 'WORKFLOW_SIZE_LIMIT' });
          continue;
        }
        try {
          const grantedFile = await this.readGrantedFile(grantId, relativePath, {
            maxBytes: limits.maxFileBytes,
          });
          const parsed = parseWorkflowArtifact(grantedFile.bytes);
          candidates.push({
            relativePath,
            originalFilename: entry.name,
            format: parsed.format,
            byteLength: parsed.byteLength,
            sourceSha256: parsed.sourceSha256,
          });
        } catch (error) {
          skipped.push({ relativePath, code: error?.code || 'INVALID_WORKFLOW' });
        }
      }
    };

    await walk(grant.root, 0);
    return {
      grant: { id: grant.id, label: grant.label },
      candidates,
      skipped,
      truncated: visitedFiles >= limits.maxFiles,
    };
  }
}
