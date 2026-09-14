export type DramaCanvasRecord = { id: string; type: string; [key: string]: unknown };
type NodeUpdater = (update: (nodes: DramaCanvasRecord[]) => DramaCanvasRecord[]) => void;

export interface DramaCanvasBridge {
  setProject(projectId: string | null): void;
  clearProject(projectId: string | null): void;
  bind(nodes: DramaCanvasRecord[], update: NodeUpdater, select: (ids: string[]) => void): () => void;
  projectId(): string | null;
  snapshot(): readonly DramaCanvasRecord[];
  subscribe(listener: () => void): () => void;
  commit(projectId: string, transform: (nodes: readonly DramaCanvasRecord[]) => DramaCanvasRecord[], options?: { select?: boolean }): Promise<DramaCanvasRecord[]>;
}

/** Only the stable canvas owns state/history. This seam never writes project files itself. */
export function createDramaCanvasBridge(): DramaCanvasBridge {
  let activeProject: string | null = null;
  let generation = 0;
  let binding: { nodes: DramaCanvasRecord[]; update: NodeUpdater; select: (ids: string[]) => void } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  return {
    setProject(projectId) {
      const next = typeof projectId === 'string' && projectId.trim() ? projectId : null;
      if (next === activeProject) return;
      activeProject = next;
      generation += 1;
      notify();
    },
    clearProject(projectId) {
      if (activeProject !== projectId) return;
      activeProject = null;
      generation += 1;
      notify();
    },
    bind(nodes, update, select) {
      const next = { nodes, update, select };
      binding = next;
      return () => { if (binding === next) binding = null; };
    },
    projectId: () => activeProject,
    snapshot: () => binding?.nodes || [],
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async commit(projectId, transform, { select = true } = {}) {
      if (!projectId || projectId !== activeProject || !binding) {
        throw new Error('当前画布已切换，请回到这份制作计划所属的项目后继续。');
      }
      const captured = binding;
      const epoch = generation;
      let addedIds: string[] = [];
      const result = await new Promise<DramaCanvasRecord[]>((resolve, reject) => {
        let timedOut = false;
        const timer = window.setTimeout(() => { timedOut = true; reject(new Error('画布未确认本次写入，请查看画布后重试。')); }, 10_000);
        captured.update((current) => {
          if (timedOut) return current;
          if (epoch !== generation || activeProject !== projectId) {
            window.clearTimeout(timer);
            reject(new Error('画布已切换，本次结果未写入其他项目。'));
            return current;
          }
          try {
            const next = transform(current);
            if (!Array.isArray(next) || new Set(next.map((node) => node.id)).size !== next.length) {
              throw new Error('画布节点标识重复，已停止写入。');
            }
            const oldIds = new Set(current.map((node) => node.id));
            addedIds = next.filter((node) => !oldIds.has(node.id)).map((node) => node.id);
            window.clearTimeout(timer);
            resolve(next);
            return next;
          } catch (error) {
            window.clearTimeout(timer);
            reject(error);
            return current;
          }
        });
      });
      if (epoch === generation && activeProject === projectId) {
        if (select && addedIds.length) captured.select(addedIds);
      }
      return result;
    },
  };
}

declare global { interface Window { __FISHERAI_DRAMA_BRIDGE__?: DramaCanvasBridge } }

export function installDramaCanvasBridge() {
  const bridge = createDramaCanvasBridge();
  window.__FISHERAI_DRAMA_BRIDGE__ = bridge;
  return bridge;
}
