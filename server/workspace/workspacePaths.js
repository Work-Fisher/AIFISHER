import path from 'node:path';
import { RUNTIME_PATHS } from './runtimePaths.js';

export const BASE_LIBRARY_DIR = RUNTIME_PATHS.LIBRARY_DIR;

export function getWorkspacePaths() {
  return {
    LIBRARY_DIR: BASE_LIBRARY_DIR,
    LIBRARY_MEDIA_DIR: path.join(BASE_LIBRARY_DIR, 'media'),
    WORKFLOWS_DIR: path.join(BASE_LIBRARY_DIR, 'media'),
    LIBRARY_ASSETS_DIR: path.join(BASE_LIBRARY_DIR, 'assets'),
    FOLDERS_JSON_PATH: path.join(BASE_LIBRARY_DIR, 'folders.json'),
  };
}

export function getUrlPrefix() {
  return '/library';
}
