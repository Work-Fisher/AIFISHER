import fs from 'node:fs';
import path from 'node:path';
import nodeFetch from 'node-fetch';
import FormData from 'form-data';
import WebSocket from 'ws';
import { normalizeLocalComfyServer } from '../comfyui/comfyServerAddress.js';

export const COMFY_RESPONSE_LIMITS = Object.freeze({
  systemStats: 1024 * 1024,
  objectInfo: 64 * 1024 * 1024,
  prompt: 2 * 1024 * 1024,
  history: 128 * 1024 * 1024,
  queue: 64 * 1024 * 1024,
  jobs: 1024 * 1024,
  upload: 1024 * 1024,
  error: 256 * 1024,
});

export const COMFY_REQUEST_TIMEOUTS = Object.freeze({
  systemStats: 10_000,
  objectInfo: 30_000,
  prompt: 30_000,
  history: 30_000,
  queue: 20_000,
  jobs: 10_000,
  cancel: 10_000,
});

const COMFY_WS_MAX_PAYLOAD = 4 * 1024 * 1024;
const COMFY_WS_MAX_TEXT = 1024 * 1024;

export class LocalComfyClientError extends Error {
  constructor(message, code = 'COMFYUI_PROTOCOL_ERROR', status = 502, details = undefined) {
    super(message);
    this.name = 'LocalComfyClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assertJsonShape(value, {
  maxDepth = 80,
  maxKeys = 100_000,
  maxArrayItems = 100_000,
  maxStringBytes = 1024 * 1024,
} = {}) {
  const state = { keys: 0, arrayItems: 0 };
  const scan = (current, depth) => {
    if (depth > maxDepth) {
      throw new LocalComfyClientError('ComfyUI 返回的 JSON 嵌套过深', 'COMFYUI_RESPONSE_DEPTH_LIMIT');
    }
    if (typeof current === 'string') {
      if (Buffer.byteLength(current, 'utf8') > maxStringBytes) {
        throw new LocalComfyClientError(
          'ComfyUI 返回的 JSON 单个字符串过长',
          'COMFYUI_RESPONSE_STRING_LIMIT',
        );
      }
      return;
    }
    if (Array.isArray(current)) {
      state.arrayItems += current.length;
      if (state.arrayItems > maxArrayItems) {
        throw new LocalComfyClientError(
          'ComfyUI 返回的 JSON 数组项过多',
          'COMFYUI_RESPONSE_ARRAY_LIMIT',
        );
      }
      for (const item of current) scan(item, depth + 1);
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      state.keys += 1;
      if (state.keys > maxKeys) {
        throw new LocalComfyClientError('ComfyUI 返回的 JSON 字段过多', 'COMFYUI_RESPONSE_KEY_LIMIT');
      }
      scan(key, depth + 1);
      scan(child, depth + 1);
    }
  };
  scan(value, 0);
}

export async function readResponseBytesWithLimit(response, maximumBytes, signal) {
  try {
    return await readResponseBytes(response, maximumBytes);
  } catch (cause) {
    if (cause instanceof LocalComfyClientError) throw cause;
    const timedOut = signal?.aborted || ['TimeoutError', 'AbortError'].includes(cause?.name);
    throw new LocalComfyClientError(
      timedOut ? 'ComfyUI 请求超时或已取消' : 'ComfyUI 响应传输中断',
      timedOut ? 'COMFYUI_REQUEST_TIMEOUT' : 'COMFYUI_UNAVAILABLE', 503,
    );
  }
}

