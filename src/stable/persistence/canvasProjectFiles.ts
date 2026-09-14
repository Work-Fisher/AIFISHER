import type * as React from 'react';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { WorkflowRecord } from './workflowMerge';
import { prepareProjectMedia } from './projectMediaImport';
import {
  copyProjectGraph,
  parseProjectDocument,
  type ProjectDocument,
} from './canvasProjectDocument';

interface ProjectFileOptions {
  view: string;
  projectId?: string | null;
  getWorkflowEpoch: () => number;
  getNodes: () => CanvasNode[];
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  setGroups: React.Dispatch<React.SetStateAction<WorkflowRecord[]>>;
  setSelectedNodeIds: (ids: string[]) => void;
  importDocument: (document: ProjectDocument, projectId?: string) => ProjectDocument;
  onOpened: (document: ProjectDocument) => void;
  onChanged: () => void;
  report?: (message: string) => void;
  createId?: () => string;
}
type FileEvent = {
  target: { files: ArrayLike<Pick<File, 'name' | 'text'>> | null; value: string };
};

/** File reads share one latest intent. A later read, project load, reset, or exit
 * invalidates an older read before it can mutate either graph or document baseline. */
export function useCanvasProjectFiles(
  hooks: Pick<typeof React, 'useRef' | 'useEffect'>,
  options: ProjectFileOptions,
) {
  const live = hooks.useRef(options);
  live.current = options;
  const intent = hooks.useRef(0);
  const mounted = hooks.useRef(true);
  hooks.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      intent.current++;
    };
  }, []);
  hooks.useEffect(() => {
    intent.current++;
  }, [options.view, options.projectId]);
  const read = async (event: FileEvent, merge: boolean) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !mounted.current || (merge && live.current.view !== 'canvas')) return;
    const start = live.current,
      owner = ++intent.current,
      epoch = start.getWorkflowEpoch();
    const valid = () =>
      mounted.current &&
      intent.current === owner &&
      live.current.view === start.view &&
      live.current.projectId === start.projectId &&
      live.current.getWorkflowEpoch() === epoch;
    try {
      const text = await file.text();
      if (!valid()) return;
      const parsed = parseProjectDocument(text, file.name);
      const targetId = merge ? start.projectId : crypto.randomUUID();
      if (!targetId) throw new Error('请先打开目标项目。');
      const document = await prepareProjectMedia(parsed, targetId, valid);
      if (!valid()) return;
      const current = live.current;
      if (!merge) {
        const imported = current.importDocument(document, targetId);
        current.onOpened(imported);
      } else {
        if (!document.nodes.length) return;
        const existing = current.getNodes();
        const right = existing.length
          ? existing.reduce((x, node) => Math.max(x, node.x), -Infinity)
          : 0;
        const left = document.nodes.reduce((x, node) => Math.min(x, node.x), Infinity);
        const graph = copyProjectGraph(
          document,
          current.projectId ?? undefined,
          { x: right - left + 240, y: 80 },
          current.createId ?? (() => crypto.randomUUID()),
        );
        current.setNodes((nodes) => [...nodes, ...graph.nodes]);
        current.setGroups((groups) => [...groups, ...graph.groups]);
        current.setSelectedNodeIds(graph.nodes.map((node) => node.id));
        current.onChanged();
      }
    } catch (error) {
      if (valid())
        (live.current.report ?? ((message) => window.alert(message)))(
          `${merge ? '导入并合并' : '打开'}项目 JSON 失败：${error instanceof Error ? error.message : '请检查文件内容是否有效。'}`,
        );
    }
  };
  return {
    handleOpenProjectFile: (event: FileEvent) => read(event, false),
    handleMergeProjectFile: (event: FileEvent) => read(event, true),
  };
}
