import { agentVisionLabels, agentVisionHints, type AgentVision } from './agentVision';
import { CodexSkillPicker } from './CodexSkillPicker';
/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import { useEffectEvent } from 'react';
import './agentActivity.css';
import { useCanvasAgentChat } from './canvasAgentChat';
import { useAgentScroll } from './useAgentScroll';
import { useCanvasAgentReferences } from './canvasAgentReferenceState';
import type { AgentNode } from './agentClient';
import { installAgentModelAvailability } from '../generation/agentModelAvailability';
import { createSourceSettingsClient } from '../generation/sourceSettingsClient';
import { useCodexAgent } from './useCodexAgent';
import { AgentGenerationBatches } from './AgentGenerationBatches';
import { AgentProjectRequests } from './AgentProjectRequests';
import type { CanvasProjectControl } from './canvasProjectControl';
import { AgentBudgets } from './AgentBudgets';
import { AgentExternalConnection } from './AgentExternalConnection';
import { AgentProductRequests } from './AgentProductRequests';
import type { CanvasProductControl } from './canvasProductControl';
import type { CanvasExternalClient } from './canvasExternalClient';
import type { CanvasBudgetControl } from './canvasBudgetControl';
import type { CanvasCreationControl } from './canvasCreationControl';
import { AgentCanvasActions } from './AgentCanvasActions';
import type { CanvasActionHandler } from '../../shared/canvasControlProtocol.js';
import { useAgentWorkspace, type AgentWorkspace } from './agentWorkspace';
import { AgentModelMenu } from './AgentModelMenu';
import { AgentAttachmentPreview } from './AgentAttachmentPreview';
import { AgentPromptProposals } from './AgentPromptProposals';
import type { PromptProposal } from './codexClient';
import { agentPanelWidthLimits, clampAgentPanelWidth } from './agentPanelWidth';
import { agentDocumentAccept } from '../../shared/agentDocumentFormats.js';
import { agentMessageWithDocuments } from './agentDocuments';
type Runtime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'Fragment'
  | 'useState'
  | 'useEffect'
  | 'useRef'
  | 'useMemo'
  | 'useSyncExternalStore'
  | 'useLayoutEffect'
>;
interface Parameter {
  key: string;
  label: string;
  type: string;
  default?: string | number | boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number }>;
}
interface AgentModel {
  vision?: AgentVision;
  id: string;
  label: string;
  advancedParams: Parameter[];
}
interface Props {
  isOpen: boolean;
  onClose(): void;
  userName?: string;
  isDraggingNode?: boolean;
  panelWidth?: number;
  onResizeWidth?(width: number): void;
  nodes?: AgentNode[];
  selectedReferenceNodes?: Array<{ nodeId: string; url: string; type?: 'image' | 'video' | 'audio' }>;
  onLocateNode?(id: string): void;
  projectId?: string;
  selectedNodeIds?: string[];
  onApplyPrompt?(proposal: PromptProposal): string | null;
  onCreateTextNode?(text: string): string;
  onCanvasAction?: CanvasActionHandler;
  canvasCreation?: CanvasCreationControl;
  canvasProjects?: CanvasProjectControl;
  canvasBudgets?: CanvasBudgetControl;
  canvasExternal?: CanvasExternalClient;
  canvasProducts?: CanvasProductControl;
}
type Icons = Record<
  | 'Tooltip'
  | 'Message'
  | 'ImageIcon'
  | 'BackIcon'
  | 'Spinner'
  | 'HistoryIcon'
  | 'DeleteIcon'
  | 'AddIcon'
  | 'CloseIcon'
  | 'UploadIcon'
  | 'ChatIcon'
  | 'SettingsIcon'
  | 'ChevronIcon'
  | 'SendIcon',
  CanvasComponent
