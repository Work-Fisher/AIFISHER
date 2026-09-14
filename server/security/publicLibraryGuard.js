import path from 'node:path';

const PUBLIC_LIBRARY_PREFIXES = Object.freeze([
  'assets/',
  'media/',
  'prompts/previews/',
  'workflows/covers/',
]);
const PUBLIC_LIBRARY_FILES = new Set(['prompts/prompt.json']);

export function createPublicLibraryGuard() {
  return (request, response, next) => {
    let decoded;
    try {
      decoded = decodeURIComponent(request.path).replaceAll('\\', '/').replace(/^\/+/, '');
    } catch {
      response.status(404).end();
      return;
    }
    const normalized = path.posix.normalize(decoded);
    if (
      !normalized
      || normalized === '.'
      || normalized === '..'
      || normalized.startsWith('../')
      || (
        !PUBLIC_LIBRARY_FILES.has(normalized)
        && !PUBLIC_LIBRARY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
      )
    ) {
      response.status(404).end();
      return;
    }
    next();
  };
}
