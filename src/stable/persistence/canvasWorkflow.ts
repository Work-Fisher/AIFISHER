import {useCanvasSaveFeedback} from './canvasSaveFeedback';
import type * as React from 'react';
import { freshProjectDocument, type ProjectDocument } from './canvasProjectDocument';
import { useCanvasProjectFiles } from './canvasProjectFiles';
import { createToast } from '../design/designSystem';
import { interruptedMediaNode } from '../media/mediaOperationRecovery';
import { interruptedLocalWorkflowNode } from '../generation/canvasLocalWorkflows';
import {
  mergeWorkflow,
  sameWorkflowValue,
  WorkflowConflictError,
  type WorkflowRecord,
} from './workflowMerge';

type Hooks = Pick<typeof React, 'useState' | 'useRef' | 'useEffect' | 'useCallback'>;
export interface CanvasWorkflowProps {
  nodes: WorkflowRecord[];
  groups: WorkflowRecord[];
  viewport: { x: number; y: number; zoom: number };
  canvasTitle: string;
  isMinimapOpen: boolean;
  setNodes: (nodes: WorkflowRecord[]) => void;
  setGroups: (groups: WorkflowRecord[]) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setCanvasTitle: (title: string) => void;
  setEditingTitleValue: (title: string) => void;
  setViewport: (viewport: CanvasWorkflowProps['viewport']) => void;
  setIsMinimapOpen: (open: boolean) => void;
  onPanelOpen?: () => void;
}
interface SaveOptions {
  snapshot?: WorkflowRecord;
  createBackup?: boolean;
  savedBy?: string;
  savedAt?: number;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function content(document: WorkflowRecord) {
  return {
    title: document.title,
    nodes: document.nodes,
    groups: document.groups,
    viewport: document.viewport,
    isMinimapOpen: document.isMinimapOpen,
  };
}
function stale(): Error {
  return Object.assign(new Error('画布已切换，忽略旧保存结果。'), { code: 'STALE_WORKFLOW' });
}
function validateDocument(value: unknown, id?: string): WorkflowRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('项目数据格式无效。');
  const doc = value as WorkflowRecord;
  const revision = Number(doc.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('项目版本号无效。');
  doc.revision = revision;
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.groups) || (id && doc.id !== id))
    throw new Error('项目数据或编号不匹配。');
  for (const collection of [doc.nodes, doc.groups]) {
    const ids = new Set<string>();
    for (const item of collection) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id))
        throw new Error('项目节点或分组编号无效。');
      ids.add(item.id);
    }
  }
  if (doc.viewport !== undefined) {
    const view = doc.viewport as CanvasWorkflowProps['viewport'];
    if (!view || ![view.x, view.y, view.zoom].every(Number.isFinite) || view.zoom <= 0)
      throw new Error('项目视口无效。');
  }
  return doc;
}
async function request(url: string, init?: RequestInit): Promise<WorkflowRecord> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(typeof body.error === 'string' ? body.error : '项目保存或读取失败。'),
      {
        code: response.status === 409 ? 'REVISION_CONFLICT' : (body.code ?? response.status),
      },
    );
  return body;
}

