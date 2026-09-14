import { annotateProviderError, safeUpstreamMessage } from '../telemetry/providerDiagnostics.js';
import { BaseProvider } from '../providers/baseProvider.js';
import { chatPayloads } from '../providers/chatStream.js';
import { canvasControlTool, validCanvasControl } from '../../src/shared/canvasControlProtocol.js';
import { controlInstructions } from './canvasControlInstructions.js';
import { imageContent, modelParameters, textModelConnection } from './drama/dramaModelGenerator.js';
import { canvasApiTool, invalidCanvasArguments } from './canvasApiTool.js';
import { parseCanvasToolArguments } from './canvasToolArguments.js';

function failure(message, code = 'AGENT_CANVAS_INCOMPLETE', status = 502) {
  return Object.assign(new Error(message), { name: 'AgentCanvasError', code, status });
}

function providerFailure(status, payload) {
  const error = classifyProviderFailure(status, payload);
  error.upstreamCode = payload?.error?.code || payload?.error?.type;
  error.upstreamMessage = safeUpstreamMessage(payload?.error?.message || payload?.message);
  return annotateProviderError(error, { payload });
}

function classifyProviderFailure(status, payload) {
  // Classify only; never echo provider bodies which can contain prompts or credentials.
  const detail = `${payload?.error?.code || payload?.code || ''} ${payload?.error?.type || ''} ${payload?.error?.message || payload?.message || ''}`;
  if (/^SetLimitExceeded$/i.test(payload?.error?.code || payload?.code || ''))
    return failure('当前模型已达到火山方舟设置的推理用量上限，服务已暂停。请到火山方舟“模型开通”检查该模型的用量限额；调整后可继续原对话。', 'PROVIDER_USAGE_LIMIT', status || 429);
  if (status === 402 || /insufficient[_\s-]*(?:quota|balance)|余额不足|用户额度不足/i.test(detail))
    return failure('模型账户余额或额度不足，请检查对应服务账户。', 'PROVIDER_BALANCE_INSUFFICIENT', 402);
  if ([401, 403].includes(status) || /invalid[_-]?api[_-]?key|authentication[_-]?error|unauthorized|accessdenied/i.test(detail)) return failure('模型服务未接受当前密钥或调用权限，请检查设置。', 'PROVIDER_AUTH_FAILED', status || 401);
  if (/context[_\s-]*(?:length|window|limit)|maximum context|too many tokens|上下文.{0,12}(?:超|长)/i.test(detail))
    return failure('当前对话超过所选模型的上下文容量。请换用容量更大的模型，或新建对话；原对话已保留，本次不会自动裁剪或重试。', 'AGENT_CONTEXT_EXCEEDED', status || 400);
  if (status === 429 || /rate[_\s-]*limit/i.test(detail))
    return failure('模型请求过于频繁或并发已满，请稍后再试。本次不会自动重试。', 'PROVIDER_RATE_LIMIT', status || 429);
  if (status === 413) return failure('本次内容超过模型服务的请求大小限制。请减少本轮附件或分次发送；原内容已保留。', 'AGENT_REQUEST_TOO_LARGE', status);
  if (status >= 500 || /service[_\s-]*unavailable|overloaded/i.test(detail))
    return failure('模型服务暂时不可用，请稍后再试。本次不会自动重试。', 'PROVIDER_UNAVAILABLE', status || 503);
  if (status === 400) return failure('模型服务不接受本次参数或附件，请检查所选模型支持的输入。', 'AGENT_CANVAS_INVALID_INPUT', status);
  return failure('模型请求失败，本次不会自动重试。', 'AGENT_CANVAS_PROVIDER_FAILED', status || 502);
}

/** Accumulate complete tool arguments before dispatch; a broken stream never executes partial JSON. */
export async function readToolChat(response, onToken) {
  try {
    return await readToolChatResponse(response, onToken);
  } catch (error) {
    // Client error classification must not replace the actual HTTP response status.
    throw annotateProviderError(error, { stage: response.ok ? 'stream' : 'submit', response });
  }
}

