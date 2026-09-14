import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, readdir, rename, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import {
  assertDramaObject, assertDramaPlanReviewable, DramaPlanError, requireDramaPlanId,
  requireDramaProjectId, requireDramaRevision, validateDramaPlan,
} from './dramaPlan.js';

const sharedQueues = new Map();
const activePlanningRequests = new Map();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function requestIdentity(projectId, requestId) {
  requireDramaProjectId(projectId);
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(requestId)) {
    throw new DramaPlanError('请求标识无效', 'INVALID_DRAMA_REQUEST_ID');
  }
  const value = hash(`${projectId}\0${requestId}`);
  return { id: `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`, requestHash: hash(requestId) };
}

async function atomicJson(filename, value) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}

function queued(key, operation) {
  const previous = sharedQueues.get(key) ?? Promise.resolve();
  const running = previous.catch(() => undefined).then(operation);
  sharedQueues.set(key, running);
  return running.finally(() => { if (sharedQueues.get(key) === running) sharedQueues.delete(key); });
}

export function createDramaPlanStore({ libraryDirectory } = {}) {
  if (typeof libraryDirectory !== 'string' || !libraryDirectory) throw new DramaPlanError('制作计划存储未配置', 'DRAMA_STORAGE_UNAVAILABLE', 503);
  const userDirectory = path.dirname(path.resolve(libraryDirectory));
  const rootDirectory = path.join(userDirectory, 'private', 'agent-drama');

  async function privateDirectory(projectId) {
    const directory = path.join(rootDirectory, hash(requireDramaProjectId(projectId)));
    await mkdir(userDirectory, { recursive: true });
    // Fail closed if a local junction exposes plans through /library or another user root.
    const actualUserRoot = await realpath(userDirectory);
    for (const part of [path.join(userDirectory, 'private'), rootDirectory, directory]) {
      const existing = await lstat(part).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) throw new DramaPlanError('制作计划私有目录不可使用链接', 'DRAMA_STORAGE_UNAVAILABLE', 503);
      if (!existing) await mkdir(part).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      if ((await lstat(part)).isSymbolicLink()) throw new DramaPlanError('制作计划私有目录不可使用链接', 'DRAMA_STORAGE_UNAVAILABLE', 503);
    }
    const actual = await realpath(directory);
    const relative = path.relative(actualUserRoot, actual);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new DramaPlanError('制作计划存储不在当前用户范围', 'DRAMA_STORAGE_UNAVAILABLE', 503);
    return directory;
  }

  async function filename(id, projectId) {
    return path.join(await privateDirectory(projectId), `${requireDramaPlanId(id)}.json`);
  }

  async function readRecord(id, projectId) {
    const file = await filename(id, projectId);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_500_000) throw new Error('invalid record');
      const record = JSON.parse(await readFile(file, 'utf8'));
      if (record.schemaVersion !== 1 || record.id !== id || record.projectId !== projectId
          || !['pending', 'complete', 'failed'].includes(record.state)
          || typeof record.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint)) throw new Error('invalid record');
      if (record.state === 'complete') {
        record.plan = validateDramaPlan(record.plan);
        if (record.plan.id !== id || record.plan.projectId !== projectId) throw new Error('invalid scope');
      }
      return record;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof DramaPlanError && error.code === 'DRAMA_STORAGE_UNAVAILABLE') throw error;
      throw new DramaPlanError('制作计划记录无法读取，原文件已保留', 'DRAMA_PLAN_STORE_CORRUPT', 500);
    }
  }

  async function get(id, projectId) {
    const record = await readRecord(requireDramaPlanId(id), requireDramaProjectId(projectId));
    return record?.state === 'complete' ? record.plan : null;
  }

  async function list(projectId) {
    const directory = await privateDirectory(projectId);
    const names = await readdir(directory);
    const plans = [];
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const plan = await get(name.slice(0, -5), projectId);
      if (plan) plans.push(plan);
    }
    return plans.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function findRequest(projectId, requestId) {
    const { id } = requestIdentity(projectId, requestId);
    const record = await readRecord(id, projectId);
    return record ? { state: record.state, fingerprint: record.fingerprint, plan: record.plan ?? null } : null;
  }

  async function withPlanningRequest({ projectId, requestId, fingerprint }, operation) {
    const { id, requestHash } = requestIdentity(projectId, requestId);
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new DramaPlanError('请求指纹无效');
    const key = `${rootDirectory}\0${id}`;
    const active = activePlanningRequests.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new DramaPlanError('同一请求标识不能用于不同剧本或模型', 'DRAMA_REQUEST_CONFLICT', 409);
      return active.promise;
    }
    const promise = queued(key, async () => {
      const existing = await readRecord(id, projectId);
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.requestHash !== requestHash) throw new DramaPlanError('请求标识已用于其他内容', 'DRAMA_REQUEST_CONFLICT', 409);
        if (existing.state === 'complete') return existing.plan;
        throw new DramaPlanError('该次规划请求已提交或结果不明确，不会自动重复调用；如需重试请重新确认', 'DRAMA_PLANNING_NOT_REPLAYABLE', 409);
      }
      const file = await filename(id, projectId);
      const record = { schemaVersion: 1, id, projectId, requestHash, fingerprint, state: 'pending', plan: null };
      // Durable admission occurs BEFORE the only potentially paid text-model call.
      await atomicJson(file, record);
      try {
        const generated = validateDramaPlan(await operation());
        if (generated.projectId !== projectId) throw new DramaPlanError('规划结果项目不匹配');
        const plan = validateDramaPlan({ ...generated, id, revision: 1, approvedRevision: undefined });
        await atomicJson(file, { ...record, state: 'complete', plan });
        return plan;
      } catch (error) {
        await atomicJson(file, { ...record, state: 'failed' }).catch(() => undefined);
        throw error;
      }
    });
    activePlanningRequests.set(key, { fingerprint, promise });
    try { return await promise; }
    finally { if (activePlanningRequests.get(key)?.promise === promise) activePlanningRequests.delete(key); }
  }

  async function create(plan, { requestId, fingerprint }) {
    return withPlanningRequest({ projectId: plan.projectId, requestId, fingerprint }, async () => plan);
  }

  async function change(id, projectId, expectedRevision, mutate) {
    requireDramaPlanId(id);
    requireDramaProjectId(projectId);
    requireDramaRevision(expectedRevision);
    return queued(`${rootDirectory}\0${id}`, async () => {
      const record = await readRecord(id, projectId);
      if (record?.state !== 'complete') throw new DramaPlanError('制作计划不存在', 'DRAMA_PLAN_NOT_FOUND', 404);
      if (record.plan.revision !== expectedRevision) throw new DramaPlanError('制作计划已更新，请重新读取并合并修改', 'DRAMA_REVISION_CONFLICT', 409);
      const plan = validateDramaPlan(mutate(record.plan));
      await atomicJson(await filename(id, projectId), { ...record, plan });
      return plan;
    });
  }

  async function update(id, projectId, { expectedRevision, plan: patch }) {
    assertDramaObject(patch, ['title', 'assets', 'segments', 'questions'], '审核后的制作计划');
    if (!['title', 'assets', 'segments', 'questions'].every((key) => Object.hasOwn(patch, key))) throw new DramaPlanError('请提交完整审核内容');
    return change(id, projectId, expectedRevision, (plan) => ({ ...plan, ...patch,
      revision: plan.revision + 1, approvedRevision: undefined, updatedAt: new Date().toISOString() }));
  }

  async function approve(id, projectId, { expectedRevision }) {
    return change(id, projectId, expectedRevision, (plan) => {
      assertDramaPlanReviewable(plan);
      return { ...plan, approvedRevision: plan.revision, updatedAt: new Date().toISOString() };
    });
  }

  return { get, list, findRequest, withPlanningRequest, create, update, approve };
}
