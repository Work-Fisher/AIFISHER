import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createCodexClient,
  type CodexMessage,
  type CodexSession,
  type CodexStatus,
} from './codexClient';
import type { AgentNode } from './agentClient';
import { createAgentTextBuffer } from './agentTextBuffer';
import type { CanvasActionHandler } from '../../shared/canvasControlProtocol.js';

/** Codex transport state; the existing Agent owns all conversation UI. */
export function useCodexAgent(project: string, enabled: boolean, onCanvasAction?: CanvasActionHandler) {
  const canvasHandler = useRef(onCanvasAction);
  useLayoutEffect(() => { canvasHandler.current = onCanvasAction; }, [onCanvasAction]);
  const [client] = useState(() => createCodexClient());
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [skillSlug, setSkillSlug] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [sessions, setSessions] = useState<Array<Pick<CodexSession, 'id' | 'topic' | 'status'>>>(
    [],
  );
  const [topic, setTopic] = useState('');
  const [scope, setScope] = useState({ project, enabled });
  if (scope.project !== project || scope.enabled !== enabled) {
    setScope({ project, enabled });
    setBusy(false);
    setConnecting(false);
    if (scope.project !== project) {
      setSessionId(crypto.randomUUID());
      setMessages([]);
      setSkillSlug(null);
      setSessions([]);
      setTopic('');
      setError('');
    }
  }
  const requests = useRef(new Set<AbortController>());
  const statusEpoch = useRef(0);
  const turn = useRef<AbortController | null>(null);
  const textBuffer = useRef<ReturnType<typeof createAgentTextBuffer> | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const request = useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      await work(controller.signal);
    } catch (problem) {
      if (!controller.signal.aborted && mounted.current)
        setError(problem instanceof Error ? problem.message : 'Codex 连接失败。');
    } finally {
      requests.current.delete(controller);
    }
  }, []);
  const refresh = useCallback(
    () =>
      request(async (signal) => {
        const owner = ++statusEpoch.current;
        const next = await client.status(signal);
        if (signal.aborted || !mounted.current || owner !== statusEpoch.current) return;
        setStatus(next);
        setError(next.loginError || '');
        setModel((current) =>
          next.models.some((item) => item.id === current) ? current : next.models[0]?.id || '',
        );
        if (next.connected || !next.loginPending) setAuthUrl('');
      }),
    [client, request],
  );
  const history = useCallback(
    () =>
      request(async (signal) => {
        const next = await client.list(project, signal);
        if (!signal.aborted && mounted.current) setSessions(next);
      }),
    [client, project, request],
  );
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    void refresh();
    void history();
    const pending = requests.current;
    const lifecycle = epoch;
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false;
      lifecycle.current++;
      textBuffer.current?.cancel();
      textBuffer.current = null;
      pending.forEach((controller) => controller.abort());
      turn.current?.abort();
      turn.current = null;
      window.removeEventListener('focus', focus);
    };
  }, [enabled, refresh, history]);
  useEffect(() => {
    if (!enabled || (!authUrl && !status?.loginPending)) return;
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [authUrl, status?.loginPending, enabled, refresh]);
  // Keep a configured adapter warm independently of the chat panel. This only
  // checks the connection; it never resumes or resubmits a user turn.
  useEffect(() => {
    if (!enabled || !status?.installed || busy || connecting) return;
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [enabled, status?.installed, busy, connecting, refresh]);
  const selectedModel = status?.models.find((item) => item.id === model);
  const chosenEffort = selectedModel?.efforts.includes(effort)
    ? effort
    : selectedModel?.defaultEffort || '';
  const openLogin = () =>
    request(async (signal) => {
      await client.openLogin(signal);
    });
  const login = async () => {
    if (connecting || busy) return;
    setConnecting(true);
    setError('');
    await request(async (signal) => {
      const result = await client.login(signal);
      if (signal.aborted || !mounted.current) return;
      setAuthUrl(result.authUrl);
      await client.openLogin(signal);
    });
    if (mounted.current) setConnecting(false);
  };
  const disconnect = async () => {
    if (busy || connecting) return;
    statusEpoch.current++;
    setConnecting(true);
    await request(async (signal) => {
      await client.disconnect(signal);
      if (!signal.aborted) {
        statusEpoch.current++;
        setStatus(null);
        setAuthUrl('');
      }
    });
    if (mounted.current) setConnecting(false);
  };
  const load = async (id: string, restoreSettings = true) => {
    if (turn.current) return;
    const owner = ++epoch.current;
    setBusy(true);
    setError('');
    let loaded: CodexSession | undefined;
    await request(async (signal) => {
      const session = await client.get(id, project, signal);
      if (signal.aborted || !mounted.current || owner !== epoch.current) return;
      if (session.id !== id || !Array.isArray(session.messages))
        throw new Error('对话记录格式无效，已保留当前内容。');
      loaded = session;
      setSessionId(id);
      setMessages(session.messages);
      setSkillSlug(session.skillSlug ?? null);
      setTopic(session.topic);
      if (restoreSettings) {
        if (session.model) setModel(session.model);
        setEffort(session.effort || '');
      }
      if (session.status !== 'completed')
        setError(session.recoveryError || '原对话未完整结束，当前显示已保留的内容。继续前请核对。');
    });
    if (mounted.current && owner === epoch.current) setBusy(false);
    return loaded;
  };
  const send = async (message: string, nodes: AgentNode[]) => {
    if (
      busy ||
      turn.current ||
      !mounted.current ||
      !status?.connected ||
      !selectedModel ||
      !message.trim()
    )
      return;
    const controller = new AbortController();
    turn.current = controller;
    const owner = ++epoch.current;
    setBusy(true);
    setError('');
    setMessages((current) => [
      ...current,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);
    const buffer = createAgentTextBuffer((content) => {
      if (mounted.current && owner === epoch.current)
        setMessages(current => current.map((item, index) => index === current.length - 1 ? { ...item, content } : item));
    });
    textBuffer.current = buffer;
    try {
      const result = await client.turn(
        {
          projectId: project,
          canvasControl: !!onCanvasAction,
          sessionId,
          message,
          model,
          effort: chosenEffort || undefined,
          skillSlug,
          nodes: nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            prompt: [node.prompt, node.textContent].filter(Boolean).join('\n'),
          })),
        },
        (text) => {
          if (mounted.current && owner === epoch.current && !controller.signal.aborted)
            buffer.push(text);
        },
        controller.signal,
        (action) => {
          if (!mounted.current || owner !== epoch.current || controller.signal.aborted)
            return { ok: false, code: 'UNAVAILABLE' };
          return canvasHandler.current?.(action, controller.signal) || { ok: false, code: 'UNAVAILABLE' };
        },
        (action) => {
          if (mounted.current && owner === epoch.current && !controller.signal.aborted) {
            buffer.flush();
            setMessages(current => current.map((item, index) => index === current.length - 1
              ? { ...item, actions: [...(item.actions || []), action] } : item));
          }
        },
      );
      if (mounted.current && owner === epoch.current) {
        buffer.cancel();
        setMessages(result.messages);
        setTopic(result.topic);
      }
    } catch (problem) {
      if (mounted.current && owner === epoch.current) buffer.flush();
      if (mounted.current && owner === epoch.current)
        setError(
          controller.signal.aborted
            ? '已请求停止。可打开对话历史核对已完成内容。'
            : problem instanceof Error
              ? problem.message
              : '对话未完成。',
        );
    } finally {
      buffer.cancel();
      if (textBuffer.current === buffer) textBuffer.current = null;
      if (turn.current === controller) turn.current = null;
      if (mounted.current && owner === epoch.current) {
        setBusy(false);
        void history();
      }
    }
  };
  return {
    async prepareSetup() {
      let prompt = '';
      await request(async (signal) => {
        const result = await client.setup(signal);
        if (!signal.aborted) prompt = result.prompt;
      });
      if (!prompt) throw new Error('连接指令生成失败，请重试。');
      return prompt;
    },
    status,
    model,
    setModel,
    chosenEffort,
    setEffort,
    skillSlug,
    setSkillSlug,
    selectedModel,
    authUrl,
    error,
    busy,
    connecting,
    sessionId,
    messages,
    sessions,
    topic,
    login,
    openLogin,
    disconnect,
    refresh,
    load,
    send,
    stop: () => {
      textBuffer.current?.flush();
      setMessages(current => current.map((item, index) => index === current.length - 1 && item.role === 'assistant' ? { ...item, stopped: true } : item));
      turn.current?.abort();
    },
    newChat() {
      textBuffer.current?.cancel();
      textBuffer.current = null;
      epoch.current++;
      turn.current?.abort();
      turn.current = null;
      setBusy(false);
      const id = crypto.randomUUID();
      setSessionId(id);
      setMessages([]);
      setSkillSlug(null);
      setTopic('');
      setError('');
      return id;
    },
  };
}
