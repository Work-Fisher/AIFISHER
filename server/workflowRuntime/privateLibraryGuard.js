import path from 'node:path';

const PRIVATE_LIBRARY_ROOTS = new Set(['execution-workflows']);
const PRIVATE_LIBRARY_FILES = new Set(['generation-tasks.json']);
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

export function denyPrivateLibraryPath(request, response, next) {
  const rawPath = String(request.url || '').split(/[?#]/, 1)[0];
  if (ENCODED_PATH_SEPARATOR.test(rawPath)) {
    response.sendStatus(404);
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath).replaceAll('\\', '/');
  } catch {
    response.sendStatus(400);
    return;
  }
  const normalizedPath = path.posix.normalize(`/${decodedPath}`);
  const topLevel = normalizedPath.split('/').find(Boolean)?.toLowerCase();
  if (PRIVATE_LIBRARY_ROOTS.has(topLevel) || PRIVATE_LIBRARY_FILES.has(topLevel)) {
    response.sendStatus(404);
    return;
  }
  next();
}
