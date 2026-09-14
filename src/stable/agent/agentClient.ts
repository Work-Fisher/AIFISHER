import type { DramaComposition, DramaExecution, DramaPlan } from './dramaClient';
import { projectCanvasResult, validCanvasControl, type CanvasActionHandler, type CanvasActionRequest } from '../../shared/canvasControlProtocol.js';
import type { CanvasActionLog } from './codexClient';

export type AgentNode = {
  id: string;
  type: string;
  title?: string;
  model?: string;
  prompt?: string;
  textContent?: string;
  imageModel?: string;
  videoModel?: string;
  audioModel?: string;
  comfyMode?: string;
};
export type AgentMessageInput = {
  sessionId: string;
  message?: string;
  media?: Array<{ type: 'image' | 'video' | 'audio'; url?: string; base64?: string }>;
  nodes?: AgentNode[];
  model?: string;
  modelParams?: Record<string, unknown>;
  projectId?: string;
  canvasControl?: boolean;
};

export type AgentSelectedSkill = {
  slug: string; source: 'official' | 'local'; version?: string; projectId?: string;
};

export type AgentSession = {
  id: string;
  topic: string;
  createdAt: string;
  messages: Array<{ role: string; content: string; timestamp?: string; media?: AgentMessageInput['media']; actions?: CanvasActionLog[]; stopped?: boolean }>;
  selectedSkill?: AgentSelectedSkill | null;
  skillProjectId?: string;
  workflow?: {
    id: 'minimax-drama'; projectId: string; version: string; bundleId?: string;
    script?: { name: string; text: string }; planId?: string; previousPlanIds?: string[];
  };
};