/** Own workflow identity, network ordering, loaded baseline, and original panel behavior. */
export function useCanvasWorkflow(hooks: Hooks, props: CanvasWorkflowProps) {
  const [workflowId, setId] = hooks.useState<string | null>(null);
  const [workflowRevision, setRevision] = hooks.useState(0);
  const [isWorkflowPanelOpen, setPanel] = hooks.useState(false);
  const [workflowPanelY, setPanelY] = hooks.useState(0);
  const current = hooks.useRef(props);
  const base = hooks.useRef<WorkflowRecord | null>(null);
  const targetId = hooks.useRef<string | null>(null);
  const epoch = hooks.useRef(0);
  const loading = hooks.useRef(false);
  const queue = hooks.useRef<Promise<unknown>>(Promise.resolve());
  const notice = hooks.useRef<HTMLElement | null>(null);
  const blocked = hooks.useRef(false);
  // React publishes state asynchronously. Retain the accepted merge until its
  // input catches up, including between queued saves.
  const pendingView = hooks.useRef<{
    before: WorkflowRecord;
    displayed: WorkflowRecord;
    after: WorkflowRecord;
    replacement?: boolean;
  } | null>(null);
  hooks.useEffect(() => {
    current.current = props;
  });
  const dismiss = hooks.useCallback(() => {
    notice.current?.remove();
    notice.current = null;
  }, []);
  hooks.useEffect(
    () => () => {
      epoch.current += 1;
      dismiss();
    },
    [dismiss],
  );

  const displayedView = hooks.useCallback(() => {
    const p = current.current;
    return {
      title: p.canvasTitle,
      nodes: p.nodes,
      groups: p.groups,
      viewport: p.viewport,
      isMinimapOpen: p.isMinimapOpen,
    };
  }, []);
  const view = hooks.useCallback(() => {
    const raw = displayedView();
    const pending = pendingView.current;
    if (!pending) return raw;
    // A user may edit an accepted merge before React has committed it. Rebase the
    // committed UI changes first so that such edits are not competing branches.
    const displayed = displayedView();
    if (pending.replacement) {
      // A file opens an entirely new document. Until React commits it, the old
      // display is not an edit of that document. Once committed, the canvas
      // may normalize newly inserted nodes (e.g. empty text fields); merge those
      // against the imported graph instead of treating them as competing adds.
      if (sameWorkflowValue(displayed, pending.displayed)) return pending.after as typeof raw;
      const merged = content(mergeWorkflow(pending.after, displayed, raw));
      pendingView.current = sameWorkflowValue(raw, merged) ? null : {
        before: copy(raw), displayed: copy(displayed), after: copy(merged),
      };
      return merged as typeof raw;
    }
    const accepted = content(mergeWorkflow(pending.displayed, displayed, pending.after));
    const merged = content(mergeWorkflow(pending.before, raw, accepted));
    if (sameWorkflowValue(raw, merged)) {
      pendingView.current = null;
    } else {
      pendingView.current = { before: copy(raw), displayed: copy(displayed), after: copy(merged) };
    }
    return merged as typeof raw;
  }, [displayedView]);
  hooks.useEffect(() => {
    // Observe committed display states even when there is no save between them.
    // A genuine conflict is reported by the save operation, never from render.
    if (pendingView.current) {
      try {
        view();
      } catch {
        /* Keep both baselines for explicit conflict handling. */
      }
    }
  });
  const apply = hooks.useCallback((document: WorkflowRecord, includeViewport = true) => {
    const p = current.current;
    const title = typeof document.title === 'string' ? document.title : 'Untitled';
    p.setNodes(document.nodes as WorkflowRecord[]);
    p.setGroups(document.groups as WorkflowRecord[]);
    p.setCanvasTitle(title);
    p.setEditingTitleValue(title);
    if (includeViewport && document.viewport)
      p.setViewport(document.viewport as CanvasWorkflowProps['viewport']);
    if (includeViewport && typeof document.isMinimapOpen === 'boolean')
      p.setIsMinimapOpen(document.isMinimapOpen);
  }, []);
  const showConflict = hooks.useCallback(() => {
    if (notice.current) return;
    const element = createToast({
      message: '保存冲突：当前编辑仍保留，尚未全部保存。可下载副本后重新打开项目核对。',
      tone: 'danger',
    });
    element.dataset.fisheraiWorkflowConflict = 'true';
    Object.assign(element.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      maxWidth: '420px',
      zIndex: '10000',
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '下载当前副本';
    button.className = 'fisherai-button';
    button.style.marginTop = '10px';
    button.addEventListener('click', () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify({ ...base.current, ...displayedView() }, null, 2)], {
          type: 'application/json',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'canvas-conflict.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    element.append(document.createElement('br'), button);
    document.body.append(element);
    notice.current = element;
  }, [displayedView]);

  const handleSaveWorkflow = hooks.useCallback(
    (coverUrl?: string, folderId?: string | null, options: SaveOptions = {}) => {
      const owner = epoch.current;
      const run = async () => {
        if (owner !== epoch.current || loading.current) throw stale();
        if (blocked.current) throw new WorkflowConflictError('document');
        try {
          targetId.current ??= crypto.randomUUID();
          const original = copy(
            base.current ?? {
              id: targetId.current,
              revision: 0,
              nodes: [],
              groups: [],
              title: 'Untitled',
            },
          );
          const startView = copy(view());
          let draft = copy({
            ...original,
            ...startView,
            id: targetId.current,
            revision: Number(original.revision ?? 0),
            ...(folderId !== undefined ? { folderId } : {}),
            ...(coverUrl !== undefined ? { coverUrl } : {}),
            createBackup: !!options.createBackup,
            lastSavedBy: options.savedBy,
            lastSavedAt: options.savedAt,
          });
          const post = (document: WorkflowRecord) =>
            request('/api/workflows', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(document),
            });
          let result: WorkflowRecord;
          try {
            result = await post(draft);
          } catch (error) {
            if ((error as { code?: string }).code !== 'REVISION_CONFLICT') throw error;
            if (owner !== epoch.current) throw stale();
            const remote = validateDocument(
              await request(`/api/workflows/${encodeURIComponent(String(draft.id))}`),
              String(draft.id),
            );
            if (owner !== epoch.current) throw stale();
            draft = mergeWorkflow(original, draft, remote) as typeof draft;
            result = await post(draft);
          }
          if (owner !== epoch.current) throw stale();
          if (
            result.success === false ||
            result.id !== draft.id ||
            typeof result.revision !== 'number' ||
            !Number.isInteger(result.revision) ||
            result.revision <= Number(draft.revision)
          )
            throw new Error('保存回执无效，尚不能确认保存成功。');
          const latestView = copy(view());
          const unchanged = sameWorkflowValue(startView, latestView);
          const saved: WorkflowRecord = { ...draft, revision: result.revision };
          delete saved.createBackup;
          base.current = saved;
          setId(String(result.id));
          setRevision(Number(result.revision));
          if (!sameWorkflowValue(startView, content(draft))) {
            try {
              const rebased = unchanged
                ? saved
                : mergeWorkflow(
                    { ...original, ...startView },
                    { ...original, ...latestView },
                    saved,
                  );
              pendingView.current = {
                before: copy(displayedView()),
                displayed: copy(displayedView()),
                after: copy(content(rebased)),
              };
              apply(rebased);
            } catch {
              blocked.current = true;
              showConflict();
              return { id: result.id, revision: result.revision, unchanged: false };
            }
          }
          dismiss();
          return { id: result.id, revision: result.revision, unchanged };
        } catch (error) {
          if (
            owner === epoch.current &&
            (error as { code?: string }).code === 'REVISION_CONFLICT'
          ) {
            blocked.current = true;
            showConflict();
          }
          throw error;
        }
      };
      const operation = queue.current.then(run, run);
      queue.current = operation.catch(() => undefined);
      return operation;
    },
    [view, displayedView, apply, dismiss, showConflict],
  );

  const handleLoadWorkflow = hooks.useCallback(
    async (id: string) => {
      const owner = ++epoch.current;
      loading.current = true;
      queue.current = Promise.resolve();
      try {
        const isPublic = id.startsWith('public:');
        const rawId = isPublic ? id.slice(7) : id;
        const data = validateDocument(
          await request(
            `/api/${isPublic ? 'public-workflows' : 'workflows'}/${encodeURIComponent(rawId)}`,
          ),
          isPublic ? undefined : rawId,
        );
        if (owner !== epoch.current) return null;
        const document = copy(data);
        if (isPublic) {
          document.id = null;
          document.revision = 0;
          document.status = 'work';
          document.folderId = null;
          delete document.createdAt;
          delete document.updatedAt;
        }
        base.current = copy(document);
        document.nodes = (document.nodes as WorkflowRecord[]).map(node => interruptedLocalWorkflowNode(interruptedMediaNode(node)));
        targetId.current = isPublic ? null : rawId;
        pendingView.current = {
          before: copy(displayedView()),
          displayed: copy(displayedView()),
          after: copy(content({ ...displayedView(), ...document })),
        };
        blocked.current = false;
        dismiss();
        setId(targetId.current);
        setRevision(Number(document.revision ?? 0));
        apply(document);
        current.current.setSelectedNodeIds([]);
        setPanel(false);
        return { ...document, nodeCount: (document.nodes as unknown[]).length };
      } catch (error) {
        if (owner === epoch.current) console.error('Failed to load workflow:', error);
        return null;
      } finally {
        if (owner === epoch.current) loading.current = false;
      }
    },
    [apply, dismiss, displayedView],
  );
  const getWorkflowEpoch = hooks.useCallback(() => epoch.current, []);
  const importDocument = hooks.useCallback((input: ProjectDocument, projectId: string = crypto.randomUUID()) => {
    const document = freshProjectDocument(input, projectId);
    validateDocument(document);
    epoch.current += 1;
    loading.current = false;
    queue.current = Promise.resolve();
    base.current = copy(document);
    targetId.current = String(document.id);
    pendingView.current = {
      before: copy(displayedView()), displayed: copy(displayedView()),
      after: copy(content({ ...displayedView(), ...document })),
      replacement: true,
    };
    blocked.current = false;
    dismiss();
    setId(targetId.current);
    setRevision(0);
    apply(document);
    current.current.setSelectedNodeIds([]);
    setPanel(false);
    return document;
  }, [apply, dismiss, displayedView]);
  const resetWorkflowId = hooks.useCallback(() => {
    epoch.current += 1;
    loading.current = false;
    base.current = null;
    pendingView.current = null;
    targetId.current = null;
    queue.current = Promise.resolve();
    blocked.current = false;
    dismiss();
    setId(null);
    setRevision(0);
  }, [dismiss]);
  const handleWorkflowsClick = hooks.useCallback((event: { currentTarget: HTMLElement }) => {
    setPanelY(event.currentTarget.getBoundingClientRect().top);
    setPanel((value) => !value);
    current.current.onPanelOpen?.();
  }, []);
  const closeWorkflowPanel = hooks.useCallback(() => setPanel(false), []);
  return {
    workflowId,
    workflowRevision,
    isWorkflowPanelOpen,
    workflowPanelY,
    handleSaveWorkflow,
    handleLoadWorkflow,
    handleWorkflowsClick,
    closeWorkflowPanel,
    resetWorkflowId,
    getWorkflowEpoch,
    useSaveFeedback:(options:Parameters<typeof useCanvasSaveFeedback>[1])=>useCanvasSaveFeedback(hooks,options),
    importDocument,
    useProjectFiles: (options: Parameters<typeof useCanvasProjectFiles>[1]) => useCanvasProjectFiles(hooks, options),
  };
}
