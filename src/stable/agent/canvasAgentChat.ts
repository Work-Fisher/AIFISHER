import type * as React from 'react';
import { createAgentTextBuffer } from './agentTextBuffer';
import type { AgentConversation } from './agentConversation';
import type { CanvasActionHandler } from '../../shared/canvasControlProtocol.js';
import type { CanvasActionLog } from './codexClient';
import {
  AgentClientError,
  createAgentClient,
  type AgentClient,
  type AgentMessageInput,
  type AgentNode,
} from './agentClient';
type Media = NonNullable<AgentMessageInput['media']>;
export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  media?: Media;
  timestamp: Date;
  actions?: CanvasActionLog[];
  stopped?: boolean;
}
interface ChatState {
  messages: ChatMessage[];
  topic: string | null;
  sessionId: string | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  sessions: Array<Record<string, unknown>>;
  isLoadingSessions: boolean;
}
function messageError(error: unknown) {
  if (
    error instanceof AgentClientError &&
    error.status > 0 &&
    !['AGENT_STREAM_INCOMPLETE', 'AGENT_STREAM_INVALID', 'AGENT_STREAM_UNAVAILABLE'].includes(
      error.code,
    )
  )
    return error.message;
  return '连接中断，回答状态未确认。请先在对话历史中核对。';
}
export function createCanvasAgentChat(
  client: AgentClient,
  createId: () => string = () => crypto.randomUUID(),
  conversation?: AgentConversation,
  canvas?: { projectId: string; execute: CanvasActionHandler },
) {
  let state: ChatState = {
    messages: [],
    topic: null,
    sessionId: null,
    isLoading: false,
    isStreaming: false,
    error: null,
    sessions: [],
    isLoadingSessions: false,
  };
  let active = false,
    turnEpoch = 0,
    listEpoch = 0;
  let turnRequest: AbortController | undefined, listRequest: AbortController | undefined;
  let turnBuffer: ReturnType<typeof createAgentTextBuffer> | undefined;
  let loadingSessionId: string | null = null;
  const deletions = new Map<string, AbortController>(),
    listeners = new Set<() => void>();
  let unbindConversation: (() => void) | undefined;
  let conversationEnabled = true;
  const bindingOperations = {
    ensureSession: () => {
      const id = state.sessionId || createId();
      if (id !== state.sessionId) update({ sessionId: id });
      return id;
    },
    setMessages: (messages: ChatMessage[]) => update({ messages }),
    setTopic: (topic: string) => update({ topic }),
    setError: (error: string | null) => update({ error }),
    setLoading: (isLoading: boolean) => update({ isLoading }),
  };
  const bindConversation = () => {
    unbindConversation?.();
    unbindConversation = conversationEnabled ? conversation?.bind({
      ...bindingOperations, sessionId: state.sessionId, isLoading: state.isLoading,
    }) : undefined;
  };
  const update = (patch: Partial<ChatState>) => {
    if (!active) return;
    const previous = state;
    state = { ...state, ...patch };
    if (previous.sessionId !== state.sessionId || previous.isLoading !== state.isLoading)
      bindConversation();
    listeners.forEach((listener) => listener());
  };
  const owns = (epoch: number) => active && turnEpoch === epoch;
  const invalidate = () => {
    turnBuffer?.cancel();
    turnBuffer = undefined;
    turnEpoch++;
    turnRequest?.abort();
    turnRequest = undefined;
    loadingSessionId = null;
  };
  const refreshSessions = async () => {
    if (!active) return;
    const epoch = ++listEpoch;
    listRequest?.abort();
    const controller = new AbortController();
    listRequest = controller;
    update({ isLoadingSessions: true });
    try {
      const sessions = await client.listSessions({ signal: controller.signal });
      if (!Array.isArray(sessions)) throw Error('对话历史格式无效');
      if (active && epoch === listEpoch) update({ sessions });
    } catch (error) {
      if (active && epoch === listEpoch && !controller.signal.aborted)
        update({ error: error instanceof Error ? error.message : '读取对话历史失败' });
    } finally {
      if (active && epoch === listEpoch) {
        listRequest = undefined;
        update({ isLoadingSessions: false });
      }
    }
  };
  const startNewChat = () => {
    if (!active) return;
    invalidate();
    update({ messages: [], topic: null, sessionId: createId(), error: null, isLoading: false, isStreaming: false });
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    setConversationEnabled(enabled: boolean) {
      if (conversationEnabled === enabled) return;
      conversationEnabled = enabled;
      if (!enabled) {
        // Stop late API/drama writes when another backend owns the visible chat.
        // Keep its saved messages and selection for an explicit switch back.
        invalidate();
        update({ isLoading: false, isStreaming: false });
      }
      if (active) bindConversation();
    },
    activate() {
      active = true;
      bindConversation();
    },
    deactivate() {
      active = false;
      unbindConversation?.();
      unbindConversation = undefined;
      invalidate();
      listEpoch++;
      listRequest?.abort();
      listRequest = undefined;
      deletions.forEach((controller) => controller.abort());
      deletions.clear();
      state = { ...state, isLoading: false, isStreaming: false, isLoadingSessions: false };
    },
    refreshSessions,
    startNewChat,
    stop() {
      if (!active || !state.isStreaming) return;
      turnBuffer?.flush();
      invalidate();
      update({ isLoading: false, isStreaming: false, error: null,
        messages: state.messages.map((item, index) => index === state.messages.length - 1 && item.role === 'assistant'
          ? { ...item, stopped: true } : item),
      });
    },
    async loadSession(id: string) {
      if (!active || !id || deletions.has(id)) return false;
      invalidate();
      const epoch = turnEpoch,
        controller = new AbortController();
      turnRequest = controller;
      loadingSessionId = id;
      update({ isLoading: true, isStreaming: false, error: null });
      try {
        const session = await client.getSession(id, { signal: controller.signal });
        if (!Array.isArray(session.messages)) throw Error('对话内容格式无效');
        const messages = session.messages.map((value, index): ChatMessage => {
          if (
            !value ||
            typeof value !== 'object' ||
            typeof value.content !== 'string' ||
            typeof value.role !== 'string'
          )
            throw Error('对话内容格式无效');
          const timestamp = new Date(value.timestamp || session.createdAt || Date.now());
          return {
            id: `loaded-${id}-${index}`,
            role: value.role,
            content: value.content,
            media: value.media,
            actions: value.actions,
            stopped: value.stopped === true,
            timestamp: Number.isFinite(timestamp.getTime()) ? timestamp : new Date(),
          };
        });
        if (!owns(epoch)) return false;
        update({
          sessionId: id,
          messages,
          topic: typeof session.topic === 'string' ? session.topic : null,
        });
        return true;
      } catch (error) {
        if (owns(epoch)) update({ error: error instanceof Error ? error.message : '读取对话失败' });
        return false;
      } finally {
        if (owns(epoch)) {
          turnRequest = undefined;
          loadingSessionId = null;
          update({ isLoading: false });
        }
      }
    },
    async deleteSession(id: string) {
      if (!active || !id || deletions.has(id)) return false;
      if (state.isLoading) {
        update({ error: '请等待当前对话操作完成后再删除。' });
        return false;
      }
      const controller = new AbortController();
      deletions.set(id, controller);
      const epoch = turnEpoch,
        wasCurrent = state.sessionId === id;
      if (wasCurrent) update({ isLoading: true });
      try {
        const receipt = await client.deleteSession(id, { signal: controller.signal });
        if (receipt.success !== true) throw Error('删除对话未得到确认');
        if (!active || controller.signal.aborted) return false;
        if (state.sessionId === id) {
          // A different history load may still be running, or may already have
          // failed. A confirmed deletion must never leave the removed ID active.
          if (loadingSessionId !== null && loadingSessionId !== id)
            update({ sessionId: null, messages: [], topic: null });
          else startNewChat();
        }
        update({ sessions: state.sessions.filter((session) => session.id !== id) });
        void refreshSessions();
        return true;
      } catch (error) {
        if (active && !controller.signal.aborted)
          update({ error: error instanceof Error ? error.message : '删除对话失败' });
        return false;
      } finally {
        if (deletions.get(id) === controller) deletions.delete(id);
        if (owns(epoch) && state.sessionId === id) update({ isLoading: false });
      }
    },
    async sendMessage(
      message: string,
      media?: Media,
      model?: string,
      modelParams?: Record<string, unknown>,
      nodes?: AgentNode[],
    ) {
      if (
        !active || !conversationEnabled ||
        state.isLoading ||
        (state.sessionId !== null && deletions.has(state.sessionId)) ||
        (!message.trim() && !media?.length) ||
        !model
      )
        return false;
      invalidate();
      const epoch = turnEpoch,
        controller = new AbortController();
      turnRequest = controller;
      const sessionId = state.sessionId || createId(),
        assistantId = createId();
      const context = conversation?.requestContext();
      const user: ChatMessage = {
        id: createId(),
        role: 'user',
        content: message,
        media: media?.map((item) => ({ type: item.type, url: item.url })),
        timestamp: new Date(),
      };
      update({
        sessionId,
        isLoading: true,
        isStreaming: true,
        error: null,
        messages: [
          ...state.messages,
          user,
          { id: assistantId, role: 'assistant', content: '', timestamp: new Date() },
        ],
      });
      const replaceAnswer = (content: string) =>
        update({
          messages: state.messages.map((item) =>
            item.id === assistantId ? { ...item, content } : item,
          ),
        });
      const buffer = createAgentTextBuffer((content) => { if (owns(epoch)) replaceAnswer(content); });
      turnBuffer = buffer;
      try {
        const result = await client.streamMessage(
          {
            ...context,
            ...(canvas ? { projectId: canvas.projectId, canvasControl: true } : {}),
            sessionId,
            message,
            model,
            modelParams,
            nodes: nodes?.map((node) => ({
              id: node.id,
              type: node.type,
              title: node.title,
              prompt: node.prompt,
              textContent: node.textContent,
              model: node.model,
              imageModel: node.imageModel,
              videoModel: node.videoModel,
              audioModel: node.audioModel,
              comfyMode: node.comfyMode,
            })),
            media: media?.map((item) => ({
              type: item.type,
              ...(item.type === 'image' && item.base64
                ? { base64: item.base64 }
                : { url: item.url }),
            })),
          },
          (token) => {
            if (owns(epoch)) buffer.push(token);
          },
          { signal: controller.signal,
            onCanvasAction: (request, signal) => owns(epoch) && !controller.signal.aborted && canvas
              ? canvas.execute(request, signal) : { ok: false, code: 'UNAVAILABLE' },
            onCanvasResult: (action) => {
              if (owns(epoch)) buffer.flush();
              if (owns(epoch)) update({ messages: state.messages.map(item => item.id === assistantId
                ? { ...item, actions: [...(item.actions || []), action] } : item) });
            },
          },
        );
        if (!owns(epoch)) return false;
        buffer.cancel();
        replaceAnswer(result.response);
        update({ topic: result.topic || state.topic });
        void refreshSessions();
        return true;
      } catch (error) {
        if (owns(epoch)) buffer.flush();
        if (owns(epoch))
          update({
            error: messageError(error),
            messages: state.messages.filter((item) => item.id !== assistantId || !!item.content || !!item.actions?.length),
          });
        return false;
      } finally {
        buffer.cancel();
        if (owns(epoch)) {
          turnBuffer = undefined;
          turnRequest = undefined;
          update({ isLoading: false, isStreaming: false });
          void conversation?.onTurnSettled(sessionId, context?.projectId).catch(() => {});
        }
      }
    },
  };
}
type Runtime = Pick<typeof React, 'useMemo' | 'useEffect' | 'useSyncExternalStore' | 'useRef'>;
export function useCanvasAgentChat(React: Runtime, conversationEnabled = true, canvas?: { projectId: string; execute: CanvasActionHandler }) {
  const canvasRef = React.useRef(canvas);
  const projectId = canvas?.projectId;
  React.useEffect(() => { canvasRef.current = canvas; }, [canvas]);
  const controller = React.useMemo(() => {
    // CanvasSidePanels keys the Agent by document epoch, including unsaved projects.
    return createCanvasAgentChat(createAgentClient(), undefined, window.__FISHERAI_AGENT_CONVERSATION__, projectId !== undefined ? { projectId, execute: (request, signal) => canvasRef.current?.execute(request, signal) || { ok: false, code: 'UNAVAILABLE' } } : undefined);
  }, [projectId]);
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  React.useEffect(() => {
    controller.setConversationEnabled(conversationEnabled);
  }, [controller, conversationEnabled]);
  React.useEffect(() => {
    controller.activate();
    void controller.refreshSessions();
    return () => controller.deactivate();
  }, [controller]);
  return {
    ...state,
    sendMessage: controller.sendMessage,
    loadSession: controller.loadSession,
    deleteSession: controller.deleteSession,
    startNewChat: controller.startNewChat,
    stop: controller.stop,
    refreshSessions: controller.refreshSessions,
    hasMessages: state.messages.length > 0,
  };
}
