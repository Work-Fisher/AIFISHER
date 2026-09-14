import { doubaoThinkingParameters } from '../../providers/doubaoThinking.js';
import crypto from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';
import { loadModelCatalog } from '../../config/modelCatalog.js';
import { GENERATION_PROVIDER_CONTRACTS } from '../../generation/generationProviderCatalog.js';
import { classifyGenerationError, getUpstreamStatus } from '../../generation/generationErrors.js';
import { submitOpenAiChatWithLogs } from '../../providers/providerKit.js';
import { resolveRelayCredentials, resolveRelayRequestUrl } from '../../providers/relayProvider.js';
import { assertDramaObject, DramaPlanError, DRAMA_PLAN_LIMITS, requireDramaProjectId } from './dramaPlan.js';
import { resolveMediaArtifact } from '../../media/mediaArtifact.js';

const TEXT_PROVIDERS = new Set(['DoubaoTextProvider', 'DeepSeekProvider', 'GlmTextProvider', 'KimiTextProvider', 'RelayTextProvider']);
const CREDENTIAL_ALIASES = Object.freeze({ ARK_API_KEY: 'arkApiKey', DEEPSEEK_API_KEY: 'deepSeekApiKey', ZHIPU_API_KEY: 'zhipuApiKey', MOONSHOT_API_KEY: 'moonshotApiKey', RELAY_API_KEY: 'relayApiKey' });
const SECRET_BY_PROVIDER = new Map(GENERATION_PROVIDER_CONTRACTS.filter((item) => TEXT_PROVIDERS.has(item.name)).map((item) => [item.name, item.requiredSecrets[0]]));
const SAFE_FAILURES = Object.freeze({
  PROVIDER_BALANCE_INSUFFICIENT: '文本模型余额不足，请检查模型账户；本次未自动重试',
  PROVIDER_TOKEN_QUOTA_INSUFFICIENT: '文本模型 API Key 独立额度不足，请检查额度；本次未自动重试',
  PROVIDER_RATE_LIMIT: '文本模型当前繁忙；本次未自动重试',
  PROVIDER_AUTH_FAILED: '文本模型服务未接受当前密钥，请检查密钥有效性和模型调用权限',
  PROVIDER_CREDENTIAL_MISSING: '尚未配置文本模型服务的密钥，请到设置中连接当前来源并保存自己的密钥',
  PROVIDER_NETWORK_ERROR: '文本模型连接中断，提交结果可能不明确；本次不会自动重放',
  UPSTREAM_INVALID_RESPONSE: '文本模型返回无效响应；本次不会自动重放',
  GENERATION_TIMEOUT: '文本规划等待超时；本次不会自动重放',
});
function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve only this authenticated user's current-project images; never fetch URLs or arbitrary paths. */
export async function imageContent(media, { libraryDirectory, projectId, model, detail }) {
  if (media == null || (Array.isArray(media) && !media.length)) return [];
  const allowedCount = model.languageModes?.find((mode) => mode.value === 'multimodal-chat')?.allowedInputs?.image || 0;
  if (!allowedCount) throw new DramaPlanError('当前文本模型不支持参考图片，请选择支持图片的模型，或移除附件并取消画布图片选择后发送；本轮未调用模型', 'DRAMA_MODEL_IMAGES_UNSUPPORTED');
  if (!Array.isArray(media) || media.length > allowedCount) throw new DramaPlanError('参考图片数量超出当前模型范围', 'DRAMA_CHAT_MEDIA_INVALID');
  const detailParameter = model.advancedParams?.find((parameter) => parameter.key === 'detail');
  const detailDefault = detailParameter?.options?.some((option) => option.value === detailParameter.default) ? detailParameter.default : 'auto';
  const imageDetail = detail ?? detailDefault;
  const result = [];
  for (const item of media) {
    assertDramaObject(item, ['type', 'base64', 'url'], '参考图片');
    if (item.type !== 'image' || Boolean(item.base64) === Boolean(item.url)) throw new DramaPlanError('参考图片无效', 'DRAMA_CHAT_MEDIA_INVALID');
    const raw = item.base64 || item.url;
    if (typeof raw !== 'string') throw new DramaPlanError('参考图片过大或无效', 'DRAMA_CHAT_MEDIA_INVALID');
    let buffer;
    let declaredMime;
    let filename;
    try {
      if (raw.startsWith('/library/media/')) {
        if (!libraryDirectory) throw new Error('missing scoped library');
        const decoded = decodeURIComponent(raw.split('?')[0]);
        const parts = decoded.split('/');
        if (parts.length !== 6 || parts[1] !== 'library' || parts[2] !== 'media' || parts[3] !== projectId || parts[4] !== 'images'
          // eslint-disable-next-line no-control-regex -- Reject control characters in decoded local media paths.
          || !parts[5] || /^\./.test(parts[5]) || /[\\:%#?\x00-\x1f]/.test(decoded)) throw new Error('invalid project image path');
        filename = parts[5];
        const root = await realpath(libraryDirectory);
        const expectedImages = path.join(root, 'media', projectId, 'images');
        const images = await realpath(expectedImages);
        const normalizePathCase = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
        if (!within(root, images) || normalizePathCase(images) !== normalizePathCase(expectedImages)) throw new Error('image root escapes project');
        const file = await realpath(path.join(images, filename));
        if (!within(images, file)) throw new Error('image escapes scope');
        const handle = await open(file, 'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) throw new Error('image too large');
          // Read a fixed bounded allocation even if the file grows during this request.
          const bounded = Buffer.alloc(stat.size + 1);
          const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0);
          if (bytesRead !== stat.size) throw new Error('image changed while reading');
          buffer = bounded.subarray(0, bytesRead);
        } finally { await handle.close(); }
      } else {
        const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([\s\S]+)$/i.exec(raw);
        declaredMime = match?.[1]?.toLowerCase();
        const encoded = (match?.[2] || raw).replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('invalid base64');
        buffer = Buffer.from(encoded, 'base64');
        if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('invalid base64');
      }
      if (!buffer.length) throw new Error('image size out of bounds');
      const artifact = resolveMediaArtifact({ filename, prefix: buffer.subarray(0, 32), contentType: declaredMime, requireRecognizedContent: true });
      if (artifact.kind !== 'image' || (declaredMime && artifact.mimeType !== declaredMime)) throw new Error('not the declared image');
      const format = artifact.mimeType.slice('image/'.length);
      const supportedFormats = Array.isArray(model.supportedImageFormats) ? model.supportedImageFormats : [];
      if (supportedFormats.length && !supportedFormats.includes(format)) throw new Error('image format unsupported');
      const outputArtifact = resolveMediaArtifact({ filename, prefix: buffer.subarray(0, 32), contentType: declaredMime, requireRecognizedContent: true });
      if (outputArtifact.kind !== 'image' || (declaredMime && outputArtifact.mimeType !== declaredMime)) throw new Error('optimized image invalid');
      const outputFormat = outputArtifact.mimeType.slice('image/'.length);
      if (supportedFormats.length && !supportedFormats.includes(outputFormat)) throw new Error('optimized image format unsupported');
      result.push({ type: 'image_url', image_url: { url: `data:${outputArtifact.mimeType};base64,${buffer.toString('base64')}`, detail: imageDetail } });
    } catch {
      throw new DramaPlanError('参考图片无法读取或不属于当前项目，亦可能超过大小或格式限制；请检查附件及画布所选图片，本轮未调用模型', 'DRAMA_CHAT_MEDIA_INVALID');
    }
  }
  return result;
}

function resolveModel(requested, catalog) {
  if (typeof requested !== 'string' || !requested.trim() || requested.length > 255) throw new DramaPlanError('请选择已连接的文本模型', 'DRAMA_MODEL_UNSUPPORTED');
  const entries = Object.values(catalog ?? {}).filter((entry) => TEXT_PROVIDERS.has(entry?.provider));
  const named = entries.filter((entry) => entry.name === requested);
  const matching = named.length ? named : entries.filter((entry) => entry.endpoint?.['multimodal-chat']?.model === requested);
  if (matching.length !== 1) throw new DramaPlanError('文本模型不受支持或来源不明确，请重新选择带来源的模型', 'DRAMA_MODEL_UNSUPPORTED');
  const model = matching[0];
  const endpoint = model.endpoint?.['multimodal-chat'];
  if (typeof endpoint?.model !== 'string' || !endpoint.model || typeof endpoint?.url !== 'string') throw new DramaPlanError('文本模型目录缺少端点配置', 'DRAMA_MODEL_UNAVAILABLE', 503);
  let url;
  try { url = new URL(endpoint.url); } catch { throw new DramaPlanError('文本模型端点无效', 'DRAMA_MODEL_UNAVAILABLE', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new DramaPlanError('文本模型端点不符合安全要求', 'DRAMA_MODEL_UNAVAILABLE', 503);
  return model;
}

/** Shared provider routing for chat and tool turns; credentials never cross sources. */
export function textModelConnection(model, supplied) {
  resolveModel(model.name, { selected: model });
  const secret = SECRET_BY_PROVIDER.get(model.provider);
  const apiKey = String(supplied?.[secret] || supplied?.[CREDENTIAL_ALIASES[secret]] || '').trim();
  if (!apiKey) throw new DramaPlanError('请先连接当前选择的文本模型来源', 'DRAMA_MODEL_CONFIGURATION_REQUIRED', 503);
  const endpoint = model.endpoint['multimodal-chat'];
  const url = model.provider === 'RelayTextProvider'
    ? resolveRelayRequestUrl(resolveRelayCredentials({ RELAY_API_KEY: apiKey }), endpoint.url) : endpoint.url;
  return { url, apiKey };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length !== 2 || messages[0]?.role !== 'system' || messages[1]?.role !== 'user') throw new DramaPlanError('规划消息必须包含独立的系统规则和剧本素材');
  return messages.map((message) => {
    assertDramaObject(message, ['role', 'content'], '规划消息');
    if (typeof message.content !== 'string' || !message.content.trim()) throw new DramaPlanError('规划消息为空或过长');
    // Preserve every character and its role; never reuse chat-history truncation here.
    return { role: message.role, content: message.content };
  });
}

export function modelParameters(value, model) {
  assertDramaObject(value, ['temperature', 'top_p', 'max_output_tokens', 'reasoning_effort', 'reasoning', 'detail'], '规划模型参数');
  const body = {};
  for (const key of ['reasoning', 'detail']) {
    if (value[key] === undefined) continue;
    const allowed = model.advancedParams?.find((entry) => entry.key === key)?.options?.map((item) => item.value) ?? [];
    if (!allowed.includes(value[key])) throw new DramaPlanError('该模型不支持所选对话参数');
  }
  // Image detail belongs to content blocks, not top-level request fields.
  for (const [key, maximum] of [['temperature', 2], ['top_p', 1]]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > maximum) throw new DramaPlanError('规划模型采样参数超出范围');
      body[key] = value[key];
    }
  }
  const tokenLimit = value.max_output_tokens;
  if (tokenLimit !== undefined) {
    if (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1) throw new DramaPlanError('输出长度须为正整数');
    body[model.provider === 'DoubaoTextProvider' ? 'max_output_tokens' : 'max_tokens'] = tokenLimit;
  }
  if (model.provider === 'DoubaoTextProvider') {
    Object.assign(body, doubaoThinkingParameters(value.reasoning));
    body.temperature ??= 1;
    body.top_p ??= 0.7;
  }
  if (model.provider === 'DeepSeekProvider') {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'high';
  }
  if (model.provider === 'GlmTextProvider' && model.endpoint['multimodal-chat'].model.startsWith('glm-5.3')) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'max';
  }
  if (value.reasoning_effort !== undefined) {
    const allowed = model.advancedParams?.find((entry) => entry.key === 'reasoning_effort')?.options?.map((item) => item.value) ?? [];
    if (!allowed.includes(value.reasoning_effort)) throw new DramaPlanError('该模型不支持所选推理强度');
    body.reasoning_effort = value.reasoning_effort;
  }
  return body;
}

