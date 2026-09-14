import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import express from 'express';

export class PlanError extends Error {
  constructor(message, code = 'INVALID_PLAN', status = 400) { super(message); Object.assign(this, { code, status }); }
}
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const clone = value => structuredClone(value);
function normalizePlan(value, now) {
  if (!id(value?.id) || !id(value.sessionId) || !text(value.projectId, 255) || !value.projectId || !Array.isArray(value.items) || !value.items.length || value.items.length > 20) throw new PlanError('生成批次无效。');
  const seen = new Set();
  const items = value.items.map(item => {
    if (!text(item?.nodeId, 255) || !item.nodeId || seen.has(item.nodeId) || !text(item.title, 500) || !text(item.model, 255) || !text(item.parameters, 100000)
      || !Number.isInteger(item.count) || item.count < 1 || item.count > 100 || !Array.isArray(item.references) || item.references.length > 500 || item.references.some(ref => !text(ref, 500))) throw new PlanError('批次节点无效。');
    seen.add(item.nodeId);
    return { nodeId: item.nodeId, title: item.title, model: item.model, parameters: item.parameters, count: item.count, references: item.references,
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [], state: 'pending' };
  });
  if (items.reduce((sum, item) => sum + item.count, 0) > 100 || items.some(item => item.dependsOn.length > 20 || item.dependsOn.some(dep => !seen.has(dep) || dep === item.nodeId))) throw new PlanError('批次依赖或数量无效。');
  const done = new Set();
  while (done.size < items.length) {
    const next = items.find(item => !done.has(item.nodeId) && item.dependsOn.every(dep => done.has(dep)));
    if (!next) throw new PlanError('批次存在循环依赖。'); done.add(next.nodeId);
  }
  return { id: value.id, projectId: value.projectId, sessionId: value.sessionId, state: 'pending', expiresAt: now() + 600000, items, revision: 1 };
}
/** One store per authenticated local user. The write queue and atomic rename protect claims. */
export function createGenerationPlanStore(privateDirectory, { now = Date.now } = {}) {
  const executionOwner = crypto.randomUUID();
  const root = path.join(privateDirectory, 'generation-plans');
  const queues = new Map();
  const filename = projectId => {
    if (!text(projectId, 255) || !projectId) throw new PlanError('项目无效。');
    return path.join(root, crypto.createHash('sha256').update(projectId).digest('hex') + '.json');
  };
  const read = async projectId => {
    try {
      const data = JSON.parse(await readFile(filename(projectId), 'utf8'));
      if (data.projectId !== projectId || !Array.isArray(data.plans)) throw Error('Invalid journal');
      return data.plans;
    } catch (error) { if (error.code === 'ENOENT') return []; throw new PlanError('批次记录无法读取，已保留原文件。', 'PLAN_JOURNAL_UNAVAILABLE', 503); }
  };
  const update = async (projectId, work) => {
    const file = filename(projectId), previous = queues.get(file) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const plans = await read(projectId), result = await work(plans);
      await mkdir(root, { recursive: true });
      const temp = file + '.' + crypto.randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify({ projectId, plans }), { mode: 0o600 }); await rename(temp, file); return clone(result);
    });
    queues.set(file, pending);
    try { return await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
  };
  const find = (plans, planId) => { const plan = plans.find(plan => plan.id === planId); if (!plan) throw new PlanError('批次不存在。', 'PLAN_NOT_FOUND', 404); return plan; };
  const reconcile = plans => {
    for (const plan of plans) {
      if (plan.state === 'pending' && plan.expiresAt <= now() || plan.state === 'running' && plan.executionOwner !== executionOwner) {
        plan.state = 'finished'; plan.revision++;
        plan.items.forEach(item => { if (item.state === 'submitted') item.state = 'unconfirmed'; else if (item.state === 'pending') item.state = 'stopped'; });
      }
    }
    return plans;
  };
  return {
    list: projectId => update(projectId, reconcile),
    prepare: value => {
      const plan = normalizePlan(value, now);
      return update(plan.projectId, plans => {
        reconcile(plans);
        const old = plans.find(item => item.id === plan.id);
        if (old) {
          const comparable = item => JSON.stringify([item.sessionId, item.items.map(({ nodeId, title, model, parameters, count, references, dependsOn }) => ({ nodeId, title, model, parameters, count, references, dependsOn }))]);
          if (comparable(old) !== comparable(plan)) throw new PlanError('批次编号内容不一致。', 'PLAN_CONFLICT', 409);
          return old;
        }
        if (plans.length >= 100) {
          const discard = plans.findIndex(item => ['finished', 'cancelled'].includes(item.state));
          if (discard < 0) throw new PlanError('待核对批次过多。', 'PLAN_LIMIT', 409); plans.splice(discard, 1);
        }
        plans.push(plan); return plan;
      });
    },
    claim: (projectId, planId, revision) => update(projectId, plans => {
      const plan = find(plans, planId);
      if (plan.revision !== revision || plan.state !== 'pending' || plan.expiresAt <= now()) throw new PlanError('批次已确认、过期或发生变化。', 'PLAN_CONFLICT', 409);
      plan.state = 'running'; plan.executionOwner = executionOwner; plan.revision++; plan.claimedAt = now(); return plan;
    }),
    record: (projectId, planId, revision, nodeId, state, attemptId) => update(projectId, plans => {
      const plan = find(plans, planId), item = plan.items.find(item => item.nodeId === nodeId);
      if (plan.revision !== revision || plan.state !== 'running' || !item) throw new PlanError('批次已变化。', 'PLAN_CONFLICT', 409);
      const allowed = { pending: ['submitted', 'stopped'], submitted: ['success', 'failed', 'unconfirmed'] };
      if (!allowed[item.state]?.includes(state) || state === 'submitted' && !id(attemptId)) throw new PlanError('批次状态转换无效。');
      if (state === 'submitted' && item.dependsOn.some(dep => plan.items.find(candidate => candidate.nodeId === dep)?.state !== 'success')) throw new PlanError('上游结果尚未确认。', 'PLAN_DEPENDENCY', 409);
      item.state = state; if (attemptId) item.attemptId = attemptId;
      plan.revision++; plan.updatedAt = now(); return plan;
    }),
    finish: (projectId, planId, revision) => update(projectId, plans => {
      const plan = find(plans, planId);
      if (plan.revision !== revision) throw new PlanError('批次已变化。', 'PLAN_CONFLICT', 409);
      for (const item of plan.items) { if (item.state === 'pending') item.state = 'stopped'; else if (item.state === 'submitted') item.state = 'unconfirmed'; }
      plan.state = plan.state === 'pending' ? 'cancelled' : 'finished'; plan.revision++; return plan;
    }),
  };
}
export function createGenerationPlanRouter(store) {
  const router = express.Router();
  const route = work => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await work(req)); }
    catch (error) { res.status(error instanceof PlanError ? error.status : 500).json({ error: error instanceof PlanError ? error.message : '批次操作未确认。', code: error.code || 'PLAN_UNCONFIRMED' }); }
  };
  router.get('/', route(req => store.list(req.query.projectId)));
  router.post('/', route(req => store.prepare(req.body)));
  router.post('/:id/claim', route(req => store.claim(req.body?.projectId, req.params.id, req.body?.revision)));
  router.post('/:id/record', route(req => store.record(req.body?.projectId, req.params.id, req.body?.revision, req.body?.nodeId, req.body?.state, req.body?.attemptId)));
  router.post('/:id/finish', route(req => store.finish(req.body?.projectId, req.params.id, req.body?.revision)));
  return router;
}
