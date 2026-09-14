import type * as React from 'react';
import {
  cloneCanvasNodes,
  hasGeneratingCanvasNodes,
  GENERATING_COPY_MESSAGE,
  insertClonedCanvasNodes,
  pointerToCanvasPoint,
  type CanvasClipboardNode,
  type CanvasClipboardViewport,
} from './canvasClipboard';

type ReactHooks = Pick<typeof React, 'useRef' | 'useCallback' | 'useEffect'>;
type SetNodes = React.Dispatch<React.SetStateAction<CanvasClipboardNode[]>>;

export interface CanvasCommandOptions {
  nodes: CanvasClipboardNode[];
  viewport: CanvasClipboardViewport;
  selectedNodeIds: string[];
  selectedConnection: unknown;
  setNodes: SetNodes;
  setSelectedNodeIds: (ids: string[]) => void;
  setContextMenu: (update: (menu: { isOpen: boolean }) => { isOpen: boolean }) => void;
  deleteNodes: (ids: string[]) => void;
  deleteSelectedConnection: (setNodes: SetNodes) => void;
  clearSelection: () => void;
  clearSelectionBox: () => void;
  undo: () => void;
  redo: () => void;
  autoAlignNodes: () => void;
  handleSaveWorkflow: () => void;
  focusOnNodes: (nodes: CanvasClipboardNode[], ids: string[]) => void;
  groupSelectedNodes: (ids: string[]) => void;
}

function snapshot(nodes: CanvasClipboardNode[]): CanvasClipboardNode[] {
  // Preserve the existing persisted-node copy format, including unknown fields.
  return JSON.parse(JSON.stringify(nodes));
}

function isTextEditor(element: Element | null): boolean {
  return !!element?.closest('input,textarea,[contenteditable]');
}

/** Own the per-canvas clipboard and keyboard lifecycle using the original React runtime. */
export function useCanvasCommands(
  hooks: ReactHooks,
  createId: () => string,
  options: CanvasCommandOptions,
) {
  const clipboard = hooks.useRef<CanvasClipboardNode[]>([]);
  const pointer = hooks.useRef<{ clientX: number; clientY: number } | undefined>(undefined);
  const {
    nodes,
    viewport,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    autoAlignNodes,
    handleSaveWorkflow,
    focusOnNodes,
    groupSelectedNodes,
  } = options;

  hooks.useEffect(() => {
    const track = (event: PointerEvent) => {
      pointer.current = { clientX: event.clientX, clientY: event.clientY };
    };
    window.addEventListener('pointermove', track, { passive: true });
    return () => {
      window.removeEventListener('pointermove', track);
      pointer.current = undefined;
      clipboard.current = [];
    };
  }, []);

  const insertCopy = hooks.useCallback(
    (source: CanvasClipboardNode[], preserveConnections: boolean) => {
      if (!source.length) return;
      const bounds = document.getElementById('canvas-background')?.getBoundingClientRect();
      const targetPoint = pointerToCanvasPoint(pointer.current, viewport, bounds);
      const adapter = window.__FISHERAI_CANVAS_CLIPBOARD__;
      const { newNodes, idMap } = (adapter?.clone ?? cloneCanvasNodes)(snapshot(source), {
        offset: preserveConnections ? 50 : 20,
        createId,
        preserveParentConnections: preserveConnections,
        targetPoint,
      });
      setNodes((current) =>
        (adapter?.insert ?? insertClonedCanvasNodes)(current, newNodes, idMap, {
          preserveChildConnections: preserveConnections,
        }),
      );
      setSelectedNodeIds(newNodes.map((node) => node.id));
    },
    [viewport, createId, setNodes, setSelectedNodeIds],
  );

  const handleCopy = hooks.useCallback(() => {
    if (selectedNodeIds.length) {
      const selected = nodes.filter((node) => selectedNodeIds.includes(node.id));
      if (hasGeneratingCanvasNodes(selected)) {
        window.alert(GENERATING_COPY_MESSAGE);
        return;
      }
      clipboard.current = snapshot(selected);
    }
  }, [nodes, selectedNodeIds]);
  const handlePaste = hooks.useCallback(() => insertCopy(clipboard.current, true), [insertCopy]);
  const hasCopiedNodes = hooks.useCallback(() => clipboard.current.length > 0, []);

  hooks.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        isTextEditor(document.activeElement) ||
        (event.target instanceof Element && isTextEditor(event.target))
      )
        return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (event.ctrlKey && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.ctrlKey && key === 's') {
        event.preventDefault();
        handleSaveWorkflow();
        return;
      }
      if (event.ctrlKey && key === 'c') {
        handleCopy();
        return;
      }
      if (event.ctrlKey && key === 'g' && !event.shiftKey) {
        event.preventDefault();
        if (selectedNodeIds.length > 1) groupSelectedNodes(selectedNodeIds);
        return;
      }
      if (key === 'l' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (selectedNodeIds.length > 1) autoAlignNodes();
        return;
      }
      if (key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        focusOnNodes(nodes, selectedNodeIds);
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        if (selectedNodeIds.length) {
          deleteNodes(selectedNodeIds);
          setContextMenu((menu) => ({ ...menu, isOpen: false }));
        } else if (selectedConnection) deleteSelectedConnection(setNodes);
      } else if (key === 'escape') {
        clearSelection();
        clearSelectionBox();
      }
      // Browser paste/media handling remains with the existing paste-event owner.
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    autoAlignNodes,
    handleSaveWorkflow,
    focusOnNodes,
    groupSelectedNodes,
    handleCopy,
  ]);

  return { handleCopy, handlePaste, hasCopiedNodes };
}