async function readToolChatResponse(response, onToken) {
  if (!response.ok) {
    let payload;
    try { payload = await response.json(); } catch { /* HTML/empty errors still have an HTTP status. */ }
    throw providerFailure(response.status, payload);
  }
  let content = '', reasoning = '', finish, usage;
  const calls = new Map();
  function accept(payload, streaming) {
    if (payload.error) throw providerFailure(0, payload);
    usage = payload.usage || usage;
    const choice = payload.choices?.[0];
    if (!choice) return;
    finish = choice.finish_reason || finish;
    const delta = streaming ? choice.delta : choice.message;
    if (!delta) return;
    if (typeof delta.content === 'string') {
      content += delta.content;
      if (delta.content) onToken?.(delta.content);
    }
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    for (const [position, call] of (delta.tool_calls || []).entries()) {
      const index = streaming ? call.index : position;
      if (!Number.isInteger(index) || index < 0 || index >= 8) throw failure('模型工具调用数量无效。');
      const current = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      current.id += call.id || '';
      current.function.name += call.function?.name || '';
      current.function.arguments += call.function?.arguments || '';
      calls.set(index, current);
    }
  }
  try {
    for await (const { payload, streaming } of chatPayloads(response)) accept(payload, streaming);
  } catch (error) {
    if (error.name === 'AgentCanvasError' || error.name === 'AbortError') throw error;
    throw failure('模型工具响应不完整，本次未执行其中的画布操作。');
  }
  if (!['stop', 'tool_calls'].includes(finish) || (calls.size && finish !== 'tool_calls'))
    throw failure('模型回答未完整结束，请核对已完成操作；不会自动重试。');
  const toolCalls = [...calls.values()];
  if (toolCalls.some(call => !/^[\w-]{1,128}$/.test(call.id)) || new Set(toolCalls.map(call => call.id)).size !== toolCalls.length)
    throw failure('模型工具调用标识无效。');
  return { message: { role: 'assistant', content: content || null,
    ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage };
}

/**
 * Same canvas contract as Codex; transport owns no canvas state and cannot
 * authorize generation.
 *
 * Run the model/tool conversation until the model returns a final answer.
 *
 * There is deliberately no default step limit: a multi-operation canvas task
 * may legitimately need more than a dozen tool turns.  Callers can still pass
 * a finite `maxSteps` as an explicit emergency bound (primarily useful for
 * tests or a deployment-specific policy).  The runner independently stops a
 * model that repeats the exact same tool request and receipt without making
 * progress.
 */
export function createCanvasAgentRunner({ fetcher = BaseProvider.fetch.bind(BaseProvider), maxSteps = Infinity } = {}) {
  return async function run(input) {
    const { modelConfig: model, modelParams = {}, credentials, signal, dispatch, libraryDirectory, projectId } = input;
    const { url, apiKey } = textModelConnection(model, credentials);
    const endpoint = model.endpoint['multimodal-chat'];
    const parameters = modelParameters(modelParams, model);
    const maximum = parameters.max_output_tokens;
    delete parameters.max_output_tokens;
    if (maximum !== undefined) parameters.max_completion_tokens = maximum;
    const images = await imageContent(input.media, { libraryDirectory, projectId, model, detail: modelParams.detail });
    const messages = input.messages ? structuredClone(input.messages) : [
      { role: 'system', content: input.skillInstructions || '根据用户要求完成画布创作。' },
      ...input.history.map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content) })),
      { role: 'user', content: input.message + (input.nodes?.length ? '\n\n本轮明确引用的画布节点（JSON 数据）：\n' + JSON.stringify(input.nodes) : '') },
    ];
    messages[0].content += '\n\n' + controlInstructions + '\n本轮已提供真实 canvas_control 工具。用户要求画布操作时调用工具并根据回执答复；最终回复仍遵守当前对话的交付格式。';
    const last = messages.at(-1);
    if (images.length) last.content = [{ type: 'text', text: last.content }, ...images];
    const tool = canvasApiTool();
    const usages = [];
    const stepLimit = Number.isFinite(maxSteps) && maxSteps >= 0 ? Math.floor(maxSteps) : Infinity;
    let previousRoundFingerprint = null;
    let repeatedRounds = 0;
    let lastOperation = '画布工具', lastResult = '';
    for (let step = 0; step < stepLimit; step++) {
      signal.throwIfAborted();
      const requestMessages = messages;
      const body = { model: endpoint.model, ...parameters, messages: requestMessages, tools: [tool], stream: true, stream_options: { include_usage: true } };
      const serializedBody = JSON.stringify(body);
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: serializedBody, signal };
      BaseProvider.injectProxy(options, model.useProxy === true);
      let chat, response;
      try {
        response = await fetcher(url, options);
        chat = await readToolChat(response, input.onToken);
      } catch (error) {
        annotateProviderError(error, { stage: response?.ok ? 'stream' : 'submit', response, requestBody: serializedBody });
        throw error;
      }
      const { message, usage } = chat;
      signal.throwIfAborted();
      if (usage) usages.push(usage);
      if (!message.tool_calls?.length) {
        if (!message.content?.trim()) throw failure('模型未返回有效回答。');
        return { response: message.content, usage: usages };
      }
      messages.push(message);
      const roundReceipts = [];
      for (const call of message.tool_calls) {
        signal.throwIfAborted();
        const command = parseCanvasToolArguments(call.function.arguments);
        let result = call.function.name === canvasControlTool.name && validCanvasControl(command)
          ? await dispatch(command) : invalidCanvasArguments(command);
        if (!result.ok && !result.expected) result = { ...result, recovery: result.code === 'INVALID'
          ? '本次操作未应用。先 read 核对节点；配置模型时用 models 查询完整模型名称和有效参数，再修正操作。新节点在同一批次内直接使用 create.ref 作为 nodeId。'
          : result.code === 'CONFLICT' ? '先 read 获取最新 revision，再根据当前画布修正操作。'
            : result.code === 'NOT_FOUND' ? '先 read 获取现有节点 ID；上个批次的 ref 需换成 created 返回的真实 id。'
              : '当前操作不可用或回执未确认。核对原状态并向用户说明，不能重复提交。' };
        lastOperation = ({ read: '读取画布', models: '查询模型', edit: '编辑节点' })[command?.action] || '画布工具';
        lastResult = result.ok ? '返回了相同结果' : ({ INVALID: '参数校验失败', CONFLICT: '画布版本冲突', NOT_FOUND: '目标不存在', UNAVAILABLE: '当前不可用', UNCONFIRMED: '回执未确认' })[result.code] || '执行失败';
        const { images: resultImages, ...receipt } = result;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(receipt) });
        roundReceipts.push(`${call.function.name}:${call.function.arguments}:${JSON.stringify(receipt)}`);
        if (resultImages?.length) messages.push({ role: 'user', content: [
          { type: 'text', text: '以下图片是画布工具返回的当前素材。' },
          ...resultImages.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
        ] });
      }
      const roundFingerprint = roundReceipts.join('|');
      if (roundFingerprint && roundFingerprint === previousRoundFingerprint) repeatedRounds += 1;
      else repeatedRounds = 0;
      previousRoundFingerprint = roundFingerprint;
      if (repeatedRounds >= 2) {
        throw failure(`模型未能继续完成操作：${lastOperation}${lastResult}，连续三轮未修正，已停止。已完成的画布修改保留。`, 'AGENT_CANVAS_NO_PROGRESS', 409);
      }
    }
    throw failure('已达到显式设置的画布操作上限，请核对画布和操作记录后继续。', 'AGENT_CANVAS_LIMIT', 409);
  };
}
