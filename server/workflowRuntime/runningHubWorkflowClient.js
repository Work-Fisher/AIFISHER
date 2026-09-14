import { readRunningHubPageCover } from './runningHubCover.js';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_JSON_STRING_BYTES = 1024 * 1024;
const MAX_JSON_ITEMS = 500_000;
const MAX_AI_DETAIL_JSON_BYTES = 4 * 1024 * 1024;
const MAX_AI_DETAIL_HTML_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const SAFE_REMOTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const RUNNINGHUB_HOSTS = new Set(['www.runninghub.cn', 'runninghub.cn', 'www.runninghub.ai', 'runninghub.ai']);
const RUNNINGHUB_V2_API_BASE_URL = 'https://www.runninghub.cn';
const OUTPUT_HOST_SUFFIXES = [
  'runninghub.cn',
  'runninghub.ai',
  'xiaoyaoyou.com',
  'rh-images-1252422369.cos.ap-beijing.myqcloud.com',
];
const RUNNINGHUB_INSTANCE_TYPES = new Set(['default', 'plus']);
export const RUNNINGHUB_WEBAPP_PROTOCOLS = Object.freeze({
  legacy: 'legacy-webapp-v1',
  aiAppV2: 'ai-app-v2',
});

export class RunningHubWorkflowClientError extends Error {
  constructor(message, code = 'RUNNINGHUB_WORKFLOW_ERROR', status = 502, retryable = false) {
    super(message);
    this.name = 'RunningHubWorkflowClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function sanitizeProviderMessage(value, fallback = 'RunningHub 请求失败') {
  const message = String(value || fallback)
    .replace(/[\r\n]+/g, ' ')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,;]+/g, '[本机路径]')
    .replace(/\b(?:api[_ -]?key|authorization|bearer|token|secret|password)\b\s*[:=]?\s*[^\s,;]+/gi, '[敏感信息]')
    .slice(0, 500);
  return message || fallback;
}

function providerFailureReason(value, fallback = 'RunningHub 工作流执行失败') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return sanitizeProviderMessage(value, fallback);
  }
  const nodeName = sanitizeProviderMessage(value.node_name || value.nodeName || '', '').slice(0, 120);
  const nodeId = String(value.node_id || value.nodeId || '')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 80);
  const message = sanitizeProviderMessage(
    value.exception_message
      || value.errorMessage
      || value.message
      || value.exception_type
      || value.errorType,
    fallback,
  );
  const node = nodeName
    ? `${nodeName}${nodeId ? `（节点 ${nodeId}）` : ''}`
    : (nodeId ? `节点 ${nodeId}` : '');
  return node ? `${node}：${message}` : message;
}

export function normalizeRunningHubBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new RunningHubWorkflowClientError(
      'RunningHub 地址无效',
      'INVALID_RUNNINGHUB_BASE_URL',
      400,
    );
  }
  if (
    url.protocol !== 'https:'
    || !RUNNINGHUB_HOSTS.has(url.hostname.toLowerCase())
    || url.username
    || url.password
    || url.search
    || url.hash
    || !['', '/'].includes(url.pathname)
  ) {
    throw new RunningHubWorkflowClientError(
      'RunningHub 地址必须是官方 HTTPS 根地址',
      'INVALID_RUNNINGHUB_BASE_URL',
      400,
    );
  }
  return `${url.protocol}//${url.host}`;
}

export function assertRunningHubRemoteId(value, label = 'RunningHub 工作流标识') {
  const normalized = String(value || '').trim();
  if (!SAFE_REMOTE_ID.test(normalized)) {
    throw new RunningHubWorkflowClientError(`${label}无效`, 'INVALID_RUNNINGHUB_REFERENCE', 400);
  }
  return normalized;
}

export function normalizeRunningHubInstanceType(value) {
  const normalized = String(value || 'plus').trim().toLowerCase();
  if (!RUNNINGHUB_INSTANCE_TYPES.has(normalized)) {
    throw new RunningHubWorkflowClientError(
      'RunningHub 机器配置无效；当前仅支持 Standard 24GB 与 Plus 48GB',
      'INVALID_RUNNINGHUB_INSTANCE_TYPE',
      400,
    );
  }
  return normalized;
}