/** Uses the same streaming transport as existing text providers, with role-safe planning messages. */
export function createDramaModelGenerator({ modelCatalog = loadModelCatalog, getCredentials = () => ({}),
  telemetryReporter = null, submitChat = submitOpenAiChatWithLogs, timeoutMs = 0, libraryDirectory } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new DramaPlanError('规划观察时限无效');
  return async function generatePlan({ messages, media = [], model: requested, modelParams = {}, projectId, requestContext, onToken, signal }) {
    const model = resolveModel(requested, typeof modelCatalog === 'function' ? modelCatalog() : modelCatalog);
    const endpoint = model.endpoint['multimodal-chat'];
    const body = { model: endpoint.model, messages: normalizeMessages(messages), ...modelParameters(modelParams, model) };
    requireDramaProjectId(projectId);
    const images = await imageContent(media, { libraryDirectory, projectId, model, detail: modelParams.detail });
    if (images.length) body.messages[1].content = [{ type: 'text', text: body.messages[1].content }, ...images];
    let supplied;
    try { supplied = await getCredentials(); } catch { throw new DramaPlanError('无法读取当前用户的模型连接状态', 'DRAMA_MODEL_CONFIGURATION_REQUIRED', 503); }
    const { url, apiKey } = textModelConnection(model, supplied);
    const controller = new globalThis.AbortController();
    let timedOut = false;
    const timeout = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : undefined;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    requestContext?.once?.('aborted', abort);
    if (requestContext?.aborted) abort();
    let telemetry;
    try {
      if (telemetryReporter && requestContext) {
        try {
          telemetry = telemetryReporter.begin({
            category: 'agent', mediaType: 'text', operation: 'drama-plan', modelName: model.name,
            modelId: endpoint.model, provider: model.provider, requestId: requestContext.requestId });
        } catch { /* Diagnostic availability cannot authorize, block or replay a model call. */ }
      }
      controller.signal.throwIfAborted();
      const result = await submitChat({ url, headers: { Authorization: `Bearer ${apiKey}` }, body,
        signal: controller.signal, onToken, nodeId: `drama-plan-${crypto.randomUUID()}`, projectId,
        modelId: endpoint.model, useProxy: model.useProxy === true,
        // The plan store is the only copy of private scripts and generated plans; no raw request/result logs.
        logsDir: undefined, logBody: { model: endpoint.model, messages: '[Private drama planning content]' },
      });
      if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > DRAMA_PLAN_LIMITS.outputCharacters) throw new DramaPlanError('文本模型未返回完整且有界的制作计划', 'DRAMA_PLAN_OUTPUT_INVALID', 422);
      try { telemetry?.success(); } catch { /* Telemetry must not change the generation result. */ }
      return result.text;
    } catch (error) {
      const classified = classifyGenerationError(error);
      const cancelled = !timedOut && (controller.signal.aborted || classified.code === 'GENERATION_CANCELLED');
      const safe = error instanceof DramaPlanError ? error : new DramaPlanError(
        cancelled ? '已停止文本规划；本次不会自动重放' : timedOut ? '文本规划等待超时；本次不会自动重放' : SAFE_FAILURES[classified.code] ?? '文本规划未完成；本次不会自动重复调用',
        cancelled ? 'GENERATION_CANCELLED' : timedOut ? 'DRAMA_PLANNING_TIMEOUT' : 'DRAMA_PLANNING_PROVIDER_FAILED',
        cancelled ? 499 : timedOut ? 504 : classified.status,
      );
      safe.upstreamStatus = getUpstreamStatus(error);
      if (error.diagnostics) safe.diagnostics = error.diagnostics;
      try { telemetry?.fail(safe); } catch { /* Only the sanitized failure may be observed. */ }
      throw safe;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      requestContext?.off?.('aborted', abort);
    }
  };
}
