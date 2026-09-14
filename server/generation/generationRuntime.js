import path from 'node:path';
import { createGenerationCoordinator } from './generationCoordinator.js';
import {
  GenerationTaskJournal,
  migrateGenerationTaskJournal,
} from './generationTaskJournal.js';

function isInsideOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveGenerationRuntimePaths({ libraryDirectory, privateDirectory }) {
  if (!libraryDirectory) throw new Error('Generation runtime requires libraryDirectory');
  const libraryRoot = path.resolve(libraryDirectory);
  const privateRoot = path.resolve(
    privateDirectory || path.join(path.dirname(libraryRoot), 'private', 'generation'),
  );
  if (isInsideOrEqual(libraryRoot, privateRoot)) {
    throw Object.assign(new Error('生成任务私有存储不能位于 /library 静态目录内'), {
      code: 'GENERATION_STORAGE_EXPOSED',
    });
  }
  return {
    legacyJournalPath: path.join(libraryRoot, 'generation-tasks.json'),
    privateJournalPath: path.join(privateRoot, 'generation-tasks.json'),
  };
}

/**
 * Composition root for every generation entry point. Call this exactly once at
 * server startup, then inject the returned coordinator into all routers.
 */
export function createGenerationRuntime({
  libraryDirectory,
  privateDirectory,
  parseTimeToMs,
  now,
  onTaskChange,
  coordinatorOptions = {},
} = {}) {
  const paths = resolveGenerationRuntimePaths({ libraryDirectory, privateDirectory });
  migrateGenerationTaskJournal({
    legacyFilePath: paths.legacyJournalPath,
    privateFilePath: paths.privateJournalPath,
    now,
  });
  const journal = new GenerationTaskJournal({
    filePath: paths.privateJournalPath,
    now,
  });
  const taskStore = typeof onTaskChange === 'function'
    ? {
      upsert(task) {
        const persisted = journal.upsert(task);
        try {
          onTaskChange(persisted);
        } catch {
          console.warn('[GenerationRuntime] Account activity observer unavailable');
        }
        return persisted;
      },
      get: (nodeId) => journal.get(nodeId),
    }
    : journal;
  const coordinator = createGenerationCoordinator({
    parseTimeToMs,
    now,
    taskStore,
    ...coordinatorOptions,
  });
  return Object.freeze({ coordinator, journal, paths: Object.freeze(paths) });
}
