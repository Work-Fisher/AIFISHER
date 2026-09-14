import { annotateProviderError } from '../telemetry/providerDiagnostics.js';
import { BaseProvider } from './baseProvider.js';
import { chatPayloads } from './chatStream.js';

export function assertRequiredConfig(config, keys, message) {
    const missing = (keys || []).filter(k => !config?.[k]);
    if (missing.length > 0) {
        throw new Error(message || `缺少必要配置: ${missing.join(', ')}`);
    }
}

export function buildJsonFetchOptions({ headers, body, signal, method = 'POST' }) {
    return {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(headers || {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(signal ? { signal } : {})
    };
}

export async function submitJsonWithLogs({
    url,
    fetchOptions,
    nodeId,
    logsDir,
    modelId,
    projectId,
    useProxy,
    logBody,
    maxAttempts,
    singleAttempt = false
}) {
    return BaseProvider.fetchWithLogs({
        url,
        fetchOptions,
        nodeId,
        logsDir,
        modelId,
        projectId,
        useProxy,
        logBody,
        ...(maxAttempts === undefined ? {} : { maxAttempts }),
        singleAttempt
    });
}

function openAiChatContentText(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map((item) => {
        if (typeof item === 'string') return item;
        return typeof item?.text === 'string' ? item.text : '';
    }).join('');
}

function openAiChatMessage(payload) {
    const choice = payload?.choices?.[0];
    const message = choice?.delta || choice?.message || {};
    return {
        text: openAiChatContentText(message.content),
        reasoning: openAiChatContentText(message.reasoning_content || message.reasoning),
    };
}

function openAiChatError(payload, modelId, fallback, status = 0) {
  const message = String(
    payload?.error?.message || payload?.message || fallback || '上游返回未知错误',
  ).slice(0, 500);
  const error = new Error(`API 错误 (${modelId}): ${message}`);
  const numericStatus = Number(status);
  if (Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599) {
    error.status = numericStatus;
    error.upstreamStatus = numericStatus;
  }
  const upstreamCode = payload?.error?.code || payload?.code;
  if (typeof upstreamCode === 'string' && upstreamCode) error.upstreamCode = upstreamCode.slice(0, 100);
  return error;
}

async function readOpenAiChatResponse(response, modelId, onToken) {
    if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
        let text = '', reasoning = '';
        for await (const { payload } of chatPayloads(response)) {
            if (payload?.error) throw annotateProviderError(openAiChatError(payload, modelId, '', response.status), { stage: 'stream', response, payload });
            const chunk = openAiChatMessage(payload);
            text += chunk.text;
            reasoning += chunk.reasoning;
            if (chunk.text) onToken?.(chunk.text);
        }
        return { text, reasoning };
    }
    const raw = await response.text();
    if (!raw.trim()) throw Object.assign(new Error('文本模型响应为空。'), {
        code: 'EMPTY_RESPONSE', upstreamStatus: response.status,
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/event-stream')) {
        let payload;
        try {
            payload = JSON.parse(raw);
        } catch {
            throw Object.assign(new Error('文本模型响应格式无效。'), {
                code: 'INVALID_JSON_RESPONSE', upstreamStatus: response.status,
            });
        }
        if (!response.ok || payload?.error) throw annotateProviderError(openAiChatError(payload, modelId, response.statusText, response.status), { stage: 'submit', response, payload });
        const result = openAiChatMessage(payload);
        if (result.text) onToken?.(result.text);
        return result;
    }

    throw openAiChatError(null, modelId, response.statusText, response.status);
}

export async function submitOpenAiChatWithLogs({
    url,
    headers,
    body,
    signal,
    nodeId,
    logsDir,
    modelId,
    projectId,
    useProxy,
    logBody = body,
    onToken,
}) {
    const requestBody = { ...body, stream: true };
    const fetchOptions = buildJsonFetchOptions({ headers, body: requestBody, signal });
    BaseProvider.injectProxy(fetchOptions, useProxy);
    BaseProvider.saveDebugLog(logsDir, `${modelId}_SUBMIT_REQ`, nodeId, {
        post_url: url,
        method: 'POST',
        headers: { Authorization: 'Bearer [API_KEY]', 'Content-Type': 'application/json' },
        body: { ...logBody, stream: true },
    }, projectId);
    let response, result;
    try {
        response = await BaseProvider.fetch(url, fetchOptions);
        result = await readOpenAiChatResponse(response, modelId, onToken);
    } catch (error) {
        throw annotateProviderError(error, { stage: error.diagnostics?.stage || (response?.ok ? 'stream' : 'submit'), response, requestBody: body });
    }
    BaseProvider.saveDebugLog(logsDir, `${modelId}_SUBMIT_RES`, nodeId, {
        post_url: url,
        stream: true,
        text: result.text,
        ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    }, projectId);
    return result;
}

export async function pollJsonTask({
    pollUrl,
    interval,
    headers,
    useProxy,
    parse
}) {
    return BaseProvider.pollTask({
        interval,
        pollFn: async () => {
            const fetchOptions = {};
            BaseProvider.injectProxy(fetchOptions, useProxy);
            const taskResponse = await BaseProvider.fetch(pollUrl, {
                ...fetchOptions,
                headers: headers || {}
            });
            const pollResult = await taskResponse.json();
            return parse(pollResult);
        }
    });
}
