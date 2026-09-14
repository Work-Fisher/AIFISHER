import { createAgentClient, type AgentClient, type AgentMessageInput, type AgentSession, type AgentSelectedSkill, type DramaConversationAction, type DramaConversationState } from './agentClient';
import { productionProfileForSkill } from '../../shared/officialProductionProfiles.js';

export const DEFAULT_AGENT_SKILL = Object.freeze({ slug: 'minimax-drama-prompt', source: 'official' as const });
const isDramaSkill = (skill: AgentSelectedSkill | null) => skill?.source === 'official' && Boolean(productionProfileForSkill(skill.slug));

type NativeMessage = { id: string; role: string; content: string; timestamp: Date; media?: AgentMessageInput['media'] };
type NativeConversation = {
  sessionId: string | null;
  isLoading: boolean;
  ensureSession(): string;
  setMessages(messages: NativeMessage[]): void;
  setTopic(topic: string): void;
  setError(error: string | null): void;
  setLoading(loading: boolean): void;
};
type ConversationClient = Partial<Pick<AgentClient,
  'startOfficialDrama' | 'selectSkill' | 'getSession' | 'getDramaConversation' | 'attachDramaScript' | 'dramaAction'>>;
export type ConversationSnapshot = {
  sessionId: string | null; projectId: string | null; busy: boolean;
  state: DramaConversationState | null; error: string | null;
  selectedSkill: AgentSelectedSkill | null;
  restoring: boolean;
};
export type ConversationTools = {
  current(): boolean;
  action(action: DramaConversationAction): Promise<DramaConversationState>;
  attachScript(script: { name: string; text: string }): Promise<DramaConversationState>;
};

