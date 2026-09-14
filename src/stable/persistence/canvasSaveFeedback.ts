import type * as React from 'react';
interface CoverNode {
  id: string;
  type?: unknown;
  resultUrl?: unknown;
  lastFrame?: unknown;
}
interface Receipt {
  id?: string;
  revision?: number;
  unchanged?: boolean;
}
interface Options {
  enabled: boolean;
  getWorkflowEpoch(): number;
  getNodes(): CoverNode[];
  getSelectedCoverId(): string | null | undefined;
  folderId?: string | null;
  userNo?: string;
  saveWorkflow(
    cover: string | undefined,
    folderId: string | null | undefined,
    options: { createBackup: boolean; savedBy: string; savedAt: number },
  ): Promise<Receipt>;
  setDirty(value: boolean): void;
  setSavedAt(value: number): void;
  setSavedBy(value: string): void;
  setSavedRevision(value: number): void;
}
export function projectCover(
  nodes: readonly CoverNode[],
  selectedId?: string | null,
): string | undefined {
  const cover = (node: CoverNode | undefined) => {
    const value =
      node?.type === 'Video' || node?.type === 'Upload Video'
        ? node.lastFrame || node.resultUrl
        : node?.type === 'Image' || node?.type === 'Upload Image'
          ? node.resultUrl
          : undefined;
    return typeof value === 'string' && value ? value : undefined;
  };
  const selected = cover(nodes.find((node) => node.id === selectedId));
  if (selected) return selected;
  for (let index = nodes.length - 1; index >= 0; index--) {
    const result = cover(nodes[index]);
    if (result) return result;
  }
}
/** Present only a receipt belonging to the current document; persistence owns its write queue. */
export function useCanvasSaveFeedback(
  hooks: Pick<typeof React, 'useRef' | 'useEffect' | 'useCallback'>,
  options: Options,
) {
  const live = hooks.useRef(options);
  live.current = options;
  const active = hooks.useRef(true);
  hooks.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return hooks.useCallback(async (request: { manual?: boolean; reportFailure?: boolean } = {}) => {
    const current = live.current,
      epoch = current.getWorkflowEpoch();
    const isCurrent = () =>
      active.current && live.current.enabled && live.current.getWorkflowEpoch() === epoch;
    try {
      if (!isCurrent()) throw Error('画布已切换，忽略旧保存操作');
      const time = Date.now(),
        by = `用户${current.userNo || '-'}`,
        nodes = current.getNodes();
      const receipt = await current.saveWorkflow(
        projectCover(nodes, current.getSelectedCoverId()),
        current.folderId,
        { createBackup: !!request.manual, savedBy: by, savedAt: time },
      );
      if (!isCurrent()) return null;
      if (receipt.unchanged !== false) live.current.setDirty(false);
      live.current.setSavedAt(time);
      live.current.setSavedBy(by);
      live.current.setSavedRevision(Number(receipt.revision || 0));
      return receipt;
    } catch (error) {
      if (request.reportFailure) throw error;
      return null;
    }
  }, []);
}
