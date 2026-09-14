import crypto from 'node:crypto';
import {
  lstat,
  mkdir,
  realpath,
  readdir,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

export class PrivateRecoveryDirectoryError extends Error {
  constructor(message, code = 'PRIVATE_RECOVERY_PATH_UNSAFE') {
    super(message);
    this.name = 'PrivateRecoveryDirectoryError';
    this.code = code;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function requirePlainDirectory(directory, label) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new PrivateRecoveryDirectoryError(`${label}不是受信任的普通目录`);
  }
  return info;
}

export async function preparePrivateRecoveryRoot(directory) {
  const root = path.resolve(directory);
  const parent = path.dirname(root);
  await mkdir(parent, { recursive: true });
  await requirePlainDirectory(parent, '私有存储根目录');
  const parentReal = await realpath(parent);
  try {
    await requirePlainDirectory(root, '恢复目录');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(root);
    await requirePlainDirectory(root, '恢复目录');
  }
  const realRoot = await realpath(root);
  if (!isInside(parentReal, realRoot)) {
    throw new PrivateRecoveryDirectoryError('恢复目录解析到私有存储根目录之外');
  }
  return { root, realRoot };
}

export async function quarantinePrivateRecoveryEntry({ root, realRoot, entryName }) {
  if (
    !entryName
    || entryName === '.'
    || entryName === '..'
    || /[\\/\0\r\n]/.test(entryName)
  ) {
    throw new PrivateRecoveryDirectoryError('恢复项名称无效');
  }
  const source = path.resolve(root, entryName);
  if (path.dirname(source) !== root) {
    throw new PrivateRecoveryDirectoryError('恢复项路径越界');
  }
  await requirePlainDirectory(source, '恢复项');
  const sourceReal = await realpath(source);
  if (!isInside(realRoot, sourceReal)) {
    throw new PrivateRecoveryDirectoryError('恢复项解析到恢复目录之外');
  }
  const quarantined = path.join(root, `.fisherai-recovery-${crypto.randomUUID()}`);
  await rename(source, quarantined);
  await requirePlainDirectory(quarantined, '隔离恢复项');
  const quarantinedReal = await realpath(quarantined);
  if (!isInside(realRoot, quarantinedReal)) {
    throw new PrivateRecoveryDirectoryError('隔离恢复项解析到恢复目录之外');
  }
  return quarantined;
}

export async function removeQuarantinedFlatDirectory({ directory, realRoot }) {
  await requirePlainDirectory(directory, '隔离恢复项');
  const directoryReal = await realpath(directory);
  if (!isInside(realRoot, directoryReal)) {
    throw new PrivateRecoveryDirectoryError('隔离恢复项删除路径越界');
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const info = await lstat(filePath);
    if (!entry.isFile() || !info.isFile() || entry.isSymbolicLink() || info.isSymbolicLink()) {
      throw new PrivateRecoveryDirectoryError('隔离恢复项包含非普通文件');
    }
    await unlink(filePath);
  }
  await rmdir(directory);
}