function assertJsonShape(value) {
  const stack = [{ value, depth: 0 }];
  let items = 0;
  while (stack.length) {
    const current = stack.pop();
    items += 1;
    if (items > MAX_JSON_ITEMS || current.depth > 64) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 响应结构超过安全限制',
        'RUNNINGHUB_RESPONSE_SHAPE_LIMIT',
        502,
      );
    }
    if (typeof current.value === 'string') {
      if (Buffer.byteLength(current.value, 'utf8') > MAX_JSON_STRING_BYTES) {
        throw new RunningHubWorkflowClientError(
          'RunningHub 响应字符串超过安全限制',
          'RUNNINGHUB_RESPONSE_SHAPE_LIMIT',
          502,
        );
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    const entries = Array.isArray(current.value)
      ? current.value.map((child) => [null, child])
      : Object.entries(current.value);
    for (const [key, child] of entries) {
      if (key != null && Buffer.byteLength(key, 'utf8') > MAX_JSON_STRING_BYTES) {
        throw new RunningHubWorkflowClientError(
          'RunningHub 响应字段超过安全限制',
          'RUNNINGHUB_RESPONSE_SHAPE_LIMIT',
          502,
        );
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

async function readBoundedBody(response, maximumBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel?.().catch(() => undefined);
    throw new RunningHubWorkflowClientError(
      'RunningHub 响应超过大小限制',
      'RUNNINGHUB_RESPONSE_SIZE_LIMIT',
      502,
    );
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RunningHubWorkflowClientError(
        'RunningHub 响应超过大小限制',
        'RUNNINGHUB_RESPONSE_SIZE_LIMIT',
        502,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function parseJson(buffer) {
  let value;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new RunningHubWorkflowClientError(
      'RunningHub 返回了无效 JSON',
      'RUNNINGHUB_INVALID_JSON',
      502,
    );
  }
  assertJsonShape(value);
  return value;
}

function responseError(result, response) {
  const providerMessage = sanitizeProviderMessage(
    result?.errorMessage || result?.failedReason || result?.msg || result?.message,
    `RunningHub 请求失败（HTTP ${response.status}）`,
  );
  const businessCode = Number(result?.code);
  const authentication = response.status === 401
    || response.status === 403
    || businessCode === 401
    || businessCode === 403
    || /(?:(?:api.?key|密钥).{0,24}(?:invalid|expired|missing|无效|过期|缺失)|unauthori[sz]ed|forbidden|鉴权失败|无权访问)/i
      .test(providerMessage);
  const error = new RunningHubWorkflowClientError(
    authentication ? 'RunningHub API Key 无效或无权访问该工作流' : providerMessage,
    authentication ? 'RUNNINGHUB_AUTH_FAILED' : 'RUNNINGHUB_REQUEST_FAILED',
    authentication ? 401 : 502,
    response.status === 429 || response.status >= 500,
  );
  error.confirmedRejected = response.ok
    || (response.status >= 400 && response.status < 500
      && ![408, 425, 429].includes(response.status));
  return error;
}

function runningHubBusinessCode(result) {
  if (result?.code === undefined) return { present: false, value: null };
  return { present: true, value: Number(result.code) };
}

function requireRunningHubSuccess(result) {
  const businessCode = runningHubBusinessCode(result);
  if (businessCode.present && businessCode.value !== 0) {
    throw responseError(result, { status: 200, ok: true });
  }
  return result;
}

function classifyTaskOutputs(result) {
  const data = result?.data;
  const businessCode = runningHubBusinessCode(result);
  const status = String(
    data?.taskStatus || data?.status || result?.taskStatus || result?.status || '',
  ).toUpperCase();
  const failed = businessCode.value === 805
    || ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status)
    || Boolean(data?.failedReason);

  if (failed) {
    return {
      state: 'failed',
      reason: providerFailureReason(
        data?.failedReason || data?.errorMessage || result?.msg,
      ),
    };
  }
  if (businessCode.value === 804) {
    return { state: 'pending', outputs: [], status: 'RUNNING' };
  }
  if (businessCode.present && businessCode.value !== 0) {
    throw responseError(result, { status: 200, ok: true });
  }
  if (Array.isArray(data)) return { state: 'success', outputs: data };
  return {
    state: ['SUCCESS', 'COMPLETED'].includes(status) ? 'success' : 'pending',
    outputs: Array.isArray(data?.outputs) ? data.outputs : [],
    status: status || (data?.netWssUrl ? 'RUNNING' : 'QUEUED'),
  };
}

function hasProviderError(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' && String(value) !== '0';
}

function requireRunningHubV2Success(result) {
  if (
    (result?.code !== undefined && Number(result.code) !== 0)
    || hasProviderError(result?.errorCode)
    || hasProviderError(result?.errorMessage)
  ) {
    throw responseError(result, { status: 200, ok: true });
  }
  return result;
}

function classifyV2TaskOutputs(result) {
  requireRunningHubV2Success(result);
  const status = String(result?.status || '').toUpperCase();
  if (
    ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status)
    || result?.failedReason
  ) {
    return {
      state: 'failed',
      reason: providerFailureReason(
        result?.failedReason || result?.errorMessage || result?.message,
      ),
    };
  }
  const outputs = Array.isArray(result?.results)
    ? result.results.map((item) => ({
        ...item,
        fileUrl: item?.fileUrl || item?.url,
        fileType: item?.fileType || item?.outputType,
      }))
    : [];
  if (status === 'SUCCESS') return { state: 'success', outputs };
  return { state: 'pending', outputs: [], status: status || 'RUNNING' };
}

function decodeNuxtData(serialized) {
  let flat;
  try {
    flat = JSON.parse(serialized);
  } catch {
    throw new RunningHubWorkflowClientError(
      'RunningHub AI 应用详情数据无效',
      'RUNNINGHUB_AI_APP_INFO_INVALID',
      502,
    );
  }
  if (!Array.isArray(flat) || flat.length > MAX_JSON_ITEMS) {
    throw new RunningHubWorkflowClientError(
      'RunningHub AI 应用详情结构超过安全限制',
      'RUNNINGHUB_RESPONSE_SHAPE_LIMIT',
      502,
    );
  }
  const cache = new Map();
  const active = new Set();
  let decodedItems = 0;
  const decode = (reference, depth = 0) => {
    if (reference === -1) return undefined;
    if (reference === -2) return null;
    if (reference === -3) return Number.NaN;
    if (reference === -4) return Number.POSITIVE_INFINITY;
    if (reference === -5) return Number.NEGATIVE_INFINITY;
    if (reference === -6) return -0;
    if (reference === -7) return false;
    if (reference === -8) return true;
    if (reference === -9) return 0;
    if (!Number.isInteger(reference) || reference < 0 || reference >= flat.length) return reference;
    if (cache.has(reference)) return cache.get(reference);
    if (active.has(reference) || depth > 64 || ++decodedItems > MAX_JSON_ITEMS) {
      throw new RunningHubWorkflowClientError(
        'RunningHub AI 应用详情结构超过安全限制',
        'RUNNINGHUB_RESPONSE_SHAPE_LIMIT',
        502,
      );
    }
    active.add(reference);
    const encoded = flat[reference];
    let decoded;
    if (Array.isArray(encoded)) {
      if (
        typeof encoded[0] === 'string'
        && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(encoded[0])
      ) {
        decoded = decode(encoded[1], depth + 1);
      } else {
        decoded = [];
        cache.set(reference, decoded);
        for (const item of encoded) decoded.push(decode(item, depth + 1));
      }
    } else if (encoded && typeof encoded === 'object') {
      decoded = Object.create(null);
      cache.set(reference, decoded);
      for (const [key, value] of Object.entries(encoded)) decoded[key] = decode(value, depth + 1);
    } else {
      decoded = encoded;
    }
    active.delete(reference);
    cache.set(reference, decoded);
    return decoded;
  };
  const result = decode(0);
  assertJsonShape(result);
  return result;
}

function findAiAppDetail(root, appId) {
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();
  let visited = 0;
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (++visited > 20_000 || depth > 12) break;
    if (String(value.id || '') === appId && Array.isArray(value.inputNodes)) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function projectAiAppDetail(detail) {
  return {
    appName: String(detail.name || '').slice(0, 240),
    name: String(detail.name || '').slice(0, 240),
    nodeInfoList: detail.inputNodes,
    category: detail.category,
    tags: detail.tags,
  };
}

function outputUrlAllowed(url) {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && OUTPUT_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isRunningHubAiSite(baseUrl) {
  return ['www.runninghub.ai', 'runninghub.ai']
    .includes(new URL(baseUrl).hostname.toLowerCase());
}

function usesRunningHubV2Api(baseUrl, apiProtocol) {
  return apiProtocol === RUNNINGHUB_WEBAPP_PROTOCOLS.aiAppV2
    && !isRunningHubAiSite(baseUrl);
}

export class RunningHubWorkflowClient {
  constructor({
    baseUrl,
    apiKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetcher = fetch,
  }) {
    this.baseUrl = normalizeRunningHubBaseUrl(baseUrl);
    this.apiKey = String(apiKey || '').trim();
    if (!this.apiKey) {
      throw new RunningHubWorkflowClientError(
        'RunningHub API Key 尚未配置',
        'RUNNINGHUB_CREDENTIAL_NOT_CONFIGURED',
        409,
      );
    }
    this.timeoutMs = Math.min(60_000, Math.max(5_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    this.fetcher = fetcher;
  }

  async fetchWithTimeout(url, init = {}, { signal, timeoutMs = this.timeoutMs } = {}) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const failure = (error) => {
      if (signal?.aborted) return signal.reason || error;
      return new RunningHubWorkflowClientError(
        controller.signal.aborted ? 'RunningHub 请求超时' : '无法连接 RunningHub',
        controller.signal.aborted ? 'RUNNINGHUB_REQUEST_TIMEOUT' : 'RUNNINGHUB_UNAVAILABLE',
        controller.signal.aborted ? 504 : 502,
        true,
      );
    };
    try {
      const response = await this.fetcher(url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.body) { cleanup(); return response; }
      const reader = response.body.getReader();
      let finished = false;
      let abortBody;
      const finish = () => {
        finished = true;
        controller.signal.removeEventListener('abort', abortBody);
        cleanup();
      };
      // A fetch resolves at headers. Keep cancellation and the deadline alive
      // until the body is consumed or cancelled, including streamed outputs.
      const body = new ReadableStream({
        start(stream) {
          abortBody = () => {
            if (finished) return;
            const error = failure(controller.signal.reason);
            finish();
            stream.error(error);
            void reader.cancel(error).catch(() => undefined);
          };
          controller.signal.addEventListener('abort', abortBody, { once: true });
          if (controller.signal.aborted) abortBody();
        },
        async pull(stream) {
          try {
            const { done, value } = await reader.read();
            if (finished) return;
            if (done) { finish(); stream.close(); }
            else stream.enqueue(value);
          } catch (error) {
            if (finished) return;
            finish();
            stream.error(failure(error));
          }
        },
        async cancel(reason) { finish(); await reader.cancel(reason); },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      cleanup();
      throw failure(error);
    }
  }

  async requestJson(endpoint, body, {
    signal,
    maximumBytes = 4 * 1024 * 1024,
    apiKeyField = 'apiKey',
    baseUrl = this.baseUrl,
  } = {}) {
    const requestBaseUrl = normalizeRunningHubBaseUrl(baseUrl);
    const response = await this.fetchWithTimeout(`${requestBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Host: new URL(requestBaseUrl).host,
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(apiKeyField ? { [apiKeyField]: this.apiKey, ...body } : body),
    }, { signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new RunningHubWorkflowClientError(
        'RunningHub 重定向已被拒绝',
        'RUNNINGHUB_REDIRECT_REJECTED',
        502,
      );
    }
    const result = parseJson(await readBoundedBody(response, maximumBytes));
    if (!response.ok) {
      throw responseError(result, response);
    }
    return result;
  }

  async validateCredential({ signal } = {}) {
    const result = requireRunningHubSuccess(await this.requestJson('/uc/openapi/accountStatus', {}, {
      signal,
      apiKeyField: 'apikey',
    }));
    return {
      valid: true,
      currency: String(result?.data?.currency || '').slice(0, 16),
      apiType: String(result?.data?.apiType || '').slice(0, 40),
    };
  }

  async getWorkflowApiFormat(workflowId, { signal } = {}) {
    const result = requireRunningHubSuccess(await this.requestJson('/api/openapi/getJsonApiFormat', {
      workflowId: assertRunningHubRemoteId(workflowId),
    }, { signal, maximumBytes: 32 * 1024 * 1024 }));
    const rawPrompt = result?.data?.prompt;
    let prompt = rawPrompt;
    if (typeof rawPrompt === 'string') {
      try {
        prompt = JSON.parse(rawPrompt);
      } catch {
        throw new RunningHubWorkflowClientError(
          'RunningHub 工作流 API Format 无效',
          'RUNNINGHUB_WORKFLOW_FORMAT_INVALID',
          409,
        );
      }
    }
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 没有返回工作流 API Format',
        'RUNNINGHUB_WORKFLOW_FORMAT_MISSING',
        409,
      );
    }
    assertJsonShape(prompt);
    return prompt;
  }

  async getWebAppCover(webAppId) {
    return readRunningHubPageCover(this.baseUrl, assertRunningHubRemoteId(webAppId), async (url) => ({ response: await this.fetchWithTimeout(url, { method: 'GET' }, { timeoutMs: 10000 }) }));
  }

  async getWebAppInfo(webAppId, { signal } = {}) {
    return this.getWebAppInfoForProtocol(webAppId, RUNNINGHUB_WEBAPP_PROTOCOLS.legacy, { signal });
  }

  async getWebAppInfoForProtocol(webAppId, protocol, { signal } = {}) {
    if (
      protocol === RUNNINGHUB_WEBAPP_PROTOCOLS.aiAppV2
      || isRunningHubAiSite(this.baseUrl)
    ) {
      return this.getGlobalAiAppInfo(webAppId, { signal });
    }
    const url = new URL(`${this.baseUrl}/api/webapp/apiCallDemo`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('webappId', assertRunningHubRemoteId(webAppId, 'RunningHub WebApp ID'));
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Host: new URL(this.baseUrl).host,
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    }, { signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new RunningHubWorkflowClientError(
        'RunningHub 重定向已被拒绝',
        'RUNNINGHUB_REDIRECT_REJECTED',
        502,
      );
    }
    const result = parseJson(await readBoundedBody(response, 4 * 1024 * 1024));
    if (!response.ok || (result?.code !== undefined && Number(result.code) !== 0)) {
      throw responseError(result, response);
    }
    if (!result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 没有返回 WebApp 字段',
        'RUNNINGHUB_WEBAPP_INFO_MISSING',
        409,
      );
    }
    return result.data;
  }

  async getGlobalAiAppInfo(webAppId, { signal } = {}) {
    if (!isRunningHubAiSite(this.baseUrl)) {
      throw new RunningHubWorkflowClientError(
        'RunningHub AI 站 V2 应用仅支持 runninghub.ai',
        'RUNNINGHUB_AI_APP_V2_SITE_MISMATCH',
        400,
      );
    }
    const appId = assertRunningHubRemoteId(webAppId, 'RunningHub AI 应用 ID');
    try {
      const detailResponse = await this.fetchWithTimeout(`${this.baseUrl}/api/webapp/detail`, {
        method: 'POST',
        headers: {
          Host: new URL(this.baseUrl).host,
          Accept: 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ webappId: appId }),
      }, { signal });
      if (detailResponse.status >= 300 && detailResponse.status < 400) {
        throw new RunningHubWorkflowClientError(
          'RunningHub AI 应用详情重定向已被拒绝',
          'RUNNINGHUB_REDIRECT_REJECTED',
          502,
        );
      }
      const result = parseJson(await readBoundedBody(detailResponse, MAX_AI_DETAIL_JSON_BYTES));
      if (!detailResponse.ok || Number(result?.code) !== 0) {
        throw responseError(result, detailResponse);
      }
      const detail = result?.data;
      if (!detail || String(detail.id || '') !== appId || !Array.isArray(detail.inputNodes)) {
        throw new RunningHubWorkflowClientError(
          'RunningHub AI 应用详情缺少公开参数数据',
          'RUNNINGHUB_AI_APP_INFO_MISSING',
          409,
        );
      }
      return projectAiAppDetail(detail);
    } catch (error) {
      if (signal?.aborted || ['RUNNINGHUB_RESPONSE_SIZE_LIMIT', 'RUNNINGHUB_RESPONSE_SHAPE_LIMIT'].includes(error?.code)) throw error;
      // Keep the public page decoder as a compatibility fallback when the site API changes.
    }
    return this.getGlobalAiAppPageInfo(appId, { signal });
  }

  async getGlobalAiAppPageInfo(webAppId, { signal } = {}) {
    if (!isRunningHubAiSite(this.baseUrl)) {
      throw new RunningHubWorkflowClientError('仅支持 RunningHub AI 站公开详情', 'RUNNINGHUB_AI_APP_V2_SITE_MISMATCH', 400);
    }
    const appId = assertRunningHubRemoteId(webAppId, 'RunningHub AI 应用 ID');
    const response = await this.fetchWithTimeout(`${this.baseUrl}/ai-detail/${appId}`, {
      method: 'GET',
      headers: {
        Host: new URL(this.baseUrl).host,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
      },
    }, { signal });
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new RunningHubWorkflowClientError(
        `RunningHub AI 应用详情读取失败（HTTP ${response.status}）`,
        'RUNNINGHUB_AI_APP_INFO_UNAVAILABLE',
        response.status === 404 ? 404 : 502,
        response.status >= 500,
      );
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      await response.body?.cancel().catch(() => undefined);
      throw new RunningHubWorkflowClientError(
        'RunningHub AI 应用详情返回类型异常',
        'RUNNINGHUB_AI_APP_INFO_INVALID',
        502,
      );
    }
    const html = (await readBoundedBody(response, MAX_AI_DETAIL_HTML_BYTES)).toString('utf8');
    const match = html.match(/<script\b[^>]*\bid=(?:"__NUXT_DATA__"|'__NUXT_DATA__')[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
      throw new RunningHubWorkflowClientError(
        'RunningHub AI 应用详情缺少公开参数数据',
        'RUNNINGHUB_AI_APP_INFO_MISSING',
        409,
      );
    }
    const detail = findAiAppDetail(decodeNuxtData(match[1]), appId);
    if (!detail) {
      throw new RunningHubWorkflowClientError(
        'RunningHub AI 应用未公开可调用参数',
        'RUNNINGHUB_AI_APP_INFO_MISSING',
        409,
      );
    }
    return projectAiAppDetail(detail);
  }

  async resolveWebAppInfo(webAppId, { signal } = {}) {
    return {
      apiProtocol: RUNNINGHUB_WEBAPP_PROTOCOLS.legacy,
      info: await this.getWebAppInfoForProtocol(
        webAppId,
        RUNNINGHUB_WEBAPP_PROTOCOLS.legacy,
        { signal },
      ),
    };
  }

  async uploadAsset(asset, { signal, apiProtocol } = {}) {
    const info = await stat(asset.filePath);
    if (!info.isFile() || info.size !== Number(asset.bytes) || info.size > MAX_UPLOAD_BYTES) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 单个上传素材必须不超过 30 MiB',
        'RUNNINGHUB_UPLOAD_SIZE_LIMIT',
        413,
      );
    }
    const buffer = await readFile(asset.filePath);
    return this.uploadBuffer(buffer, path.basename(asset.filename), { signal, apiProtocol });
  }

  async uploadBuffer(buffer, filename = 'image.png', { signal, apiProtocol } = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
      throw new RunningHubWorkflowClientError('RunningHub 单个上传素材必须不超过 30 MiB', 'RUNNINGHUB_UPLOAD_SIZE_LIMIT', 413);
    }
    // AI-site pages expose their schema through the new public page, but custom
    // AI applications still execute through that site's WebApp V1 contract.
    // Treat previously persisted ai-app-v2 deployments as V1 on runninghub.ai.
    const v2 = usesRunningHubV2Api(this.baseUrl, apiProtocol);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const form = new FormData();
        if (!v2) {
          form.append('apiKey', this.apiKey);
          form.append('fileType', 'input');
        }
        form.append('file', new Blob([buffer]), path.basename(filename));
        const uploadBaseUrl = v2 ? RUNNINGHUB_V2_API_BASE_URL : this.baseUrl;
        const uploadEndpoint = v2 ? '/openapi/v2/media/upload/binary' : '/task/openapi/upload';
        const response = await this.fetchWithTimeout(`${uploadBaseUrl}${uploadEndpoint}`, {
          method: 'POST',
          headers: {
            Host: new URL(uploadBaseUrl).host,
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: form,
        }, { signal, timeoutMs: 60_000 });
        const result = parseJson(await readBoundedBody(response, 2 * 1024 * 1024));
        if (!response.ok || Number(result?.code) !== 0) throw responseError(result, response);
        const rawFileName = v2 ? result?.data?.download_url : result?.data?.fileName;
        const fileName = typeof rawFileName === 'string' ? rawFileName.trim() : '';
        if (!fileName || fileName.length > 1_000 || /[\0\r\n]/.test(fileName)) {
          throw new RunningHubWorkflowClientError(
            `RunningHub 上传响应缺少有效 ${v2 ? 'download_url' : 'fileName'}`,
            'RUNNINGHUB_UPLOAD_PROTOCOL_ERROR',
            502,
          );
        }
        if (v2) {
          let downloadUrl;
          try {
            downloadUrl = new URL(fileName);
          } catch {
            throw new RunningHubWorkflowClientError(
              'RunningHub V2 上传响应地址无效',
              'RUNNINGHUB_UPLOAD_PROTOCOL_ERROR',
              502,
            );
          }
          if (!outputUrlAllowed(downloadUrl)) {
            throw new RunningHubWorkflowClientError(
              'RunningHub V2 上传响应地址不在允许范围内',
              'RUNNINGHUB_UPLOAD_PROTOCOL_ERROR',
              502,
            );
          }
        }
        return { fileName, fileType: String(result?.data?.fileType || 'input') };
      } catch (error) {
        const retryableTransport = error instanceof RunningHubWorkflowClientError
          && ['RUNNINGHUB_REQUEST_TIMEOUT', 'RUNNINGHUB_UNAVAILABLE'].includes(error.code);
        if (attempt === 1 || !retryableTransport) throw error;
      }
    }
    throw new RunningHubWorkflowClientError('RunningHub 上传失败');
  }

  async createTask({ workflowId, nodeInfoList, workflow, instanceType, signal }) {
    if (!Array.isArray(nodeInfoList) || nodeInfoList.length > 256) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 参数覆盖数量超过限制',
        'RUNNINGHUB_NODE_INFO_LIMIT',
        413,
      );
    }
    const body = {
      workflowId: assertRunningHubRemoteId(workflowId),
      nodeInfoList,
      instanceType: normalizeRunningHubInstanceType(instanceType),
      ...(workflow ? { workflow } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 32 * 1024 * 1024) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 工作流提交体超过限制',
        'RUNNINGHUB_SUBMIT_SIZE_LIMIT',
        413,
      );
    }
    const result = requireRunningHubSuccess(
      await this.requestJson('/task/openapi/create', body, { signal }),
    );
    let taskId;
    try {
      taskId = assertRunningHubRemoteId(result?.data?.taskId, 'RunningHub 任务标识');
    } catch {
      throw new RunningHubWorkflowClientError(
        'RunningHub 已响应提交，但未返回可用的任务标识',
        'RUNNINGHUB_SUBMISSION_PROTOCOL_UNKNOWN',
        502,
      );
    }
    return {
      taskId,
      status: String(result?.data?.taskStatus || 'QUEUED').toUpperCase(),
    };
  }

  async createWebAppTask({ webAppId, nodeInfoList, instanceType, apiProtocol, signal }) {
    if (!Array.isArray(nodeInfoList) || nodeInfoList.length > 256) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 参数覆盖数量超过限制',
        'RUNNINGHUB_NODE_INFO_LIMIT',
        413,
      );
    }
    const normalizedWebAppId = assertRunningHubRemoteId(webAppId, 'RunningHub WebApp ID');
    const body = {
      nodeInfoList,
      instanceType: normalizeRunningHubInstanceType(instanceType),
    };
    const v2 = usesRunningHubV2Api(this.baseUrl, apiProtocol);
    const result = v2
      ? requireRunningHubV2Success(await this.requestJson(
          `/openapi/v2/run/ai-app/${normalizedWebAppId}`,
          body,
          { signal, apiKeyField: null, baseUrl: RUNNINGHUB_V2_API_BASE_URL },
        ))
      : requireRunningHubSuccess(await this.requestJson('/task/openapi/ai-app/run', {
          webappId: normalizedWebAppId,
          ...body,
        }, { signal }));
    let taskId;
    try {
      taskId = assertRunningHubRemoteId(
        v2 ? result?.taskId : result?.data?.taskId,
        'RunningHub 任务标识',
      );
    } catch {
      throw new RunningHubWorkflowClientError(
        'RunningHub 已响应提交，但未返回可用的任务标识',
        'RUNNINGHUB_SUBMISSION_PROTOCOL_UNKNOWN',
        502,
      );
    }
    return {
      taskId,
      status: String(v2 ? (result?.status || 'QUEUED') : (result?.data?.taskStatus || 'QUEUED'))
        .toUpperCase(),
    };
  }

  async getWebAppTaskOutputs(taskId, { signal, apiProtocol } = {}) {
    if (usesRunningHubV2Api(this.baseUrl, apiProtocol)) {
      const result = await this.requestJson('/openapi/v2/query', {
        taskId: assertRunningHubRemoteId(taskId, 'RunningHub 任务标识'),
      }, {
        signal,
        maximumBytes: 8 * 1024 * 1024,
        apiKeyField: null,
        baseUrl: RUNNINGHUB_V2_API_BASE_URL,
      });
      return classifyV2TaskOutputs(result);
    }
    return this.getTaskOutputs(taskId, { signal });
  }

  async getTaskOutputs(taskId, { signal } = {}) {
    const result = await this.requestJson('/task/openapi/outputs', {
      taskId: assertRunningHubRemoteId(taskId, 'RunningHub 任务标识'),
    }, {
      signal,
      maximumBytes: 8 * 1024 * 1024,
    });
    return classifyTaskOutputs(result);
  }

  async openOutput(handle, { signal } = {}) {
    let url;
    try {
      url = new URL(String(handle?.url || ''));
    } catch {
      throw new RunningHubWorkflowClientError(
        'RunningHub 输出地址无效',
        'RUNNINGHUB_OUTPUT_URL_INVALID',
        502,
      );
    }
    if (!outputUrlAllowed(url)) {
      throw new RunningHubWorkflowClientError(
        'RunningHub 输出地址不在允许的官方域名范围内',
        'RUNNINGHUB_OUTPUT_HOST_REJECTED',
        502,
      );
    }
    const response = await this.fetchWithTimeout(url, { method: 'GET' }, { signal, timeoutMs: 10 * 60_000 });
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new RunningHubWorkflowClientError(
        'RunningHub 输出下载失败',
        'RUNNINGHUB_OUTPUT_DOWNLOAD_FAILED',
        502,
        true,
      );
    }
    return response;
  }
}

export const RUNNINGHUB_WORKFLOW_LIMITS = Object.freeze({
  maximumUploadBytes: MAX_UPLOAD_BYTES,
});
