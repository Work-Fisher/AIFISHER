import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import express from 'express';
import { generationBudgetProfile } from '../../../src/shared/generationBudgetProfile.js';
import { PlanError } from './generationPlanStore.js';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const integer = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const publicGrant = grant => ({ id: grant.id, projectId: grant.projectId, sessionId: grant.sessionId, state: grant.state, expiresAt: grant.expiresAt,
  maxRequests: grant.maxRequests, maxOutputs: grant.maxOutputs, budgetMicros: grant.budgetMicros, profiles: grant.profiles,
  usedRequests: grant.reservations.length, usedOutputs: grant.reservations.reduce((sum, item) => sum + item.count, 0),
  reservedMicros: grant.reservations.reduce((sum, item) => sum + item.micros, 0) });
/** Financial authorization is separate from model-generated plans and can only be activated by the product UI. */
export function createGenerationBudgetStore(privateDirectory, { now = Date.now, getSourceFingerprint = () => '', isSessionActive = () => true } = {}) {
  const root = path.join(privateDirectory, 'generation-budgets'), queues = new Map();
  const filename = project => {
    if (typeof project !== 'string' || !project || project.length > 255) throw new PlanError('项目无效。');
    return path.join(root, crypto.createHash('sha256').update(project).digest('hex') + '.json');
  };
  const read = async project => {
    try { const value = JSON.parse(await readFile(filename(project), 'utf8')); if (value.projectId !== project || !Array.isArray(value.grants)) throw Error(); return value.grants; }
    catch (error) { if (error.code === 'ENOENT') return []; throw new PlanError('预算记录无法读取。', 'BUDGET_UNAVAILABLE', 503); }
  };
  const mutate = async (project, operation) => {
    const file = filename(project), previous = queues.get(file) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const grants = await read(project), result = operation(grants);
      await mkdir(root, { recursive: true });
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify({ projectId: project, grants }), { mode: 0o600 }); await rename(temporary, file);
      return structuredClone(result);
    });
    queues.set(file, pending);
    try { return await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
  };
  const find = (grants, grantId) => { const grant = grants.find(grant => grant.id === grantId); if (!grant) throw new PlanError('授权不存在。', 'BUDGET_NOT_FOUND', 404); return grant; };
  return {
    list: async project => (await read(project)).map(publicGrant),
    prepare(value) {
      if (!id(value?.id) || !id(value.sessionId) || !integer(value.maxRequests, 100) || !integer(value.maxOutputs, 1000) || !integer(value.minutes, 1440)
        || !Array.isArray(value.sampleRequests) || !value.sampleRequests.length || value.sampleRequests.length > 20
        || value.budgetMicros !== null && (!Number.isSafeInteger(value.budgetMicros) || value.budgetMicros < 0 || value.budgetMicros > 1000000000000)) throw new PlanError('预算申请无效。');
      const profiles = [...new Set(value.sampleRequests.map(sample => {
        if (!sample || sample.projectId !== value.projectId || JSON.stringify(sample).length > 200000 || ![sample.imageModel, sample.videoModel, sample.audioModel, sample.textModel].some(model => typeof model === 'string' && model)) throw new PlanError('预算模型配置无效。');
        return generationBudgetProfile(sample);
      }))];
      return mutate(value.projectId, grants => {
        const old = grants.find(grant => grant.id === value.id);
        if (old) {
          if (JSON.stringify([old.profiles, old.maxRequests, old.maxOutputs, old.budgetMicros, old.sessionId, old.minutes]) !== JSON.stringify([profiles, value.maxRequests, value.maxOutputs, value.budgetMicros, value.sessionId, value.minutes])) throw new PlanError('授权编号冲突。', 'BUDGET_CONFLICT', 409);
          return publicGrant(old);
        }
        if (grants.length >= 100) { const index = grants.findIndex(grant => grant.expiresAt < now() || grant.state === 'revoked'); if (index < 0) throw new PlanError('授权记录过多。'); grants.splice(index, 1); }
        const grant = { id: value.id, projectId: value.projectId, sessionId: value.sessionId, state: 'pending', profiles, maxRequests: value.maxRequests, maxOutputs: value.maxOutputs,
          budgetMicros: value.budgetMicros, minutes: value.minutes, sourceFingerprint: getSourceFingerprint(), expiresAt: now() + value.minutes * 60000, reservations: [] };
        grants.push(grant); return publicGrant(grant);
      });
    },
    approve: (project, grantId) => mutate(project, grants => {
      const grant = find(grants, grantId);
      if (grant.state !== 'pending' || grant.expiresAt <= now()) throw new PlanError('授权已处理或过期。', 'BUDGET_CONFLICT', 409);
      if (!isSessionActive(grant.sessionId)) throw new PlanError('所属外部连接已失效。', 'BUDGET_INACTIVE', 403);
      if (grant.sourceFingerprint !== getSourceFingerprint()) throw new PlanError('模型连接配置已变化，请重新申请授权。', 'BUDGET_SCOPE', 403);
      grant.state = 'approved'; return publicGrant(grant);
    }),
    revoke: (project, grantId) => mutate(project, grants => { const grant = find(grants, grantId); grant.state = 'revoked'; return publicGrant(grant); }),
    revokeSession: (project, sessionId) => mutate(project, grants => { for (const grant of grants) if (grant.sessionId === sessionId) grant.state = 'revoked'; return { success: true }; }),
    reserve: ({ projectId, authorizationId, request, maximumChargeMicros }) => mutate(projectId, grants => {
      const grant = find(grants, authorizationId), count = request.generateCount ?? 1;
      if (grant.state !== 'approved' || grant.expiresAt <= now()) throw new PlanError('生成授权已过期或撤销。', 'BUDGET_INACTIVE', 403);
      if (!isSessionActive(grant.sessionId)) throw new PlanError('所属外部连接已失效。', 'BUDGET_INACTIVE', 403);
      if (grant.sourceFingerprint !== getSourceFingerprint()) throw new PlanError('模型连接配置已变化，请重新申请授权。', 'BUDGET_SCOPE', 403);
      if (request.projectId !== projectId || !id(request.generationAttemptId) || !integer(count, 100) || !grant.profiles.includes(generationBudgetProfile(request))) throw new PlanError('实际生成参数超出授权。', 'BUDGET_SCOPE', 403);
      if (grant.reservations.some(item => item.attemptId === request.generationAttemptId)) throw new PlanError('该尝试已经占用授权，请查询原任务。', 'BUDGET_DUPLICATE', 409);
      if (grant.reservations.length >= grant.maxRequests || grant.reservations.reduce((sum, item) => sum + item.count, 0) + count > grant.maxOutputs) throw new PlanError('已达到授权次数或数量上限。', 'BUDGET_EXHAUSTED', 403);
      let micros = 0;
      if (grant.budgetMicros !== null) {
        if (!Number.isSafeInteger(maximumChargeMicros) || maximumChargeMicros < 0) throw new PlanError('当前来源未提供可验证的费用上界，不能按硬预算自动提交。', 'BUDGET_COST_UNBOUNDED', 403);
        micros = maximumChargeMicros;
        if (grant.reservations.reduce((sum, item) => sum + item.micros, 0) + micros > grant.budgetMicros) throw new PlanError('本次请求会超出预算。', 'BUDGET_EXHAUSTED', 403);
      }
      grant.reservations.push({ attemptId: request.generationAttemptId, nodeId: request.nodeId, count, micros, reservedAt: now() });
      return publicGrant(grant);
    }),
  };
}
export function createGenerationBudgetRouter(store) {
  const router = express.Router();
  const route = work => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await work(req)); }
    catch (error) { res.status(error instanceof PlanError ? error.status : 500).json({ error: error instanceof PlanError ? error.message : '预算操作未确认。', code: error.code || 'BUDGET_UNAVAILABLE' }); }
  };
  router.get('/', route(req => store.list(req.query.projectId)));
  router.post('/', route(req => store.prepare(req.body)));
  router.post('/:id/approve', route(req => store.approve(req.body?.projectId, req.params.id)));
  router.post('/:id/revoke', route(req => store.revoke(req.body?.projectId, req.params.id)));
  return router;
}
