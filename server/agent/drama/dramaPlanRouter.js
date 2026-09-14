import crypto from 'node:crypto';
import express from 'express';
import {
  assertDramaObject, createDramaPlanningPrompt, DramaPlanError, normalizeDramaScript,
  parseGeneratedDramaPlan, requireDramaPlanId, requireDramaProjectId, requireDramaRevision,
} from './dramaPlan.js';
import { createDramaPlanStore } from './dramaPlanStore.js';
import { OFFICIAL_DRAMA_BUNDLE, readOfficialDramaInstructions } from './officialDramaBundle.js';
import { DramaExecutionError } from './dramaExecutionService.js';

function safeModelParams(value = {}, depth = 0) {
  if (depth > 4) throw new DramaPlanError('模型参数层级过深');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if ((typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 2_000)) throw new DramaPlanError('模型参数无效');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) throw new DramaPlanError('模型参数过多');
    return value.map((item) => safeModelParams(item, depth + 1));
  }
  assertDramaObject(value, Object.keys(value ?? {}).filter((key) => !['__proto__', 'prototype', 'constructor'].includes(key)), '模型参数');
  if (Object.keys(value).length > 30) throw new DramaPlanError('模型参数过多');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeModelParams(item, depth + 1)]));
}

function planningInput(body) {
  assertDramaObject(body, ['projectId', 'script', 'model', 'modelParams', 'requestId', 'confirmPaidExecution', 'maxPlanningCalls']);
  if (body.confirmPaidExecution !== true || body.maxPlanningCalls !== 1) {
    throw new DramaPlanError('请明确确认本次最多一次文本模型规划调用；此确认不包含图片或视频生成', 'DRAMA_PLANNING_CONFIRMATION_REQUIRED', 409);
  }
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 255) throw new DramaPlanError('请选择已配置的文本模型');
  if (body.modelParams !== undefined && (body.modelParams === null || Array.isArray(body.modelParams) || typeof body.modelParams !== 'object')) throw new DramaPlanError('模型参数无效');
  const modelParams = safeModelParams(body.modelParams ?? {});
  if (JSON.stringify(modelParams).length > 8_000) throw new DramaPlanError('模型参数过长');
  return { projectId: requireDramaProjectId(body.projectId), script: normalizeDramaScript(body.script),
    model: body.model.trim(), modelParams, requestId: body.requestId };
}

function route(action) {
  return async (request, response) => {
    try { await action(request, response); }
    catch (error) {
      // Only this module's fixed messages cross the HTTP boundary. Provider/filesystem errors may contain secrets.
      const known = error instanceof DramaPlanError || error instanceof DramaExecutionError;
      response.status(known ? error.status : 500).json({
        error: known ? error.message : '制作计划操作未完成；本次不会自动重复调用，请查看任务状态后重试',
        code: known ? error.code : 'DRAMA_OPERATION_FAILED',
      });
    }
  };
}

