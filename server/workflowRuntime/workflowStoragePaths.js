import path from 'node:path';
import { realpath } from 'node:fs/promises';

function isInsideOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveWorkflowStorageDirectory({ libraryDirectory, storageDirectory }) {
  if (!libraryDirectory) {
    const error = new Error('执行工作流存储缺少 libraryDirectory');
    error.code = 'WORKFLOW_STORAGE_CONFIGURATION_ERROR';
    throw error;
  }
  const libraryRoot = path.resolve(libraryDirectory);
  const privateRoot = path.resolve(
    storageDirectory
      || path.join(path.dirname(libraryRoot), 'private', 'execution-workflows'),
  );
  if (isInsideOrEqual(libraryRoot, privateRoot)) {
    const error = new Error('执行工作流私有存储不能位于 /library 静态目录内');
    error.code = 'WORKFLOW_STORAGE_EXPOSED';
    throw error;
  }
  return privateRoot;
}

export async function assertWorkflowStorageIsPrivate({ libraryDirectory, storageDirectory }) {
  const [libraryRoot, privateRoot] = await Promise.all([
    realpath(libraryDirectory).catch(() => path.resolve(libraryDirectory)),
    realpath(storageDirectory).catch(() => path.resolve(storageDirectory)),
  ]);
  if (isInsideOrEqual(libraryRoot, privateRoot)) {
    const error = new Error('执行工作流私有存储解析后位于 /library 静态目录内');
    error.code = 'WORKFLOW_STORAGE_EXPOSED';
    throw error;
  }
}
