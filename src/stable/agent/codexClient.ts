import { projectCanvasResult, validCanvasControl, type CanvasActionHandler } from '../../shared/canvasControlProtocol.js';
export interface CanvasActionLog { action: 'edit' | 'undo'; ok: boolean; operationId?: string; code?: string; operationCount?: number; state?: string }
export interface PromptProposal {
  id: string;
  nodeId: string;
  title: string;
  before: string;
  after: string;
}
export interface CodexMessage {
  role: string;
  content: string;
  stopped?: boolean;
  edits?: PromptProposal[];
  actions?: CanvasActionLog[];
}
export interface CodexSession {
  id: string;
  topic: string;
  model?: string;
  effort?: string;
  skillSlug?: string | null;
  status: string;
  messages: CodexMessage[];
  recoveryError?: string;
}
export interface CodexStatus {
  installed?: boolean;
  version?: string;
  connected: boolean;
  loginPending: boolean;
  loginError?: string;
  models: Array<{ id: string; label: string; efforts: string[]; defaultEffort: string }>;
}
export interface CodexTurn {
  canvasControl?: boolean;
  sessionId: string;
  projectId: string;
  message: string;
  model: string;
  effort?: string;
  skillSlug?: string | null;
  nodes: Array<{ id: string; type: string; title?: string; prompt: string }>;
}
export function createCodexClient(fetcher: typeof fetch = globalThis.fetch) {
  const base = '/api/agent/codex';
  async function json<T>(url: string, signal: AbortSignal, method = 'GET'): Promise<T> {
    const response = await fetcher(base + url, {
      method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Codex 连接失败');
    return body;
  }
  return {
    setup: (signal: AbortSignal) =>
      json<{ prompt: string; expiresAt: number }>('/setup', signal, 'POST'),
    status: (signal: AbortSignal) => json<CodexStatus>('/status', signal),
    login: (signal: AbortSignal) => json<{ authUrl: string }>('/login', signal, 'POST'),
    openLogin: (signal: AbortSignal) => json('/login/open', signal, 'POST'),
    disconnect: (signal: AbortSignal) => json('/disconnect', signal, 'POST'),
    list: (project: string, signal: AbortSignal) =>
      json<Array<Pick<CodexSession, 'id' | 'topic' | 'status'>>>(
        `/sessions?projectId=${encodeURIComponent(project)}`,
        signal,
      ),
    get: (id: string, project: string, signal: AbortSignal) =>
      json<CodexSession>(
        `/sessions/${encodeURIComponent(id)}?projectId=${encodeURIComponent(project)}`,
        signal,
      ),
    async turn(
      input: CodexTurn,
      onDelta: (text: string) => void,
      signal: AbortSignal,
      onCanvasAction?: CanvasActionHandler,
      onCanvasResult?: (action: CanvasActionLog) => void,
    ): Promise<CodexSession> {
      const response = await fetcher(`${base}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      });
      if (!response.ok || !response.body) throw new Error('Codex 连接失败，请检查登录状态。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '',
        done: CodexSession | undefined;
      const continuations: Array<() => Promise<void>> = [];
      const seenActions = new Set<string>();
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        while (!done) {
          const chunk = await reader.read();
          if (signal.aborted) throw new DOMException('已停止', 'AbortError');
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          let end;
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
            end = boundary.index;
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + boundary[0].length);
            const event = block
              .split('\n')
              .find((line) => line.startsWith('event:'))
              ?.slice(6)
              .trim();
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (!data) continue;
            const value = JSON.parse(data);
            if (event === 'delta' && typeof value.token === 'string') onDelta(value.token);
            if (event === 'canvas_result') onCanvasResult?.(value);
            if (event === 'canvas_action') {
              if (signal.aborted || value.projectId !== input.projectId || value.sessionId !== input.sessionId
                || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.requestId)
                || seenActions.has(value.requestId) || !validCanvasControl(value.command)
                || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now())
                throw new Error('画布操作不属于当前对话。');
              seenActions.add(value.requestId);
              let result;
              let afterTurn: (() => Promise<void>) | undefined;
              try {
                const local = await onCanvasAction?.(value, signal) || { ok: false, code: 'UNAVAILABLE' };
                if (local.ok) afterTurn = local.afterTurn;
                result = projectCanvasResult(local);
              }
              catch { result = { ok: false, code: 'UNCONFIRMED' }; }
              const acknowledgement = await fetcher(`${base}/actions/${value.requestId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: input.projectId, sessionId: input.sessionId, result }),
                signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
              });
              if (!acknowledgement.ok) throw new Error('画布操作回执未确认，请核对画布；不会自动重复执行。');
              if (afterTurn) continuations.push(afterTurn);
            }
            if (event === 'error') throw new Error(value.error || 'Codex 本轮未完成。');
            if (event === 'done' && Array.isArray(value.messages) && value.id === input.sessionId) {
              done = value;
              break;
            }
          }
          if (chunk.done) break;
        }
        if (!done) throw new Error('连接中断，请在本项目的对话历史中核对原回答。');
        for (const continuation of continuations) await continuation();
        return done;
      } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
      }
    },
  };
}