export type DramaConversationState = {
  session: AgentSession; plan: DramaPlan | null; execution: DramaExecution | null;
  composition?: DramaComposition;
};
export type DramaConversationAction = {
  action: 'approve' | 'generate' | 'compose' | 'query';
  planId: string; planRevision: number; assetId?: string; attemptId?: string;
  retryOfAttemptId?: string; confirmPaidExecution?: boolean; maxAssets?: number; confirmAssets?: boolean;
};
export type AgentStreamResult = { response: string; topic?: string; messageCount: number };
export class AgentClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'AgentClientError';
  }
}
type Options = { signal?: AbortSignal; onCanvasAction?: CanvasActionHandler; onCanvasResult?: (action: CanvasActionLog) => void };
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}
async function request<T>(
  options: Options,
  timeout: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(options.signal?.reason || new DOMException('请求已停止', 'AbortError'));
  const aborted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    }),
  );
  const timer = timeout > 0 ? setTimeout(
    () =>
      controller.abort(
        new AgentClientError('Agent 请求等待超时', 'AGENT_REQUEST_TIMEOUT', 0, false),
      ),
    timeout,
  ) : undefined;
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        checkAbort(controller.signal);
        return work(controller.signal);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => {
    throw new AgentClientError(
      'Agent 响应格式无效',
      'AGENT_RESPONSE_INVALID',
      response.status,
      false,
    );
  });
  if (!response.ok)
    throw new AgentClientError(
      String(body?.error || `Agent 请求失败 (${response.status})`),
      String(body?.code || 'AGENT_REQUEST_FAILED'),
      response.status,
      body?.retryable === true,
    );
  return body;
}
function parseEventBlock(block: string) {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try {
    const value: unknown = JSON.parse(data.join('\n'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return { event, data: value as Record<string, unknown> };
  } catch {
    throw new AgentClientError('Agent 流式响应格式无效', 'AGENT_STREAM_INVALID', 502, false);
  }
}
export function createAgentClient(fetcher: typeof fetch = globalThis.fetch) {
  const json = <T>(url: string, init: RequestInit = {}, options: Options = {}, timeout = 15000) =>
    request(options, timeout, async (signal) => {
      const response = await fetcher(url, { ...init, signal });
      checkAbort(signal);
      const value = await readJson<T>(response);
      checkAbort(signal);
      return value;
    });
  const dramaRoute = (sessionId: string) => `/api/chat/sessions/${encodeURIComponent(sessionId)}/drama`;
  const post = <T>(url: string, body: unknown, options: Options = {}, timeout = 15000) =>
    json<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, options, timeout);
  return {
    selectSkill(sessionId: string, projectId: string, slug: string | null, options: Options = {}): Promise<AgentSession> {
      return post(`/api/chat/sessions/${encodeURIComponent(sessionId)}/skill`, { projectId, slug }, options);
    },
    getDramaConversation(sessionId: string, projectId: string, options: Options = {}): Promise<DramaConversationState> {
      return json(`${dramaRoute(sessionId)}?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' }, options);
    },
    attachDramaScript(sessionId: string, projectId: string, script: { name: string; text: string }, options: Options = {}): Promise<DramaConversationState> {
      return post(`${dramaRoute(sessionId)}/script`, { projectId, script }, options);
    },
    dramaAction(sessionId: string, projectId: string, action: DramaConversationAction, options: Options = {}): Promise<DramaConversationState> {
      return post(`${dramaRoute(sessionId)}/actions`, { projectId, ...action }, options, 600000);
    },
    startOfficialDrama(sessionId: string, projectId: string, options: Options = {}): Promise<AgentSession> {
      return post(`/api/chat/sessions/${encodeURIComponent(sessionId)}/official-drama`, { projectId }, options);
    },
    sendMessage(input: AgentMessageInput, options: Options = {}): Promise<AgentStreamResult> {
      return json(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        options,
        600000,
      );
    },
    streamMessage(
      input: AgentMessageInput,
      onToken: (token: string) => void = () => undefined,
      options: Options = {},
    ): Promise<AgentStreamResult> {
      return request(options, 0, async (signal) => {
        const response = await fetcher('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        });
        checkAbort(signal);
        if (!response.ok) return readJson<AgentStreamResult>(response);
        if (!response.body)
          throw new AgentClientError(
            'Agent 流式响应不可用',
            'AGENT_STREAM_UNAVAILABLE',
            502,
            false,
          );
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener('abort', cancel, { once: true });
        let buffer = '',
          result: AgentStreamResult | undefined;
        const continuations: Array<() => Promise<void>> = [];
        const seenActions = new Set<string>();
        const consume = async (block: string) => {
          checkAbort(signal);
          const parsed = parseEventBlock(block);
          if (!parsed) return;
          if (parsed.event === 'canvas_action') {
            const value = parsed.data;
            if (!input.canvasControl || value.projectId !== input.projectId || value.sessionId !== input.sessionId
              || typeof value.requestId !== 'string' || !/^[\w-]{1,128}$/.test(value.requestId)
              || !validCanvasControl(value.command) || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()
              || seenActions.has(value.requestId)) throw new AgentClientError('画布指令无效或已失效，请核对当前画布。', 'AGENT_CANVAS_SCOPE', 409, false);
            seenActions.add(value.requestId);
            let receipt;
            let afterTurn: (() => Promise<void>) | undefined;
            try {
              const local = await options.onCanvasAction?.(value as unknown as CanvasActionRequest, signal) || { ok: false, code: 'UNAVAILABLE' };
              if (local.ok) afterTurn = local.afterTurn;
              receipt = projectCanvasResult(local);
            } catch { receipt = { ok: false, code: 'UNCONFIRMED' }; }
            checkAbort(signal);
            const ack = await fetcher(`/api/chat/actions/${value.requestId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: input.projectId, sessionId: input.sessionId, result: receipt }),
              signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
            });
            const confirmed = await readJson<{ success: boolean }>(ack);
            if (confirmed.success !== true) throw new AgentClientError('画布回执未确认，请核对画布；不会重复执行。', 'AGENT_CANVAS_UNCONFIRMED', 409, false);
            if (afterTurn) continuations.push(afterTurn);
          }
          if (parsed.event === 'canvas_result') {
            const value = parsed.data;
            if (['edit', 'undo'].includes(String(value.action)) && typeof value.ok === 'boolean')
              options.onCanvasResult?.(value as unknown as CanvasActionLog);
          }
          if (parsed.event === 'delta' && typeof parsed.data.token === 'string')
            onToken(parsed.data.token);
          if (parsed.event === 'done') {
            if (
              typeof parsed.data.response !== 'string' ||
              !Number.isFinite(parsed.data.messageCount)
            )
              throw new AgentClientError('Agent 完成回执无效', 'AGENT_STREAM_INVALID', 502, false);
            result = {
              response: parsed.data.response,
              topic: typeof parsed.data.topic === 'string' ? parsed.data.topic : undefined,
              messageCount: Number(parsed.data.messageCount),
            };
          }
          if (parsed.event === 'error')
            throw new AgentClientError(
              String(parsed.data.error || 'Agent 流式请求失败'),
              String(parsed.data.code || 'AGENT_STREAM_FAILED'),
              200,
              parsed.data.retryable === true,
            );
        };
        try {
          while (!result) {
            // Several adapters emit their first delta only after the full answer.
            // The total request deadline applies; silence is not a failed stream.
            const next = await reader.read();
            checkAbort(signal);
            buffer += decoder.decode(next.value, { stream: !next.done });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              await consume(block);
              if (result) break;
            }
            if (next.done) {
              if (!result && buffer.trim()) await consume(buffer);
              break;
            }
          }
          if (!result)
            throw new AgentClientError(
              'Agent 流式响应未正常结束',
              'AGENT_STREAM_INCOMPLETE',
              502,
              false,
            );
          for (const continuation of continuations) { checkAbort(signal); await continuation(); }
          return result;
        } finally {
          signal.removeEventListener('abort', cancel);
          cancel();
          reader.releaseLock();
        }
      });
    },
    listSessions(options: Options = {}): Promise<Array<Record<string, unknown>>> {
      return json('/api/chat/sessions', {}, options);
    },
    getSession(sessionId: string, options: Options = {}): Promise<AgentSession> {
      return json(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {}, options);
    },
    async deleteSession(
      sessionId: string,
      options: Options = {},
    ): Promise<{ success: boolean; recoverable: boolean }> {
      const receipt = await json<{ success: boolean; recoverable: boolean }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
        options,
      );
      if (receipt?.success !== true)
        throw new AgentClientError('删除对话未得到确认', 'AGENT_DELETE_UNCONFIRMED', 200, false);
      return receipt;
    },
    searchNodes(query: string, nodes: AgentNode[], type?: string, options: Options = {}) {
      return json<{
        results: Array<{ id: string; title: string; locateUrl: string }>;
        total: number;
      }>(
        '/api/chat/tools/search-nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, type, nodes }),
        },
        options,
      );
    },
  };
}
export type AgentClient = ReturnType<typeof createAgentClient>;
declare global {
  interface Window {
    __FISHERAI_AGENT__?: AgentClient;
  }
}
export function installAgentClient(client = createAgentClient()): AgentClient {
  window.__FISHERAI_AGENT__ = client;
  return client;
}