/** The original Agent owns its messages, history and composer; no second chat UI. */
export function createAgentConversation(
  projectId: () => string | null,
  client: ConversationClient = createAgentClient(),
) {
  let native: NativeConversation | null = null;
  let starting = false;
  let disposed = false;
  let working = false;
  let pendingSession: string | null = null;
  let cached: DramaConversationState | null = null;
  let selected: AgentSelectedSkill | null = null;
  let selectionKnown = false;
  let restoring = false;
  let restoringRevision = 0;
  let needsRestore = false;
  let error: string | null = null;
  let contextKey = '';
  let epoch = 0;
  let readEpoch = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const sessionId = () => native?.sessionId || (native ? pendingSession : null);
  const isCurrent = (id: string, project?: string) => !disposed && Boolean(native)
    && sessionId() === id && (!project || projectId() === project);
  const currentSkill = () => selectionKnown ? selected : { ...DEFAULT_AGENT_SKILL, projectId: projectId() || undefined };
  const readSelection = (session: AgentSession) => {
    selected = session.selectedSkill === null ? null : session.selectedSkill || { ...DEFAULT_AGENT_SKILL, projectId: session.workflow?.projectId || projectId() || undefined };
    selectionKnown = true;
  };
  const applyMessages = (session: AgentSession) => {
    native?.setMessages(session.messages.map((message, index) => ({
      ...message, id: `loaded-${session.id}-${index}`,
      timestamp: new Date(message.timestamp || session.createdAt),
    })));
    native?.setTopic(session.topic);
  };
  const accept = (state: DramaConversationState, synchronizeMessages = false) => {
    if (!isCurrent(state.session.id, state.session.workflow?.projectId)) return false;
    readSelection(state.session);
    cached = state.session.workflow?.id === 'minimax-drama' && isDramaSkill(selected) ? state : null;
    error = null; readEpoch += 1;
    if (synchronizeMessages) applyMessages(state.session);
    notify();
    return true;
  };
  const refresh = async (id = sessionId(), project = projectId()) => {
    if (!id || !project || !isCurrent(id, project)) return null;
    needsRestore = false;
    const revision = ++readEpoch;
    const generation = epoch;
    restoring = true; restoringRevision = revision; notify();
    const current = () => revision === readEpoch && generation === epoch && isCurrent(id, project);
    try {
      if (client.getSession) {
        const session = await client.getSession(id);
        if (!current()) return null;
        if (session.id !== id) throw new Error('读取的对话不匹配，请重新打开当前对话。');
        if ((session.skillProjectId && session.skillProjectId !== project)
          || (session.selectedSkill?.projectId && session.selectedSkill.projectId !== project)
          || (session.workflow?.projectId && session.workflow.projectId !== project)) {
          cached = null; selected = null; selectionKnown = true;
          error = '这段对话属于另一个项目，请返回原项目或新建对话。'; notify(); return null;
        }
        readSelection(session); error = null;
        if (!isDramaSkill(selected) || session.workflow?.id !== 'minimax-drama') {
          cached = null; notify(); return null;
        }
        notify();
      }
      if (!client.getDramaConversation) return null;
      const state = await client.getDramaConversation(id, project);
      if (!current()) return null;
      accept(state);
      return state;
    } catch (cause) {
      if (!current()) return null;
      // A freshly allocated native chat may not have a server record yet.
      if (Number((cause as { status?: number }).status) === 404 && !selectionKnown && !cached) {
        selected = { ...DEFAULT_AGENT_SKILL, projectId: project }; selectionKnown = true; error = null;
      } else {
        error = cause instanceof Error ? cause.message : '对话状态查询中断，请手动查询原任务。';
      }
      notify();
      return null;
    } finally {
      if (restoringRevision === revision) { restoring = false; notify(); }
    }
  };
  const restoreWhenIdle = () => {
    if (needsRestore && native && !starting && !working && !native.isLoading) {
      needsRestore = false; void refresh();
    }
  };
  const api = {
    bind(binding: NativeConversation) {
      if (binding.sessionId || (native && native.setMessages !== binding.setMessages)) pendingSession = null;
      native = binding;
      const key = `${binding.sessionId || pendingSession || ''}:${projectId() || ''}`;
      if (key !== contextKey) {
        contextKey = key; epoch += 1; readEpoch += 1; cached = null; selected = null; selectionKnown = false; error = null;
        restoring = false; restoringRevision = readEpoch;
        needsRestore = true;
      }
      queueMicrotask(() => { if (native === binding) restoreWhenIdle(); });
      notify();
      return () => {
        if (native !== binding) return;
        native = null;
        queueMicrotask(() => {
          if (!native) {
            epoch += 1; readEpoch += 1; pendingSession = null; contextKey = '';
            cached = null; selected = null; selectionKnown = false;
            restoring = false; restoringRevision = readEpoch; needsRestore = false; notify();
          }
        });
      };
    },
    isCurrent,
    snapshot(): ConversationSnapshot {
      const id = sessionId(); const project = projectId();
      const state = cached?.session.id === id && cached.session.workflow?.projectId === project && isDramaSkill(currentSkill()) ? cached : null;
      return { sessionId: id, projectId: project, busy: starting || working || restoring || Boolean(native?.isLoading), state, error, selectedSkill: currentSkill(), restoring };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    async onTurnSettled(id: string, project?: string) {
      if (isCurrent(id, project)) await refresh(id, project || projectId());
    },
    requestContext() { return { projectId: projectId() || undefined }; },
    async selectSkill(slug: string | null) {
      if (disposed || starting || working || restoring || native?.isLoading) return false;
      if (!native) throw new Error('Agent 尚未就绪，请稍后再试。');
      const project = projectId();
      if (!project) throw new Error('请先打开一个画布项目，再选择 SKILL。');
      const binding = native;
      const currentId = binding.ensureSession();
      pendingSession = currentId;
      const key = `${currentId}:${project}`;
      if (key !== contextKey) { contextKey = key; epoch += 1; readEpoch += 1; }
      const generation = epoch;
      const ownsSession = () => !disposed && Boolean(native)
        && native?.setMessages === binding.setMessages
        && (native?.sessionId === currentId || native === binding);
      const stillCurrent = () => ownsSession() && projectId() === project && generation === epoch;
      starting = true;
      binding.setLoading(true);
      binding.setError(null);
      notify();
      try {
        const session = client.selectSkill ? await client.selectSkill(currentId, project, slug)
          : slug === DEFAULT_AGENT_SKILL.slug && client.startOfficialDrama ? await client.startOfficialDrama(currentId, project)
          : (() => { throw new Error('SKILL 选择接口尚未就绪。'); })();
        if (!stillCurrent()) return false;
        // Selection is not a chat turn. Never replace native messages, drafts or attachments.
        readSelection(session); cached = null; error = null; readEpoch += 1; notify();
        await refresh(currentId, project);
        return true;
      } catch (cause) {
        if (stillCurrent()) { error = cause instanceof Error ? cause.message : 'SKILL 切换失败，请重试。'; notify(); }
        throw cause;
      } finally {
        starting = false;
        if (ownsSession()) binding.setLoading(false);
        notify();
        queueMicrotask(restoreWhenIdle);
      }
    },
    async startOfficialDrama() { return api.selectSkill(DEFAULT_AGENT_SKILL.slug); },
    async ensureDefaultSkill() {
      if (disposed || starting || working || native?.isLoading) return false;
      if (sessionId() && !selectionKnown) await refresh();
      if (error) throw new Error(error);
      if (!isDramaSkill(currentSkill())) throw new Error('当前对话选择了其他 SKILL，请先切回剧本文戏。');
      if (api.snapshot().state) return true;
      if (!(await api.selectSkill(currentSkill()!.slug))) return false;
      if (error) throw new Error(error);
      if (!api.snapshot().state) throw new Error('文戏状态尚未恢复，请重新读取后再添加剧本。');
      const id = sessionId(); const project = projectId(); const generation = epoch;
      // React may still expose the preceding selection's loading=true binding.
      // Wait only for that UI commit; never retry the selection or attachment.
      for (let attempt = 0; native?.isLoading && attempt < 30; attempt += 1) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 16));
        if (!id || !project || !isCurrent(id, project) || epoch !== generation) return false;
      }
      if (native?.isLoading) throw new Error('请等待当前界面恢复后再添加剧本。');
      return true;
    },
    async withTools<T>(work: (tools: ConversationTools) => Promise<T>): Promise<T> {
      const binding = native; const id = sessionId(); const project = projectId();
      if (!binding || !id || !project || !isDramaSkill(currentSkill()) || cached?.session.id !== id || cached.session.workflow?.projectId !== project || !isCurrent(id, project)) {
        throw new Error('请在当前项目的文戏对话中操作。');
      }
      if (starting || working || restoring || binding.isLoading) throw new Error('请等待当前回复或操作完成。');
      const generation = epoch;
      const current = () => isCurrent(id, project) && epoch === generation && isDramaSkill(currentSkill());
      const check = () => { if (!current()) throw new Error('对话或项目已经切换；已停止后续操作。'); };
      working = true; binding.setLoading(true); error = null; notify();
      try {
        return await work({
          current,
          async action(action) {
            check();
            if (!client.dramaAction) throw new Error('文戏执行接口尚未就绪。');
            const state = await client.dramaAction(id, project, action);
            check(); accept(state, true); return state;
          },
          async attachScript(script) {
            check();
            if (!client.attachDramaScript) throw new Error('剧本附件接口尚未就绪。');
            const state = await client.attachDramaScript(id, project, script);
            check(); accept(state, true); return state;
          },
        });
      } finally {
        working = false;
        // The same native conversation must unlock on a project switch, but a newer
        // conversation's independent loading state must never be cleared by this task.
        if (!disposed && sessionId() === id && native?.setMessages === binding.setMessages) binding.setLoading(false);
        notify();
        queueMicrotask(restoreWhenIdle);
      }
    },
    dispose() { disposed = true; native = null; epoch += 1; listeners.clear(); },
  };
  return api;
}

export type AgentConversation = ReturnType<typeof createAgentConversation>;
declare global { interface Window { __FISHERAI_AGENT_CONVERSATION__?: AgentConversation } }