export function createDramaPlanRouter({ libraryDirectory, store = createDramaPlanStore({ libraryDirectory }), generatePlan,
  executionService, readInstructions = readOfficialDramaInstructions, bundle = OFFICIAL_DRAMA_BUNDLE } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: Infinity, strict: true }));
  const requirePlan = async (id, projectId) => {
    const plan = await store.get(requireDramaPlanId(id), requireDramaProjectId(projectId));
    if (!plan) throw new DramaPlanError('制作计划不存在', 'DRAMA_PLAN_NOT_FOUND', 404);
    return plan;
  };
  const execution = () => {
    if (!executionService) throw new DramaPlanError('资产执行服务尚未就绪', 'DRAMA_EXECUTION_UNAVAILABLE', 503);
    return executionService;
  };
  const editPlan = (planId, projectId, action) => {
    if (!executionService) return action();
    if (typeof executionService.withEditablePlan !== 'function') throw new DramaPlanError('资产执行服务尚未就绪', 'DRAMA_EXECUTION_UNAVAILABLE', 503);
    return executionService.withEditablePlan({ planId, projectId }, action);
  };

  router.get('/bundle', route(async (_request, response) => response.json({ bundle })));
  router.get('/plans', route(async (request, response) => {
    assertDramaObject(request.query, ['projectId'], '查询参数');
    response.json({ plans: await store.list(requireDramaProjectId(request.query.projectId)) });
  }));
  router.post('/plans', route(async (request, response) => {
    const input = planningInput(request.body);
    if (typeof generatePlan !== 'function') throw new DramaPlanError('文本规划服务尚未就绪', 'DRAMA_PLANNING_UNAVAILABLE', 503);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...input, requestId: undefined })).digest('hex');
    const plan = await store.withPlanningRequest({ ...input, fingerprint }, async () => {
      const instructions = await readInstructions();
      const messages = createDramaPlanningPrompt({ script: input.script, instructions });
      const output = await generatePlan({ ...input, instructions, messages,
        prompt: messages.map((message) => message.content).join('\n\n'), requestContext: request });
      return parseGeneratedDramaPlan(output, input);
    });
    response.status(201).json({ plan });
  }));
  router.get('/plans/:id', route(async (request, response) => {
    assertDramaObject(request.query, ['projectId'], '查询参数');
    response.json({ plan: await requirePlan(request.params.id, request.query.projectId) });
  }));
  router.put('/plans/:id', route(async (request, response) => {
    assertDramaObject(request.body, ['projectId', 'expectedRevision', 'plan']);
    const id = requireDramaPlanId(request.params.id);
    const projectId = requireDramaProjectId(request.body.projectId);
    response.json({ plan: await editPlan(id, projectId, () => store.update(id, projectId, {
      expectedRevision: requireDramaRevision(request.body.expectedRevision), plan: request.body.plan,
    })) });
  }));
  router.post('/plans/:id/approve', route(async (request, response) => {
    assertDramaObject(request.body, ['projectId', 'expectedRevision']);
    const id = requireDramaPlanId(request.params.id);
    const projectId = requireDramaProjectId(request.body.projectId);
    response.json({ plan: await editPlan(id, projectId, () => store.approve(id, projectId, {
      expectedRevision: requireDramaRevision(request.body.expectedRevision),
    })) });
  }));

  router.get('/plans/:id/execution', route(async (request, response) => {
    assertDramaObject(request.query, ['projectId'], '查询参数');
    const plan = await requirePlan(request.params.id, request.query.projectId);
    response.json(await execution().getPlanExecution({ planId: plan.id, projectId: plan.projectId }));
  }));
  router.get('/plans/:id/assets/:assetId', route(async (request, response) => {
    assertDramaObject(request.query, ['projectId', 'attemptId'], '查询参数');
    const plan = await requirePlan(request.params.id, request.query.projectId);
    response.json(await execution().getAsset({ planId: plan.id, projectId: plan.projectId,
      assetId: request.params.assetId, attemptId: request.query.attemptId }));
  }));
  router.post('/plans/:id/assets/:assetId/generate', route(async (request, response) => {
    assertDramaObject(request.body, ['projectId', 'planRevision', 'attemptId', 'confirmPaidExecution', 'maxAssets', 'retryOfAttemptId']);
    const plan = await requirePlan(request.params.id, request.body.projectId);
    response.json(await execution().beginAsset({ ...request.body, planId: plan.id, projectId: plan.projectId,
      assetId: request.params.assetId }, request.app.locals));
  }));
  router.post('/plans/:id/compose', route(async (request, response) => {
    assertDramaObject(request.body, ['projectId', 'planRevision', 'confirmAssets']);
    const plan = await requirePlan(request.params.id, request.body.projectId);
    response.json(await execution().compose({ ...request.body, planId: plan.id, projectId: plan.projectId }));
  }));
  router.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    const oversized = error?.type === 'entity.too.large';
    response.status(oversized ? 413 : 400).json({
      error: oversized ? '制作计划请求超过 2 MB，请缩小剧本范围' : '制作计划请求不是有效的 JSON',
      code: oversized ? 'DRAMA_REQUEST_TOO_LARGE' : 'INVALID_DRAMA_JSON',
    });
  });
  return router;
}