async function readResponseBytes(response, maximumBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new LocalComfyClientError('ComfyUI 响应超过大小限制', 'COMFYUI_RESPONSE_SIZE_LIMIT');
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  if (typeof response.body.getReader !== 'function') {
    for await (const value of response.body) {
      total += value.byteLength;
      if (total > maximumBytes) {
        response.body.destroy?.();
        throw new LocalComfyClientError(
          'ComfyUI 响应超过大小限制',
          'COMFYUI_RESPONSE_SIZE_LIMIT',
        );
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new LocalComfyClientError(
          'ComfyUI 响应超过大小限制',
          'COMFYUI_RESPONSE_SIZE_LIMIT',
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function discardBody(response) {
  if (!response?.body) return;
  if (typeof response.body.cancel === 'function') {
    await response.body.cancel().catch(() => undefined);
    return;
  }
  response.body.destroy?.();
}

function parseJson(bytes, shapeLimits) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new LocalComfyClientError('ComfyUI 返回了无效 JSON', 'COMFYUI_INVALID_JSON');
  }
  assertJsonShape(parsed, shapeLimits);
  return parsed;
}

function boundedSignal(timeoutMs, signal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
}

function redactUntrustedText(value, fallback, maximum = 500) {
  return String(value || fallback)
    .replace(/[\r\n]+/g, ' ')
    .replace(
      /(^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/))[^\s"'<>;,]*/gi,
      '$1[本机路径]',
    )
    .replace(/\b(?:api[_ -]?key|authorization|bearer|token|secret|password)\b\s*[:=]?\s*[^\s,;]+/gi, '[敏感信息]')
    .replace(/\b(?:sk|rk|pk)[-_][A-Za-z0-9._-]{12,}\b/g, '[敏感信息]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .slice(0, maximum);
}

function safeNodeErrors(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).slice(0, 100).map(([nodeId, entry]) => ({
    nodeId: redactUntrustedText(nodeId, 'unknown-node', 120),
    errorType: redactUntrustedText(entry?.class_type || entry?.type, 'validation', 120),
    message: redactUntrustedText(
      entry?.errors?.[0]?.message
      || entry?.errors?.[0]?.details
      || '节点参数校验失败',
      500,
    ),
  }));
}

export class LocalComfyClient {
  constructor({
    serverUrl,
    fetchImpl = fetch,
    uploadFetchImpl = nodeFetch,
    timeoutMs = 20_000,
  }) {
    this.serverAddress = normalizeLocalComfyServer(serverUrl);
    this.baseUrl = `http://${this.serverAddress}`;
    this.fetchImpl = fetchImpl;
    this.uploadFetchImpl = uploadFetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async requestJson(pathname, {
    method = 'GET',
    body,
    headers,
    limit = COMFY_RESPONSE_LIMITS.error,
    timeoutMs = this.timeoutMs,
    allowNotFound = false,
    shapeLimits,
    signal,
  } = {}) {
    let response;
    const requestSignal = boundedSignal(timeoutMs, signal);
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        body,
        headers,
        redirect: 'manual',
        signal: requestSignal,
      });
    } catch (cause) {
      const code = cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
        ? 'COMFYUI_REQUEST_TIMEOUT'
        : 'COMFYUI_UNAVAILABLE';
      throw new LocalComfyClientError(
        code === 'COMFYUI_REQUEST_TIMEOUT' ? 'ComfyUI 请求超时' : '无法连接本机 ComfyUI',
        code,
        503,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await discardBody(response);
      throw new LocalComfyClientError('ComfyUI 不允许重定向', 'COMFYUI_REDIRECT_REJECTED');
    }
    if (allowNotFound && response.status === 404) {
      await discardBody(response);
      return null;
    }
    const responseLimit = response.ok ? limit : Math.min(limit, COMFY_RESPONSE_LIMITS.error);
    const bytes = await readResponseBytesWithLimit(response, responseLimit, requestSignal);
    if (!response.ok) {
      let nodeErrors = [];
      try {
        nodeErrors = safeNodeErrors(parseJson(bytes)?.node_errors);
      } catch {
        // Error bodies are untrusted and optional. The public error remains stable.
      }
      throw new LocalComfyClientError(
        response.status === 400 ? 'ComfyUI 拒绝了工作流参数' : 'ComfyUI 请求失败',
        response.status === 400 ? 'COMFYUI_PROMPT_REJECTED' : 'COMFYUI_PROTOCOL_ERROR',
        response.status === 400 ? 400 : 502,
        nodeErrors.length ? { nodeErrors } : undefined,
      );
    }
    return parseJson(bytes, shapeLimits);
  }

  openEventStream({ clientId, onEvent, onDisconnect = () => undefined, signal }) {
    const normalizedClientId = String(clientId || '');
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(normalizedClientId)) {
      throw new LocalComfyClientError('ComfyUI clientId 无效', 'INVALID_COMFYUI_CLIENT_ID', 400);
    }
    const url = `ws://${this.serverAddress}/ws?clientId=${encodeURIComponent(normalizedClientId)}`;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        followRedirects: false,
        handshakeTimeout: 10_000,
        maxPayload: COMFY_WS_MAX_PAYLOAD,
        perMessageDeflate: false,
      });
      let opened = false;
      let disconnected = false;
      let alive = true;
      const disconnect = (reason) => {
        if (disconnected) return;
        disconnected = true;
        onDisconnect(reason);
      };
      const heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, 30_000);
      heartbeat.unref?.();
      const abort = () => socket.close(1000, 'cancelled');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      socket.on('pong', () => { alive = true; });
      socket.once('open', () => {
        opened = true;
        resolve({
          close() {
            if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
              socket.close(1000, 'finished');
            }
          },
        });
      });
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (bytes.byteLength > COMFY_WS_MAX_TEXT) {
          disconnect('COMFYUI_WS_TEXT_LIMIT');
          socket.close(1009, 'text payload too large');
          return;
        }
        try {
          const event = parseJson(bytes, { maxDepth: 32, maxKeys: 20_000 });
          onEvent(event);
        } catch {
          disconnect('COMFYUI_WS_INVALID_JSON');
          socket.close(1007, 'invalid json');
        }
      });
      socket.once('error', () => {
        if (!opened) {
          reject(new LocalComfyClientError(
            'ComfyUI 实时通道不可用',
            'COMFYUI_WS_UNAVAILABLE',
            503,
          ));
        }
        disconnect('COMFYUI_WS_ERROR');
      });
      socket.once('close', () => {
        clearInterval(heartbeat);
        signal?.removeEventListener('abort', abort);
        if (!opened) {
          reject(new LocalComfyClientError(
            'ComfyUI 实时通道在连接前关闭',
            'COMFYUI_WS_UNAVAILABLE',
            503,
          ));
        }
        disconnect('COMFYUI_WS_CLOSED');
      });
    });
  }

  getSystemStats({ signal } = {}) {
    return this.requestJson('/system_stats', {
      limit: COMFY_RESPONSE_LIMITS.systemStats,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.systemStats,
      shapeLimits: { maxDepth: 32, maxKeys: 10_000, maxArrayItems: 10_000 },
      signal,
    });
  }

  getObjectInfo({ signal } = {}) {
    return this.requestJson('/object_info', {
      limit: COMFY_RESPONSE_LIMITS.objectInfo,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.objectInfo,
      shapeLimits: { maxDepth: 64, maxKeys: 500_000, maxArrayItems: 500_000 },
      signal,
    });
  }

  getHistory(promptId, { signal } = {}) {
    return this.requestJson(`/history/${encodeURIComponent(promptId)}`, {
      limit: COMFY_RESPONSE_LIMITS.history,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.history,
      shapeLimits: { maxDepth: 64, maxKeys: 500_000, maxArrayItems: 100_000 },
      signal,
    });
  }

  getQueue({ signal } = {}) {
    return this.requestJson('/queue', {
      limit: COMFY_RESPONSE_LIMITS.queue,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.queue,
      shapeLimits: { maxDepth: 64, maxKeys: 300_000, maxArrayItems: 100_000 },
      signal,
    });
  }

  async supportsAtomicJobCancel({ signal } = {}) {
    const response = await this.requestJson('/api/jobs?limit=1', {
      limit: COMFY_RESPONSE_LIMITS.jobs,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.jobs,
      allowNotFound: true,
      shapeLimits: { maxDepth: 16, maxKeys: 20_000, maxArrayItems: 20_000 },
      signal,
    });
    return response !== null;
  }

  submitPrompt({ prompt, clientId, promptId, signal }) {
    const body = JSON.stringify({
      prompt,
      client_id: clientId,
      ...(promptId ? { prompt_id: promptId } : {}),
    });
    if (Buffer.byteLength(body, 'utf8') > 32 * 1024 * 1024) {
      throw new LocalComfyClientError('编译后的工作流超过提交限制', 'COMFYUI_PROMPT_SIZE_LIMIT', 413);
    }
    return this.requestJson('/prompt', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      limit: COMFY_RESPONSE_LIMITS.prompt,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.prompt,
      shapeLimits: { maxDepth: 32, maxKeys: 20_000, maxArrayItems: 20_000 },
      signal,
    });
  }

  cancelJob(promptId) {
    return this.requestJson(`/api/jobs/${encodeURIComponent(promptId)}/cancel`, {
      method: 'POST',
      limit: COMFY_RESPONSE_LIMITS.jobs,
      timeoutMs: COMFY_REQUEST_TIMEOUTS.cancel,
      allowNotFound: true,
      shapeLimits: { maxDepth: 16, maxKeys: 20_000, maxArrayItems: 20_000 },
    });
  }

  async uploadInput({ filePath, filename, subfolder, overwrite = false, signal }) {
    const safeFilename = String(filename || path.basename(filePath || ''));
    const safeSubfolder = String(subfolder || '').replaceAll('\\', '/');
    if (
      !safeFilename
      || safeFilename !== path.basename(safeFilename)
      || /[\0\r\n]/.test(safeFilename)
      || safeSubfolder.split('/').some((part) => !part || part === '.' || part === '..')
      || safeSubfolder.startsWith('/')
    ) {
      throw new LocalComfyClientError('ComfyUI 暂存文件名无效', 'INVALID_COMFYUI_UPLOAD_HANDLE', 400);
    }
    const fileInfo = fs.statSync(filePath);
    if (!fileInfo.isFile()) {
      throw new LocalComfyClientError('待暂存素材不存在', 'ASSET_NOT_FOUND', 404);
    }
    const form = new FormData();
    form.append('image', fs.createReadStream(filePath), {
      filename: safeFilename,
      knownLength: fileInfo.size,
    });
    form.append('type', 'input');
    form.append('subfolder', safeSubfolder);
    form.append('overwrite', overwrite ? 'true' : 'false');
    let response;
    const requestSignal = boundedSignal(Math.max(this.timeoutMs, 10 * 60_000), signal);
    try {
      response = await this.uploadFetchImpl(`${this.baseUrl}/upload/image`, {
        method: 'POST',
        headers: form.getHeaders(),
        body: form,
        redirect: 'manual',
        signal: requestSignal,
      });
    } catch (cause) {
      throw new LocalComfyClientError(
        cause?.name === 'AbortError' ? 'ComfyUI 素材暂存超时' : 'ComfyUI 素材暂存失败',
        cause?.name === 'AbortError' ? 'COMFYUI_REQUEST_TIMEOUT' : 'COMFYUI_UNAVAILABLE',
        503,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await discardBody(response);
      throw new LocalComfyClientError('ComfyUI 不允许重定向', 'COMFYUI_REDIRECT_REJECTED');
    }
    const bytes = await readResponseBytesWithLimit(response, COMFY_RESPONSE_LIMITS.upload, requestSignal);
    if (!response.ok) {
      throw new LocalComfyClientError('ComfyUI 素材暂存失败', 'COMFYUI_UPLOAD_FAILED', 502);
    }
    const result = parseJson(bytes, { maxDepth: 10, maxKeys: 100 });
    const name = String(result?.name || '');
    const returnedSubfolder = String(result?.subfolder || '').replaceAll('\\', '/');
    const type = String(result?.type || '');
    if (
      !name
      || name !== path.basename(name)
      || returnedSubfolder !== safeSubfolder
      || type !== 'input'
    ) {
      throw new LocalComfyClientError(
        'ComfyUI 返回了不安全的暂存文件句柄',
        'INVALID_COMFYUI_UPLOAD_HANDLE',
      );
    }
    return { name, subfolder: returnedSubfolder, type };
  }

  async openOutput(handle, { signal } = {}) {
    const filename = String(handle?.filename || '');
    const subfolder = String(handle?.subfolder || '').replaceAll('\\', '/');
    const type = String(handle?.type || '');
    if (
      !filename
      || filename !== path.basename(filename)
      || /[\0\r\n]/.test(filename)
      || (subfolder && subfolder.split('/').some((part) => !part || part === '.' || part === '..'))
      || subfolder.startsWith('/')
      || !['output', 'temp'].includes(type)
    ) {
      throw new LocalComfyClientError('ComfyUI 输出句柄无效', 'INVALID_COMFYUI_OUTPUT_HANDLE');
    }
    const query = new URLSearchParams({ filename, subfolder, type });
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/view?${query}`, {
        redirect: 'manual',
        signal: boundedSignal(Math.max(this.timeoutMs, 10 * 60_000), signal),
      });
    } catch (cause) {
      throw new LocalComfyClientError(
        cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
          ? 'ComfyUI 输出下载超时'
          : 'ComfyUI 输出下载失败',
        cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
          ? 'COMFYUI_REQUEST_TIMEOUT'
          : 'COMFYUI_UNAVAILABLE',
        503,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await discardBody(response);
      throw new LocalComfyClientError('ComfyUI 不允许重定向', 'COMFYUI_REDIRECT_REJECTED');
    }
    if (!response.ok) {
      await discardBody(response);
      throw new LocalComfyClientError('ComfyUI 输出不存在', 'OUTPUT_NOT_FOUND', 404);
    }
    return response;
  }
}

export function projectRuntimeProtocol(systemStats, supportsAtomicJobCancel) {
  return {
    comfyuiVersion: String(
      systemStats?.system?.comfyui_version
      || systemStats?.system?.version
      || systemStats?.comfyui_version
      || 'unknown',
    ).slice(0, 120),
    supportsAtomicJobCancel: Boolean(supportsAtomicJobCancel),
  };
}