>;
const EMPTY_NODES: AgentNode[] = [];
const EMPTY_REFERENCES: Array<{ nodeId: string; url: string; type?: 'image' | 'video' | 'audio' }> = [];
export function CanvasAgentPanel(
  React: Runtime,
  {
    isOpen,
    onClose,
    userName = '',
    isDraggingNode = false,
    panelWidth = 400,
    onResizeWidth,
    nodes = EMPTY_NODES,
    selectedReferenceNodes = EMPTY_REFERENCES,
    onLocateNode,
    projectId,
    selectedNodeIds,
    onApplyPrompt,
    onCreateTextNode,
    onCanvasAction,
    canvasCreation,
    canvasProjects,
    canvasBudgets,
    canvasExternal,
    canvasProducts,
  }: Props,
  components: Icons,
  models: AgentModel[],
) {
  const {
    Tooltip,
    Message,
    ImageIcon,
    BackIcon,
    Spinner,
    HistoryIcon,
    DeleteIcon,
    AddIcon,
    CloseIcon,
    UploadIcon,
    ChatIcon,
    SettingsIcon,
    ChevronIcon,
    SendIcon,
  } = components;
  const [codexDraftId] = React.useState(() => `draft-${crypto.randomUUID()}`);
  const project = projectId || codexDraftId;
  const workspace = useAgentWorkspace(project);
  const flushWorkspace = workspace.flush;
  const codex = useCodexAgent(project, Boolean(project), onCanvasAction);
  const { prompt, modelId, nodeReferences, excludedNodes } = workspace.value;
  const isCodex = modelId.startsWith('codex/');
  const chat = useCanvasAgentChat(React, isOpen && workspace.ready && !isCodex, onCanvasAction ? { projectId: project, execute: onCanvasAction } : undefined);
  const setField = <K extends keyof AgentWorkspace>(
    key: K,
    next: AgentWorkspace[K] | ((current: AgentWorkspace[K]) => AgentWorkspace[K]),
  ) => {
    workspace.patch({ [key]: typeof next === 'function' ? next(workspace.value[key]) : next });
  };
  const setPrompt = (next: string) => setField('prompt', next);
  const setModelId = (next: string | ((current: string) => string)) => setField('modelId', next);
  const setNodeReferences = (next: string[] | ((current: string[]) => string[])) =>
    setField('nodeReferences', next);
  const setExcludedNodes = (next: string[] | ((current: string[]) => string[])) =>
    setField('excludedNodes', next);
  const restoring = React.useRef(false);
  const restoreWorkspace = useEffectEvent(async (alive: () => boolean) => {
    restoring.current = true;
    const saved = workspace.value;
    if (saved.modelId.startsWith('codex/')) codex.setModel(saved.modelId.slice(6));
    codex.setEffort(saved.effort);
    if (saved.apiSessionId) await chat.loadSession(saved.apiSessionId);
    if (alive() && saved.codexSessionId) await codex.load(saved.codexSessionId, false);
    if (alive()) restoring.current = false;
  });
  React.useEffect(() => {
    if (!isOpen || !workspace.ready) return;
    let alive = true;
    void restoreWorkspace(() => alive);
    return () => {
      alive = false;
      restoring.current = false;
    };
  }, [project, isOpen, workspace.ready]);
  const persistApiSession = useEffectEvent(() => {
    if (
      workspace.ready &&
      !restoring.current &&
      chat.sessionId &&
      chat.sessionId !== workspace.value.apiSessionId
    )
      workspace.patch({ apiSessionId: chat.sessionId });
  });
  React.useEffect(() => {
    persistApiSession();
  }, [workspace.ready, chat.sessionId]);
  const attachments = useCanvasAgentReferences(React, isOpen, selectedReferenceNodes, projectId);
  const { references } = attachments;
  const [showIntro, setShowIntro] = React.useState(true);
  const [dragOver, setDragOver] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [modelParams, setModelParams] = React.useState<
    Record<string, string | number | boolean | undefined>
  >({});
  const [showModelMenu, setShowModelMenu] = React.useState(false);
  const [codexGuide, setCodexGuide] = React.useState(false);
  const [showParams, setShowParams] = React.useState(false);
  const [resizing, setResizing] = React.useState(false);
  const [viewportWidth, setViewportWidth] = React.useState(() => window.innerWidth);
  const displayedWidth = clampAgentPanelWidth(panelWidth, viewportWidth);
  React.useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [, setAvailabilityVersion] = React.useState(0);
  const availability = React.useMemo(
    () => installAgentModelAvailability(createSourceSettingsClient()),
    [],
  );
  const availableModels = availability.filter(models);
  const activeModel = availableModels.find((model) => model.id === modelId);
  const selectedVision = isCodex ? 'unknown' : activeModel?.vision ?? 'unknown';
  const codexModel = codex.status?.models.find((model) => `codex/${model.id}` === modelId);
  const referencedNodes = nodes
    .filter(
      (node) =>
        nodeReferences.includes(node.id) ||
        (!excludedNodes.includes(node.id) &&
          (selectedNodeIds?.includes(node.id) || references.some((ref) => ref.nodeId === node.id))),
    );
  const isLoading = !workspace.ready || chat.isLoading || codex.busy || attachments.pending;
  const error = isCodex ? codex.error : chat.error;
  const messages = React.useMemo(
    () =>
      isCodex
        ? codex.messages.map((message, index) => ({
            ...message,
            id: `${codex.sessionId}-${index}`,
            timestamp: undefined,
            media: undefined,
            stopped: message.stopped,
          }))
        : chat.messages.map((message) => ({ ...message, edits: undefined })),
    [isCodex, codex.messages, codex.sessionId, chat.messages],
  );
  const topic = isCodex ? codex.topic : chat.topic;
  const hasMessages = messages.length > 0;
  const scroll = useAgentScroll(isCodex ? `codex/${codex.sessionId}` : chat.sessionId || '', messages, isOpen);
  const isLoadingSessions = chat.isLoadingSessions;
  const sessions = [
    ...chat.sessions.map((session) => ({
      id: String(session.id || ''),
      topic: String(session.topic || '新对话'),
      messageCount: Number(session.messageCount || 0),
      createdAt: String(session.createdAt || ''),
      updatedAt: String(session.updatedAt || ''),
    })),
    ...codex.sessions.map((session) => ({
      id: `codex/${session.id}`,
      topic: session.topic || '新对话',
      messageCount: 0,
      createdAt: '',
      updatedAt: '',
    })),
  ];
  const composerRef = React.useRef<HTMLTextAreaElement>(null),
    modelMenuRef = React.useRef<HTMLDivElement>(null),
    paramsRef = React.useRef<HTMLDivElement>(null),
    fileRef = React.useRef<HTMLInputElement>(null);
  const resizeStartX = React.useRef(0),
    resizeStartWidth = React.useRef(panelWidth),
    sending = React.useRef(false),
    epoch = React.useRef(0);
  const syncAvailability = useEffectEvent(() => {
    setAvailabilityVersion((version) => version + 1);
    setModelId((current) =>
      current.startsWith('codex/') ||
      availability.filter(models).some((model) => model.id === current)
        ? current
        : availability.filter(models)[0]?.id || '',
    );
  });
  React.useEffect(() => {
    if (!workspace.ready) return;
    const sync = () => syncAvailability();
    const unsubscribe = availability.subscribe(sync);
    sync();
    void availability.refresh().catch(() => {});
    return unsubscribe;
  }, [availability, models, workspace.ready]);
  React.useEffect(() => {
    const defaults: Record<string, string | number | boolean | undefined> = {};
    for (const param of activeModel?.advancedParams ?? []) defaults[param.key] = param.default;
    setModelParams(defaults);
    setShowParams(false);
  }, [activeModel]);
  React.useEffect(() => {
    if (!showModelMenu && !showParams) return;
    const outside = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) setShowModelMenu(false);
      if (!paramsRef.current?.contains(event.target as Node)) setShowParams(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowModelMenu(false);
        setShowParams(false);
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [showModelMenu, showParams]);
  React.useEffect(() => {
    const invalidate = () => {
      epoch.current++;
      sending.current = false;
    };
    if (!isOpen) {
      invalidate();
      setResizing(false);
      void flushWorkspace();
    }
    return invalidate;
  }, [isOpen, flushWorkspace]);
  React.useEffect(() => {
    if (!resizing || !isOpen) return;
    const cursor = document.body.style.cursor,
      userSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (event: MouseEvent) =>
      onResizeWidth?.(
        clampAgentPanelWidth(resizeStartWidth.current + resizeStartX.current - event.clientX, window.innerWidth),
      );
    const stop = () => setResizing(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      if (document.body.style.cursor === 'col-resize') document.body.style.cursor = cursor;
      if (document.body.style.userSelect === 'none') document.body.style.userSelect = userSelect;
    };
  }, [resizing, isOpen, onResizeWidth]);
  const onDragEnter = (event: ReactTypes.DragEvent) => {
    event.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = (event: ReactTypes.DragEvent) => {
    event.preventDefault();
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    )
      setDragOver(false);
  };
  const onDragOver = (event: ReactTypes.DragEvent) => event.preventDefault();
  const onDrop = (event: ReactTypes.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (isLoading) return;
    try {
      const value = JSON.parse(event.dataTransfer.getData('application/json'));
      if (
        ['image', 'video', 'audio'].includes(value?.type) &&
        typeof value.url === 'string' &&
        typeof value.nodeId === 'string'
      )
        if (isCodex) {
          setNodeReferences((current) => [...new Set([...current, value.nodeId])]);
          setExcludedNodes((current) => current.filter((id) => id !== value.nodeId));
        } else attachments.add({ type: value.type, url: value.url, nodeId: value.nodeId });
    } catch {
      /* Unrelated browser drags do not contain a canvas reference. */
    }
  };
  const removeReference = attachments.remove;
  const chooseFile = () => {
    if (!isLoading) fileRef.current?.click();
  };
  const onFileChange = (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!isLoading) void attachments.readFiles(files);
  };
  const submit = async () => {
    if (
      sending.current ||
      isLoading ||
      !modelId ||
      (!prompt.trim() && !attachments.documents.length && (isCodex || !references.length))
    )
      return;
    if (isCodex && (!codex.status?.connected || !codexModel)) return;
    sending.current = true;
    const owner = epoch.current;
    try {
      if (isCodex) {
        workspace.patch({ codexSessionId: codex.sessionId });
        if (!(await workspace.flush()) || owner !== epoch.current) return;
        const message = agentMessageWithDocuments(prompt, attachments.documents);
        setPrompt('');
        attachments.clear();
        scroll.followLatest();
        setShowIntro(false);
        if (composerRef.current) composerRef.current.style.height = 'auto';
        await codex.send(message, referencedNodes);
        return;
      }
      if (!(await workspace.flush()) || owner !== epoch.current) return;
      const media = await attachments.prepare();
      if (!media || owner !== epoch.current) return;
      const message = agentMessageWithDocuments(prompt, attachments.documents);
      setPrompt('');
      scroll.followLatest();
      attachments.clear();
      setShowIntro(false);
      if (composerRef.current) composerRef.current.style.height = 'auto';
      // The model only needs the nodes explicitly referenced by the user (or
      // currently selected). Sending the complete canvas here made an upload
      // of a single image carry every node's prompt and metadata into the
      // request, which could trip the context guard before the model ran.
      await chat.sendMessage(message, media, modelId, modelParams, referencedNodes);
    } finally {
      if (owner === epoch.current) sending.current = false;
    }
  };
  const newChat = () => {
    epoch.current++;
    sending.current = false;
    if (isCodex) workspace.patch({ codexSessionId: codex.newChat() });
    else chat.startNewChat();
    setNodeReferences([]);
    setExcludedNodes(nodes.map((node) => node.id));
    attachments.clear();
    setPrompt('');
    setShowIntro(true);
    setShowHistory(false);
  };
  const openHistory = async (id: string) => {
    epoch.current++;
    sending.current = false;
    const owner = epoch.current;
    attachments.cancel();
    if (id.startsWith('codex/')) {
      const loaded = await codex.load(id.slice(6));
      if (owner !== epoch.current) return;
      if (loaded) {
        workspace.patch({
          modelId: `codex/${loaded.model || codex.model}`,
          codexSessionId: loaded.id,
          effort: loaded.effort || '',
        });
      }
    } else {
      await chat.loadSession(id);
      if (owner !== epoch.current) return;
      if (isCodex) setModelId(availableModels[0]?.id || '');
    }
    if (owner !== epoch.current) return;
    setShowHistory(false);
    setShowIntro(false);
  };
  const removeHistory = (event: ReactTypes.MouseEvent, id: string) => {
    event.stopPropagation();
    epoch.current++;
    sending.current = false;
    attachments.cancel();
    void chat.deleteSession(id).then((deleted) => {
      if (deleted && workspace.value.apiSessionId === id) workspace.patch({ apiSessionId: '' });
    });
  };
  const formatHistoryDate = (input: string) => {
    const date = new Date(input);
    if (!Number.isFinite(date.getTime())) return '';
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    return days === 0
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : days === 1
        ? '昨天'
        : days < 7
          ? `${days} 天前`
          : date.toLocaleDateString();
  };
  if (!isOpen) return null;
  const dropHighlight = isDraggingNode || dragOver;

  return (
    <div
      data-fisherai-agent-panel={'true'}
      data-fisherai-agent-backend={isCodex ? 'codex' : 'api'}
      className={`fixed top-0 right-0 h-full border-l flex flex-col z-40 ${resizing ? '' : 'transition-all duration-300'} ${dropHighlight ? 'border-[var(--af-info)] border-2' : 'border-[var(--af-border-control)]'} rounded-lg`}
      style={{
        width: `${displayedWidth}px`,
        containerType: 'inline-size',
        background: 'var(--af-surface)',
        boxShadow: 'var(--af-shadow)',
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="调整 AIFISHER Agent 面板宽度"
        aria-orientation="vertical"
        aria-valuemin={agentPanelWidthLimits(viewportWidth).min}
        aria-valuemax={agentPanelWidthLimits(viewportWidth).max}
        aria-valuenow={displayedWidth}
        className={
          'absolute left-0 top-0 h-full w-1 -translate-x-1/2 cursor-col-resize bg-transparent hover:bg-cyan-500/40'
        }
        onMouseDown={(me) => {
          me.preventDefault();
          resizeStartX.current = me.clientX;
          resizeStartWidth.current = displayedWidth;
          setResizing(true);
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const limits = agentPanelWidthLimits(viewportWidth);
          const next = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max
            : displayedWidth + (event.key === 'ArrowLeft' ? 40 : -40);
          onResizeWidth?.(clampAgentPanelWidth(next, viewportWidth));
        }}
        title={'拖拽调整 AIFISHER Agent 面板宽度'}
      />
      {dropHighlight && (
        <div
          className={
            'absolute inset-0 bg-cyan-500/10 pointer-events-none z-10 flex items-center justify-center'
          }
        >
          <div
            className={
              'bg-cyan-500/20 border-2 border-dashed border-cyan-400 rounded-lg px-8 py-6 text-center'
            }
          >
            <ImageIcon className={'w-10 h-10 mx-auto mb-2 text-cyan-400'} />
            <p className={'text-cyan-300 font-medium'}>
              {isCodex ? '引用节点提示词' : '仅支持图片参考'}
            </p>
          </div>
        </div>
      )}
      {showHistory && (
        <div data-fisherai-agent-history="true" className={'absolute inset-0 z-30 flex min-h-0 flex-col bg-[#1a1a1a] text-[var(--af-text)]'}>
          <div className={'flex shrink-0 items-center gap-3 px-4 py-3 border-b border-[var(--af-border-control)]'}>
            <button
              type="button"
              aria-label={'返回当前对话'}
              onClick={() => setShowHistory(!1)}
              className={
                'p-1.5 rounded-lg transition-colors hover:bg-[var(--af-surface)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)]'
              }
            >
              <BackIcon size={18} />
            </button>
            <span className={'font-medium text-sm text-[var(--af-text)]'}>{'对话历史'}</span>
          </div>
          <div className={'min-h-0 flex-1 overflow-y-auto p-4'}>
            {isLoadingSessions ? (
              <div className={'flex items-center justify-center py-8'}>
                <Spinner className={'w-6 h-6 text-cyan-400 animate-spin'} />
              </div>
            ) : sessions.length === 0 ? (
              <div className={'text-center py-8'}>
                <ChatIcon className={'w-12 h-12 mx-auto mb-3 text-[var(--af-text-muted)]'} />
                <p className={'text-[var(--af-text-muted)] text-sm'}>{'暂无对话历史'}</p>
                <p className={'text-[var(--af-text-muted)] text-xs mt-1'}>
                  {'开始一段对话，它们会出现在这里'}
                </p>
              </div>
            ) : (
              <div className={'space-y-2'}>
                {sessions.map((me) => (
                  <div
                    onClick={() => openHistory(me.id)}
                    role={'button'}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        void openHistory(me.id);
                      }
                    }}
                    className={
                      'w-full text-left p-3 rounded-xl transition-colors group cursor-pointer bg-[var(--af-surface)]/50 hover:bg-[var(--af-surface)]'
                    }
                    key={me.id}
                  >
                    <div className={'flex items-start justify-between gap-2'}>
                      <div className={'flex-1 min-w-0'}>
                        <p className={'text-sm font-medium truncate text-[var(--af-text)]'} title={me.topic || '新对话'}>{me.topic?.trim() || '新对话'}</p>
                        <p className={'text-xs mt-1 text-[var(--af-text-muted)]'}>
                          {me.id.startsWith('codex/')
                            ? 'Codex'
                            : `${me.messageCount} 条消息 · ${formatHistoryDate(me.updatedAt || me.createdAt)}`}
                        </p>
                      </div>
                      {!me.id.startsWith('codex/') && (
                        <Tooltip text={'删除对话'} position={'left'}>
                          <button
                            type="button"
                            aria-label="删除对话"
                            onClick={(Je) => removeHistory(Je, me.id)}
                            className={
                              'p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg transition-all text-[var(--af-text-muted)] hover:text-red-400'
                            }
                          >
                            <DeleteIcon size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={'shrink-0 p-4 border-t border-[var(--af-border-control)]'}>
            <button
              type="button"
              onClick={newChat}
              className={
                'w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 rounded-xl text-[var(--af-text)] font-medium text-sm transition-colors flex items-center justify-center gap-2'
              }
            >
              <AddIcon size={16} />
              {'开启新对话'}
            </button>
          </div>
        </div>
      )}
      <div className={'relative z-20 flex shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-[var(--af-border-control)]'}>
        <div data-fisherai-agent-header={'true'} className={'flex items-center gap-3 min-w-0'}>
          <img
            src={'/aifisher-mark-white.svg'}
            alt={''}
            className={'w-5 h-6 object-contain shrink-0'}
          />
          <div className={'min-w-0'}>
            <span className={'block font-semibold text-sm truncate max-w-[180px] text-[var(--af-text)]'}>
              {topic || (hasMessages ? '新对话' : 'AIFISHER Agent')}
            </span>
            {!topic && !hasMessages && (
              <span
                className={'block text-[9px] uppercase text-[var(--af-text-muted)] mt-0.5'}
                style={{ letterSpacing: '.18em' }}
              >
                {'画布智能体'}
              </span>
            )}
          </div>
        </div>
        <div className={'flex shrink-0 items-center gap-1'}>
          <details className="relative text-xs text-[var(--af-text-secondary)]" onKeyDown={event => {
            if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
          }}>
            <summary className="cursor-pointer list-none rounded-lg border border-[var(--af-border-control)] px-3 py-1.5 hover:bg-[var(--af-surface)]">Codex</summary>
            <div className="absolute right-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-32px))] max-h-[65vh] overflow-y-auto rounded-xl border border-[var(--af-border-control)] bg-[var(--af-input)] p-2 shadow-xl">
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--af-surface)]" onClick={event => {
                const menu = event.currentTarget.closest('details');
                if (menu) menu.open = false;
                setCodexGuide(true); setShowModelMenu(true); setShowParams(false);
              }}>在画布中使用 Codex</button>
              {canvasExternal && <AgentExternalConnection controller={canvasExternal} />}
            </div>
          </details>
          {hasMessages && (
            <Tooltip text={'开启新对话'} position="bottom">
              <button
                type="button"
                aria-label={'开启新对话'}
                onClick={newChat}
                className={
                  'p-1.5 rounded-lg transition-colors hover:bg-[var(--af-surface)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)]'
                }
              >
                <AddIcon size={18} />
              </button>
            </Tooltip>
          )}
          {
            <Tooltip text={'对话历史'} position="bottom">
              <button
                type="button"
                aria-label={'对话历史'}
                disabled={codex.busy}
                onClick={() => setShowHistory(!0)}
                className={
                  'p-1.5 rounded-lg transition-colors hover:bg-[var(--af-surface)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)]'
                }
              >
                <HistoryIcon size={18} />
              </button>
            </Tooltip>
          }
          <button
            type="button"
            aria-label={'关闭 AIFISHER Agent'}
            onClick={onClose}
            className={
              'p-1.5 rounded-lg transition-colors hover:bg-[var(--af-surface)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)]'
            }
          >
            <CloseIcon size={18} />
          </button>
        </div>
      </div>
      <div ref={scroll.viewportRef} data-fisherai-agent-scroll="true" className={`flex-1 min-h-0 overflow-y-auto p-6 ${!hasMessages && !isCodex ? 'flex flex-col' : ''}`}>
        <div ref={scroll.contentRef} className={!hasMessages && !isCodex ? 'flex-1 flex flex-col' : ''}>
        {canvasCreation && <AgentGenerationBatches controller={canvasCreation} sessionId={isCodex ? codex.sessionId : chat.sessionId || ''} />}
        {canvasProjects && <AgentProjectRequests controller={canvasProjects} sessionId={isCodex ? codex.sessionId : chat.sessionId || ''} />}
        {canvasBudgets && <AgentBudgets controller={canvasBudgets} sessionId={isCodex ? codex.sessionId : chat.sessionId || ''} />}
        {canvasProducts && <AgentProductRequests controller={canvasProducts} sessionId={isCodex ? codex.sessionId : chat.sessionId || ''} />}
        {hasMessages ? (
          <div className={'space-y-1'}>
            {messages.map((me) => (
              <React.Fragment key={me.id}>
                <Message
                  role={me.role}
                  content={me.content}
                  media={me.media}
                  timestamp={me.timestamp}
                  stopped={me.stopped}
                  onLocateNode={onLocateNode}
                  onCreateTextNode={onCreateTextNode}
                  actionsDisabled={isLoading}
                />
                {me.actions?.length ? (
                  <AgentCanvasActions actions={me.actions} projectId={project} sessionId={isCodex ? codex.sessionId : chat.sessionId || ''} execute={onCanvasAction} disabled={isLoading} />
                ) : null}
                {me.edits?.length ? (
                  <AgentPromptProposals
                    edits={me.edits}
                    disabled={isLoading}
                    onLocateNode={onLocateNode}
                    onApplyPrompt={onApplyPrompt}
                  />
                ) : null}
              </React.Fragment>
            ))}
            {isLoading && (
              <div className="af-agent-activity" role="status" aria-live="polite">
                <span className="af-agent-activity-grid" aria-hidden="true">
                  {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 90}ms` }} />)}
                </span>
                <span>{messages.at(-1)?.content ? '正在回复…' : '正在准备回复…'}</span>
              </div>
            )}
          </div>
        ) : (
          <div className={isCodex ? '' : 'w-full mx-auto'} style={isCodex ? undefined : { maxWidth: 760 }}>
            <div data-fisherai-agent-intro={'true'} className={'mb-6'}>
              <div
                className={'text-[10px] font-semibold uppercase text-[var(--af-text-muted)] mb-3'}
                style={{ letterSpacing: '.22em' }}
              >
                {'AIFISHER AGENT · CANVAS INTELLIGENCE'}
              </div>
              <p className={'text-[var(--af-text-secondary)] text-sm mb-2 break-words'}>{userName.trim() ? `你好，${userName.trim()}` : '你好'}</p>
              <h1 className={'text-2xl font-bold mb-2 text-[var(--af-text)]'}>{'今天一起创作点什么？'}</h1>
            </div>
            {!isCodex && <div data-fisherai-agent-welcome-skills-slot="true" />}
            {isCodex && showIntro && (
              <div className={'rounded-2xl p-4 mb-4 bg-[var(--af-surface)]/50'}>
                <div
                  className={
                    'relative rounded-xl overflow-hidden mb-4 flex items-center justify-center bg-[var(--af-input)] border border-[var(--af-border-control)]'
                  }
                >
                  <img
                    src={'/community-placeholder.svg'}
                    alt={'AIFISHER Agent 在画布节点间组织创作素材'}
                    className={'w-full h-auto object-cover'}
                  />
                  <div
                    className={
                      'absolute left-3 bottom-3 flex items-center gap-2 rounded-lg px-3 py-2'
                    }
                    style={{
                      background: 'rgba(5,5,5,.82)',
                      border: '1px solid rgba(242,242,242,.16)',
                    }}
                  >
                    <img
                      src={'/aifisher-mark-white.svg'}
                      alt={''}
                      className={'w-4 h-5 object-contain'}
                    />
                    <span
                      className={'text-[10px] font-semibold text-[var(--af-text)]'}
                      style={{ letterSpacing: '.14em' }}
                    >
                      {'AIFISHER Agent'}
                    </span>
                  </div>
                </div>
                <p className={'text-sm leading-relaxed mb-3 text-[var(--af-text-secondary)]'}>
                  {isCodex
                    ? '选中的节点会加入提示词参考。可以讨论创作思路，也可以检查并应用修改建议。当前 Codex 连接只读取节点文字。'
                    : '依次点击画布图片即可累加参考，也可从本机上传图片。AIFISHER Agent 当前只读取图片参考与完成本次请求所需的画布信息。'}
                </p>
                <div className={'flex justify-end'}>
                  <button
                    type="button"
                    onClick={() => setShowIntro(!1)}
                    className={
                      'px-4 py-1.5 rounded-lg text-sm transition-colors bg-[var(--af-hover)] hover:bg-[var(--af-hover)] text-[var(--af-text)]'
                    }
                  >
                    {'开始使用'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!isCodex && <div data-fisherai-agent-conversation-content="true" />}
        </div>
      </div>
      {scroll.showLatest && <button type="button" onClick={scroll.followLatest}
        className="self-center px-3 py-1 mb-2 rounded-full bg-[var(--af-surface)] text-[var(--af-text-secondary)] text-xs">↓ 回到最新消息</button>}
      <div className={'p-3 border-t border-[var(--af-border-control)] shrink-0'}>
        {!isCodex && <div data-fisherai-agent-skills-slot="true" />}
        {isCodex && (
          <CodexSkillPicker value={codex.skillSlug} onChange={codex.setSkillSlug} disabled={isLoading} />
        )}
        {workspace.error && (
          <p role="alert" className="text-xs text-[var(--af-warning)] mb-2">
            {workspace.error}
            <button className="ml-2 underline" onClick={() => void workspace.retry()}>
              重试保存与恢复
            </button>
          </p>
        )}
        {!workspace.ready && !workspace.error && (
          <p role="status" className="text-xs text-[var(--af-text-muted)] mb-2">
            正在恢复助手草稿…
          </p>
        )}
        {error && (
          <div role="alert" className="text-xs text-[var(--af-warning)] mb-2 leading-5">
            {error}
            {isCodex && hasMessages && (
              <button
                className="ml-2 underline"
                disabled={isLoading}
                onClick={() => void codex.load(codex.sessionId)}
              >
                核对回答
              </button>
            )}
          </div>
        )}
        {!isCodex && attachments.error && (
          <p role="alert" className="text-sm text-red-400 mb-2">
            {attachments.error}
          </p>
        )}
        {modelId && selectedVision !== 'supported' && <p role="note" aria-live="polite" data-fisherai-agent-vision={selectedVision} className="mb-2 text-xs leading-relaxed text-[var(--af-text-secondary)]">{agentVisionHints[selectedVision]}</p>}
        <div className={'rounded-2xl p-3 bg-[var(--af-surface)]'}>
          {isCodex && referencedNodes.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {referencedNodes.map((node) => (
                <span
                  key={node.id}
                  className="flex items-center gap-1 rounded-lg bg-[var(--af-hover)] px-2 py-1 text-xs text-[var(--af-text)]"
                >
                  <button onClick={() => onLocateNode?.(node.id)}>{node.title || node.type}</button>
                  <button
                    aria-label={`移除引用 ${node.title || node.id}`}
                    disabled={isLoading}
                    onClick={() => {
                      setNodeReferences((current) => current.filter((id) => id !== node.id));
                      setExcludedNodes((current) => [...new Set([...current, node.id])]);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {!isCodex && references.length > 0 && (
            <div aria-label="待发送附件" data-af-media-chrome="true" className="flex gap-1.5 mb-2 overflow-x-auto py-1" style={{ scrollbarWidth: 'thin' }}>
              {references.map((me, index) => (
                <div className="relative shrink-0 w-10 h-10 rounded-md overflow-hidden bg-[var(--af-media-bg)]" key={me.nodeId}>
                  <AgentAttachmentPreview type={me.type} url={me.url} index={index + 1} />
                  <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-[var(--af-media-overlay)] px-1 text-[8px] leading-3 text-[var(--af-media-text)]">{me.type === 'video' ? '视频' : me.type === 'audio' ? '音频' : '图'} {index + 1}</span>
                  <button
                    type="button"
                    aria-label={`移除附件 ${index + 1}`}
                    onClick={() => removeReference(me.nodeId)}
                    className={
                      'absolute top-0.5 right-0.5 w-4 h-4 bg-[var(--af-media-overlay)] hover:bg-red-500 rounded-full flex items-center justify-center text-[var(--af-media-text)] text-[10px]'
                    }
                  >
                    {'×'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachments.documents.length > 0 && <div className="flex gap-2 mb-2 overflow-x-auto">
            {attachments.documents.map(document => <span key={document.id} className="flex shrink-0 items-center gap-2 rounded-lg border border-[var(--af-border-control)] px-2 py-1 text-xs text-[var(--af-text-secondary)]">
              <span>{document.name} · {document.text.length.toLocaleString()} 字符</span>
              <button type="button" aria-label={`移除文档 ${document.name}`} disabled={isLoading} onClick={() => attachments.removeDocument(document.id)}>×</button>
            </span>)}
          </div>}
          {!isCodex && <div data-fisherai-agent-context-slot="true" />}
          <textarea
            data-fisherai-agent-composer={'true'}
            ref={composerRef}
            value={prompt}
            onChange={(me) => setPrompt(me.target.value)}
            placeholder={isCodex ? '描述目标，或引用节点讨论修改' : '描述目标，或输入 / 调用 SKILL'}
            className={
              'w-full bg-transparent text-sm outline-none mb-2 resize-none min-h-[48px] max-h-[160px] text-[var(--af-text)] placeholder:text-[var(--af-text-muted)]'
            }
            rows={2}
            style={{ scrollbarWidth: 'none' }}
            disabled={isLoading}
            onInput={(me) => {
              const Je = me.currentTarget;
              Je.style.height = 'auto';
              const de = Math.min(Je.scrollHeight, 160);
              Je.style.height = de + 'px';
              Je.style.overflowY = Je.scrollHeight > 160 ? 'auto' : 'hidden';
            }}
            onKeyDown={(me) => {
              if (
                me.key === 'Enter' &&
                !me.shiftKey &&
                !me.nativeEvent.isComposing &&
                me.keyCode !== 229
              ) {
                me.preventDefault();
                void submit();
              }
            }}
          />
          <div className={'flex items-center justify-between gap-2'}>
            <div className={'flex flex-1 items-center gap-2 min-w-0'}>
              <input
                ref={fileRef}
                type={'file'}
                accept={`image/*,video/*,audio/*,.mkv,.flac,${agentDocumentAccept}`}
                multiple={!0}
                className={'hidden'}
                onChange={onFileChange}
              />
              {isCodex ? (
                <div className="relative shrink-0 w-7 h-7" title="引用节点提示词（当前只读取文字）">
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--af-text-secondary)]">
                    <AddIcon size={16} />
                  </span>
                  <select
                    aria-label="引用画布节点"
                    value=""
                    disabled={isLoading}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full"
                    onChange={(event) => {
                      const id = event.target.value;
                      if (id) {
                        setNodeReferences((current) => [...new Set([...current, id])]);
                        setExcludedNodes((current) => current.filter((value) => value !== id));
                      }
                    }}
                  >
                    <option value="">引用节点提示词</option>
                    {nodes
                      .filter((node) => !referencedNodes.some((ref) => ref.id === node.id))
                      .map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.title || node.type}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={'上传附件（图片、音视频、Word、文本）'}
                  onClick={chooseFile}
                  className={
                    'shrink-0 p-1.5 rounded-lg transition-colors hover:bg-[var(--af-hover)] text-[var(--af-text-secondary)]'
                  }
                  title={'上传本地图片'}
                >
                  <UploadIcon size={16} />
                </button>
              )}
              <div className={'relative min-w-0 flex-1'} ref={modelMenuRef}>
                <button
                  type="button"
                  aria-label="选择模型"
                  aria-expanded={showModelMenu}
                  disabled={isLoading}
                  onClick={() => { setCodexGuide(false); setShowModelMenu(!showModelMenu); }}
                  className={
                    'flex w-full min-w-0 items-center gap-1.5 bg-[var(--af-hover)] text-[var(--af-text-secondary)] text-[10px] rounded-lg px-2 py-1 border border-[var(--af-border-control)] hover:border-[var(--af-border-control)] hover:bg-[var(--af-hover)] transition-all font-medium'
                  }
                >
                  <span className="truncate" title={isCodex ? codexModel?.label : activeModel?.label}>
                    {isCodex
                      ? codexModel?.label || 'Codex 模型不可用'
                      : activeModel?.label || '选择模型'}
                  </span>
                  <span className="shrink-0 text-[10px]" title={agentVisionHints[selectedVision]}>{agentVisionLabels[selectedVision]}</span>
                  <ChevronIcon
                    size={12}
                    className={`text-[var(--af-text-muted)] transition-transform duration-200 ${showModelMenu ? 'rotate-180' : ''}`}
                  />
                </button>
                {showModelMenu && (
                  <AgentModelMenu
                    key={codexGuide ? 'guide' : 'models'}
                    initialGuide={codexGuide}
                    hideConnectionEntry
                    models={availableModels}
                    selected={modelId}
                    status={codex.status}
                    error={codex.error}
                    connecting={codex.connecting}
                    pending={!!codex.authUrl || !!codex.status?.loginPending}
                    onSelect={(id) => {
                      setModelId(id);
                      if (id.startsWith('codex/')) codex.setModel(id.slice(6));
                      setShowModelMenu(false);
                    }}
                    onServices={() => {
                      setShowModelMenu(false);
                      availability.openConnection();
                    }}
                    onLogin={() => (codex.authUrl ? codex.openLogin() : codex.login())}
                    onSetup={codex.prepareSetup}
                    onRefresh={codex.refresh}
                    onDisconnect={codex.disconnect}
                  />
                )}
              </div>
              {isCodex && codexModel?.efforts.length ? (
                <select
                  aria-label="思考强度"
                  title="思考强度"
                  disabled={isLoading}
                  value={codex.chosenEffort}
                  onChange={(event) => {
                    codex.setEffort(event.target.value);
                    workspace.patch({ effort: event.target.value });
                  }}
                  className="bg-[var(--af-hover)] text-[var(--af-text-secondary)] text-[10px] rounded-lg px-2 py-1 border border-[var(--af-border-control)] max-w-24"
                >
                  {codexModel.efforts.map((value) => (
                    <option key={value} value={value}>
                      {(
                        {
                          minimal: '极低',
                          low: '低',
                          medium: '中',
                          high: '高',
                          xhigh: '极高',
                          max: '最高',
                        } as Record<string, string>
                      )[value] || value}
                    </option>
                  ))}
                </select>
              ) : null}
              {!isCodex && (activeModel?.advancedParams.length ?? 0) > 0 && (
                <div className={'relative shrink-0'} ref={paramsRef}>
                  <button
                    type="button"
                    onClick={() => setShowParams((me) => !me)}
                    className={`flex items-center gap-1.5 text-[10px] rounded-md px-2.5 py-1 border transition-all font-medium ${showParams ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300' : 'bg-[var(--af-hover)] border-[var(--af-border-control)] text-[var(--af-text-secondary)] hover:border-[var(--af-border-control)] hover:bg-[var(--af-hover)]'}`}
                  >
                    <SettingsIcon size={12} />
                    {'高级参数'}
                    <ChevronIcon
                      size={12}
                      className={`transition-transform duration-200 ${showParams ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {showParams && (
                    <div
                      className={
                        'absolute bottom-full right-0 mb-2 w-64 max-w-[calc(100vw-24px)] max-h-64 overflow-y-auto bg-[var(--af-surface)] border border-[var(--af-border-control)] rounded-lg shadow-2xl p-2.5 z-50 space-y-2'
                      }
                    >
                      <div
                        className={
                          'text-[9px] text-[var(--af-text-muted)] font-bold uppercase tracking-wider border-b border-[var(--af-border-control)] pb-1'
                        }
                      >
                        {'高级参数'}
                      </div>
                      {activeModel?.advancedParams.map((me) => {
                        return (
                          <div className={'space-y-1'} key={me.key}>
                            <div className={'flex items-center justify-between'}>
                              <span className={'text-[11px] text-[var(--af-text-secondary)]'}>{me.label}</span>
                              {me.type === 'slider' && (
                                <span className={'text-[10px] text-[var(--af-text-secondary)]'}>
                                  {String(modelParams[me.key] ?? me.default ?? '')}
                                  {me.unit || ''}
                                </span>
                              )}
                            </div>
                            {me.type === 'toggle' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setModelParams((de) => ({
                                    ...de,
                                    [me.key]: !(de[me.key] ?? me.default),
                                  }))
                                }
                                className={`relative w-8 h-4 rounded-full transition-colors ${(modelParams[me.key] ?? me.default) ? 'bg-blue-600' : 'bg-[var(--af-hover)]'}`}
                              >
                                <span
                                  className={`absolute top-0.5 w-3 h-3 bg-[var(--af-primary)] rounded-full transition-transform ${(modelParams[me.key] ?? me.default) ? 'left-4' : 'left-0.5'}`}
                                />
                              </button>
                            ) : me.type === 'select' ? (
                              <div className={'flex flex-wrap gap-1'}>
                                {me.options?.map((de) => (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setModelParams((He) => ({ ...He, [me.key]: de.value }))
                                    }
                                    className={`px-2 py-1 text-[10px] rounded-md ${(modelParams[me.key] ?? me.default) === de.value ? 'bg-cyan-500/20 text-cyan-300' : 'bg-[var(--af-hover)] text-[var(--af-text-secondary)]'}`}
                                    key={de.value}
                                  >
                                    {de.label}
                                  </button>
                                ))}
                              </div>
                            ) : me.type === 'slider' ? (
                              <input
                                type={'range'}
                                min={me.min}
                                max={me.max}
                                value={Number(modelParams[me.key] ?? me.default ?? 0)}
                                step={me.step ?? 'any'}
                                onChange={(de) =>
                                  setModelParams((He) => ({
                                    ...He,
                                    [me.key]: Number(de.target.value),
                                  }))
                                }
                                className={
                                  'w-full h-1 bg-[var(--af-hover)] rounded-full appearance-none cursor-pointer accent-blue-500'
                                }
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className={'flex items-center gap-2'}>
              {(isCodex ? codex.busy : chat.isStreaming) ? (
                <button
                  aria-label="停止回答"
                  onClick={() => {
                    epoch.current++;
                    sending.current = false;
                    if (isCodex) codex.stop(); else chat.stop();
                  }}
                  className="w-8 h-8 rounded-full bg-[var(--af-hover)] text-[var(--af-text)] flex items-center justify-center"
                >
                  <span className="w-3 h-3 bg-current rounded-sm" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={'发送给 AIFISHER Agent'}
                  onClick={submit}
                  disabled={
                    isLoading ||
                    (!prompt.trim() && !attachments.documents.length && (isCodex || references.length === 0)) ||
                    !modelId ||
                    (isCodex && (!codex.status?.connected || !codexModel))
                  }
                  className={`aspect-square w-8 h-8 rounded-full flex items-center justify-center transition-colors text-[var(--af-text)] ${isLoading || (!prompt.trim() && !attachments.documents.length && (isCodex || references.length === 0)) || !modelId || (isCodex && (!codex.status?.connected || !codexModel)) ? 'bg-[var(--af-hover)] cursor-not-allowed' : 'bg-cyan-500 hover:bg-cyan-400'}`}
                >
                  {isLoading ? (
                    <Spinner size={16} className={'animate-spin'} />
                  ) : (
                    <SendIcon size={16} />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
