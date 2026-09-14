import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ACTIVE_STATUSES = new Set(['loading', 'queued']);

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function readRecords(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const records = Array.isArray(parsed) ? parsed : parsed?.tasks;
  if (!Array.isArray(records)) throw new Error('Invalid generation task journal shape');
  return records.filter((record) => record?.nodeId).map(clone);
}

function atomicWriteJournal(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: 1, tasks: records }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function recordTimestamp(record) {
  const value = Date.parse(record?.updatedAt || record?.finishedAt || record?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function recordsDiffer(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

/**
 * Moves the legacy public task journal into the private runtime directory before
 * either generation router is created. Migration is synchronous on purpose: the
 * server must never start with two writers or briefly expose the old journal.
 */
export function migrateGenerationTaskJournal({ legacyFilePath, privateFilePath, now = () => Date.now() }) {
  if (!legacyFilePath || !privateFilePath) {
    throw new Error('Generation task journal migration requires both paths');
  }
  if (!fs.existsSync(legacyFilePath)) return { migrated: false, conflicts: 0 };

  fs.mkdirSync(path.dirname(privateFilePath), { recursive: true });
  let legacyRecords;
  try {
    legacyRecords = readRecords(legacyFilePath);
  } catch (error) {
    const quarantinePath = path.join(
      path.dirname(privateFilePath),
      `generation-tasks.legacy-corrupt-${now()}.json`,
    );
    fs.renameSync(legacyFilePath, quarantinePath);
    throw Object.assign(new Error('旧生成任务日志损坏，已移入私有隔离区，服务已停止启动。'), {
      code: 'GENERATION_JOURNAL_MIGRATION_FAILED',
      cause: error,
    });
  }

  const privateRecords = fs.existsSync(privateFilePath) ? readRecords(privateFilePath) : [];
  const merged = new Map(privateRecords.map((record) => [String(record.nodeId), record]));
  const conflicts = [];
  for (const legacyRecord of legacyRecords) {
    const nodeId = String(legacyRecord.nodeId);
    const current = merged.get(nodeId);
    if (!current) {
      merged.set(nodeId, legacyRecord);
      continue;
    }
    const legacyTimestamp = recordTimestamp(legacyRecord);
    const currentTimestamp = recordTimestamp(current);
    if (legacyTimestamp > currentTimestamp) {
      merged.set(nodeId, legacyRecord);
    } else if (legacyTimestamp === currentTimestamp && recordsDiffer(legacyRecord, current)) {
      conflicts.push(legacyRecord);
    }
  }

  const records = Array.from(merged.values()).sort((left, right) =>
    String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')));
  atomicWriteJournal(privateFilePath, records);
  if (conflicts.length > 0) {
    atomicWriteJournal(
      path.join(path.dirname(privateFilePath), `generation-tasks.legacy-conflicts-${now()}.json`),
      conflicts,
    );
  }
  fs.unlinkSync(legacyFilePath);
  return { migrated: true, conflicts: conflicts.length };
}

export class GenerationTaskJournal {
  constructor({ filePath, now = () => Date.now(), maxEntries = 1_000 }) {
    if (!filePath) throw new Error('GenerationTaskJournal requires filePath');
    this.filePath = filePath;
    this.now = now;
    this.maxEntries = Math.max(1, Number(maxEntries) || 1_000);
    this.tasks = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const records = Array.isArray(parsed) ? parsed : parsed?.tasks;
      if (!Array.isArray(records)) throw new Error('Invalid generation task journal shape');

      for (const record of records) {
        if (record?.nodeId) this.tasks.set(String(record.nodeId), clone(record));
      }
      if (this.recoverInterruptedTasks()) this.flush();
    } catch {
      const quarantinePath = `${this.filePath}.corrupt-${this.now()}`;
      fs.renameSync(this.filePath, quarantinePath);
      this.tasks.clear();
    }
  }

  recoverInterruptedTasks() {
    let changed = false;
    const currentTime = this.now();
    const timestamp = new Date(currentTime).toISOString();
    for (const task of this.tasks.values()) {
      if (!ACTIVE_STATUSES.has(task.status)) continue;
      if (task.phase === 'observation-paused') continue;
      if (task.kind === 'workflow-test') {
        Object.assign(task, {
          status: 'loading',
          interruptedPhase: task.interruptedPhase || task.phase,
          phase: 'recovering',
          retryable: false,
          updatedAt: timestamp,
        });
        changed = true;
        continue;
      }
      const startedAt = Date.parse(task.createdAt || task.updatedAt);
      Object.assign(task, {
        status: 'unknown',
        code: 'GENERATION_INTERRUPTED',
        diagnosticCode: 'GENERATION_INTERRUPTED',
        error: '生成服务曾中断，结果与费用尚未确认。请先核对服务商任务记录，避免重复生成。',
        retryable: false,
        durationMs: Number.isFinite(startedAt) ? Math.max(0, currentTime - startedAt) : 0,
        updatedAt: timestamp,
        finishedAt: timestamp,
      });
      changed = true;
    }
    return changed;
  }

  flush() {
    const ordered = Array.from(this.tasks.values())
      .sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')));
    const active = ordered.filter((task) => ACTIVE_STATUSES.has(task.status));
    const terminalBudget = Math.max(0, this.maxEntries - active.length);
    const tasks = [
      ...active,
      ...ordered.filter((task) => !ACTIVE_STATUSES.has(task.status)).slice(-terminalBudget),
    ];
    atomicWriteJournal(this.filePath, tasks);
  }

  upsert(task) {
    if (!task?.nodeId) throw new Error('Generation task requires nodeId');
    this.tasks.set(String(task.nodeId), clone(task));
    this.flush();
    return this.get(task.nodeId);
  }

  get(nodeId) {
    return clone(this.tasks.get(String(nodeId)));
  }

  list() {
    return Array.from(this.tasks.values(), clone);
  }
}
