import type * as React from 'react';
import { alignCanvasDrag } from './canvasAlignment';
export { useCanvasConnections } from './canvasConnectionHooks';
import {
  installStableCanvasEditing,
  type CanvasPositionedNode,
  type CanvasNodeFrame,
  type SelectionResizeHandle,
} from './canvasEditing';
import {
  installStableCanvasGroups,
  type CanvasGroup,
  type CanvasGroupableNode,
} from './canvasGroups';
import { installStableCanvasSelection, type ScreenMarquee } from './canvasSelection';
import {
  installStableCanvasLayout,
  type CanvasLayoutNode,
  type CanvasNodeMeasurer,
} from './canvasLayout';
import type { CanvasViewport } from './canvasNavigation';

type Hooks = Pick<typeof React, 'useState' | 'useRef' | 'useCallback' | 'useEffect'>;
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Pointer = Pick<
  PointerEvent,
  'clientX' | 'clientY' | 'movementX' | 'movementY' | 'pointerId' | 'target' | 'stopPropagation'
>;

function capture(event: Pointer) {
  if (event.target instanceof HTMLElement) event.target.setPointerCapture?.(event.pointerId);
}
function release(event: Pointer) {
  if (event.target instanceof HTMLElement && event.target.hasPointerCapture?.(event.pointerId)) {
    try {
      event.target.releasePointerCapture(event.pointerId);
    } catch {
      /* The browser may release capture before pointerup. */
    }
  }
}

/** Synchronous history transitions preserve multiple commands within one React batch. */
export function useCanvasHistory<T>(hooks: Hooks, initial: T, limit = 50) {
  const adapter = installStableCanvasEditing();
  const [history, publish] = hooks.useState(() => adapter.reset(initial, limit));
  const current = hooks.useRef(history);
  const input = hooks.useRef(initial);
  hooks.useEffect(() => {
    input.current = initial;
  });
  const transition = hooks.useCallback((next: typeof history) => {
    current.current = next;
    publish(next);
    return next.present;
  }, []);
  return {
    present: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo: hooks.useCallback(() => {
      const next = adapter.undo(current.current);
      return next === current.current ? null : transition(next);
    }, [adapter, transition]),
    redo: hooks.useCallback(() => {
      const next = adapter.redo(current.current);
      return next === current.current ? null : transition(next);
    }, [adapter, transition]),
    pushHistory: hooks.useCallback(
      (snapshot?: T) => transition(adapter.commit(current.current, snapshot ?? input.current)),
      [adapter, transition],
    ),
    reset: hooks.useCallback(
      (snapshot: T) => transition(adapter.reset(snapshot, limit)),
      [adapter, limit, transition],
    ),
  };
}

export function useCanvasTitle(hooks: Hooks, initial = 'Untitled') {
  const [canvasTitle, setCanvasTitle] = hooks.useState(initial);
  const [isEditingTitle, setIsEditingTitle] = hooks.useState(false);
  const [editingTitleValue, setEditingTitleValue] = hooks.useState(initial);
  const canvasTitleInputRef = hooks.useRef<HTMLInputElement | null>(null);
  hooks.useEffect(() => {
    if (isEditingTitle) {
      canvasTitleInputRef.current?.focus();
      canvasTitleInputRef.current?.select();
    }
  }, [isEditingTitle]);
  return {
    canvasTitle,
    setCanvasTitle,
    isEditingTitle,
    setIsEditingTitle,
    editingTitleValue,
    setEditingTitleValue,
    canvasTitleInputRef,
  };
}

export function useCanvasGroups(hooks: Hooks, createId: () => string) {
  const adapter = installStableCanvasGroups();
  const [groups, publish] = hooks.useState<CanvasGroup[]>([]);
  const current = hooks.useRef(groups);
  const setGroups = hooks.useCallback((update: React.SetStateAction<CanvasGroup[]>) => {
    current.current = typeof update === 'function' ? update(current.current) : update;
    publish(current.current);
  }, []);
  return {
    groups,
    setGroups,
    getGroups: () => current.current,
    groupNodes<T extends CanvasGroupableNode>(
      ids: string[],
      nodes: T[],
      setNodes: Setter<T[]>,
      label = 'New Group',
    ) {
      const id = createId();
      const next = adapter.group({ nodes, groups: current.current }, ids, { groupId: id, label });
      setGroups(next.groups);
      setNodes(next.nodes);
      return id;
    },
    ungroupNodes<T extends CanvasGroupableNode>(
      id: string,
      nodes: T[],
      setNodes: Setter<T[]>,
    ) {
      const next = adapter.ungroup({ nodes, groups: current.current }, id);
      setGroups(next.groups);
      setNodes(next.nodes);
    },
    cleanupInvalidGroups: hooks.useCallback(
      <T extends CanvasGroupableNode>(nodes: T[], setNodes: Setter<T[]>) => {
        // A passive effect from the previous render must not inspect newly queued
        // groups against that render's old, still ungrouped nodes.
        if (current.current !== groups) return;
        const next = adapter.cleanup({ nodes, groups });
        if (next.groups !== groups) setGroups(next.groups);
        if (next.nodes !== nodes) setNodes(next.nodes);
      },
      [adapter, groups, setGroups],
    ),
    getGroupByNodeId: (id: string) => adapter.getByNodeId(current.current, id),
    getGroupById: (id: string) => adapter.getById(current.current, id),
    getCommonGroup: (ids: string[]) => adapter.getCommon(current.current, ids),
    renameGroup: (id: string, label: string) =>
      setGroups(adapter.rename(current.current, id, label)),
  };
}

interface MarqueeNode extends CanvasPositionedNode {
  parentIds?: string[];
}
type MarqueeEvent = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'> & {
  currentTarget: HTMLElement;
};
const emptyBox = () => ({ isActive: false, startX: 0, startY: 0, endX: 0, endY: 0 });
export function useCanvasMarquee(
  hooks: Hooks,
  getWidth: (node: MarqueeNode, parent?: MarqueeNode) => number,
  getHeight: (node: MarqueeNode, parent?: MarqueeNode) => number,
) {
  const selection = installStableCanvasSelection();
  const [selectionBox, publish] = hooks.useState(emptyBox);
  const box = hooks.useRef(selectionBox);
  const anchor = hooks.useRef({ x: 0, y: 0 });
  const update = (next: typeof selectionBox) => {
    box.current = next;
    publish(next);
  };
  const selected = (nodes: MarqueeNode[], marquee: ScreenMarquee, viewport: CanvasViewport) =>
    nodes
      .filter((node) => {
        const parent = nodes.find((candidate) => candidate.id === node.parentIds?.[0]);
        return selection.intersectsMarquee(
          { x: node.x, y: node.y, width: getWidth(node, parent), height: getHeight(node, parent) },
          marquee,
          viewport,
        );
      })
      .map((node) => node.id);
  return {
    selectionBox,
    isSelecting: selectionBox.isActive,
    startSelection(event: MarqueeEvent, viewport: CanvasViewport) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      anchor.current = { x: (x - viewport.x) / viewport.zoom, y: (y - viewport.y) / viewport.zoom };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      update({ isActive: true, startX: x, startY: y, endX: x, endY: y });
    },
    updateSelection(event: MarqueeEvent, nodes: MarqueeNode[], viewport: CanvasViewport) {
      if (!box.current.isActive) return { isUpdating: false, selectedIds: [] };
      const bounds = event.currentTarget.getBoundingClientRect();
      const next = {
        isActive: true,
        startX: anchor.current.x * viewport.zoom + viewport.x,
        startY: anchor.current.y * viewport.zoom + viewport.y,
        endX: event.clientX - bounds.left,
        endY: event.clientY - bounds.top,
      };
      update(next);
      return { isUpdating: true, selectedIds: selected(nodes, next, viewport) };
    },
    endSelection(nodes: MarqueeNode[], viewport: CanvasViewport) {
      if (!box.current.isActive) return [];
      const ids = selected(
        nodes,
        {
          ...box.current,
          startX: anchor.current.x * viewport.zoom + viewport.x,
          startY: anchor.current.y * viewport.zoom + viewport.y,
        },
        viewport,
      );
      update(emptyBox());
      return ids;
    },
    clearSelectionBox: () => update(emptyBox()),
  };
}

export function useCanvasLayout<T extends CanvasLayoutNode>(
  props: { nodes: T[]; selectedNodeIds: string[]; setNodes: Setter<T[]> },
  measurer: CanvasNodeMeasurer<T>,
) {
  const adapter = installStableCanvasLayout();
  return {
    autoAlignNodes: () =>
      props.setNodes((nodes) => adapter.align(nodes, props.selectedNodeIds, measurer)),
    gridLayoutNodes: (columns: number, flowColumnsIndependently = false) =>
      props.setNodes((nodes) =>
        adapter.grid(nodes, props.selectedNodeIds, columns, {
          ...measurer,
          flowColumnsIndependently,
        }),
      ),
  };
}

export function useCanvasDrag(hooks: Hooks) {
  const adapter = installStableCanvasEditing();
  const activeNode = hooks.useRef<string | null>(null);
  const snapOffset = hooks.useRef({ x: 0, y: 0 });
  const panning = hooks.useRef(false);
  const [isDragging, setDragging] = hooks.useState(false);
  const [isPanning, setPanning] = hooks.useState(false);
  return {
    isDragging,
    isPanning,
    handleNodePointerDown(event: Pointer, id: string, onSelect?: (id: string) => void) {
      event.stopPropagation();
      activeNode.current = id;
      snapOffset.current = { x: 0, y: 0 };
      setDragging(true);
      onSelect?.(id);
      capture(event);
    },
    updateNodeDrag<T extends CanvasPositionedNode>(
      event: Pointer,
      viewport: CanvasViewport,
      setNodes: Setter<T[]>,
      selectedNodeIds: string[] = [],
      measure?: CanvasNodeMeasurer<T>,
    ) {
      const activeNodeId = activeNode.current;
      if (!activeNodeId) return false;
      if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return false;
      const previousOffset = snapOffset.current;
      setNodes((nodes) => {
        const delta = { x: event.movementX / viewport.zoom - previousOffset.x,
          y: event.movementY / viewport.zoom - previousOffset.y };
        const ids = selectedNodeIds.includes(activeNodeId) ? selectedNodeIds : [activeNodeId];
        const aligned = measure ? alignCanvasDrag(nodes, ids, measure, delta, viewport.zoom) : delta;
        snapOffset.current = { x: aligned.x - delta.x, y: aligned.y - delta.y };
        return adapter.moveNodes(nodes, {
          activeNodeId,
          selectedNodeIds,
          movementX: aligned.x * viewport.zoom,
          movementY: aligned.y * viewport.zoom,
          zoom: viewport.zoom,
        });
      });
      return true;
    },
    endNodeDrag() {
      activeNode.current = null;
      snapOffset.current = { x: 0, y: 0 };
      setDragging(false);
    },
    startPanning(event: Pointer) {
      panning.current = true;
      setPanning(true);
      capture(event);
    },
    updatePanning(event: Pointer, setViewport: Setter<CanvasViewport>) {
      if (!panning.current) return false;
      setViewport((value) => ({
        ...value,
        x: value.x + event.movementX,
        y: value.y + event.movementY,
      }));
      return true;
    },
    endPanning() {
      panning.current = false;
      setPanning(false);
    },
    releasePointerCapture: release,
  };
}

export function useCanvasResize(hooks: Hooks) {
  const adapter = installStableCanvasEditing();
  const [isResizing, setResizing] = hooks.useState(false);
  const start = hooks.useRef<
    | ({ x: number; y: number } & (
        | { kind: 'node'; id: string; width: number; height: number }
        | { kind: 'selection'; frames: CanvasNodeFrame[]; handle: SelectionResizeHandle }
      ))
    | null
  >(null);
  const frame = hooks.useRef<number | null>(null);
  const pending = hooks.useRef<(() => void) | null>(null);
  const flush = hooks.useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const work = pending.current;
    pending.current = null;
    work?.();
  }, []);
  hooks.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      pending.current = null;
    },
    [],
  );
  return {
    isResizing,
    handleResizeStart(event: Pointer, id: string, width: number, height: number) {
      flush();
      event.stopPropagation();
      start.current = { kind: 'node', id, width, height, x: event.clientX, y: event.clientY };
      setResizing(true);
      capture(event);
    },
    handleSelectionResizeStart(
      event: Pointer,
      handle: SelectionResizeHandle,
      frames: CanvasNodeFrame[],
    ) {
      event.stopPropagation();
      if (frames.length < 2) return;
      flush();
      start.current = { kind: 'selection', frames, handle, x: event.clientX, y: event.clientY };
      setResizing(true);
      capture(event);
    },
    updateNodeResize<T extends CanvasPositionedNode>(
      event: Pointer,
      viewport: CanvasViewport,
      setNodes: Setter<T[]>,
    ) {
      const origin = start.current;
      if (!origin || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return false;
      const movementX = event.clientX - origin.x,
        movementY = event.clientY - origin.y;
      pending.current = () =>
        setNodes((nodes) =>
          origin.kind === 'selection'
            ? adapter.resizeSelection(nodes, {
                frames: origin.frames,
                handle: origin.handle,
                movementX,
                movementY,
                zoom: viewport.zoom,
              })
            : adapter.resizeNode(nodes, {
                id: origin.id,
                width: origin.width + movementX / viewport.zoom,
                height: origin.height + movementY / viewport.zoom,
              }),
        );
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
      return true;
    },
    endNodeResize() {
      flush();
      start.current = null;
      setResizing(false);
    },
  };
}

interface EdgePanProps {
  isDragging: boolean;
  isDraggingConnection: boolean;
  isSelecting: boolean;
  viewport: CanvasViewport;
  setViewport: Setter<CanvasViewport>;
  setNodes: Setter<CanvasPositionedNode[]>;
  selectedNodeIds: string[];
  canvasRef?: { current: HTMLElement | null };
}
export function useCanvasEdgePan(hooks: Hooks, props: EdgePanProps) {
  const current = hooks.useRef(props);
  const pointer = hooks.useRef<{ x: number; y: number } | null>(null);
  const adapter = installStableCanvasEditing();
  hooks.useEffect(() => {
    current.current = props;
  });
  const active = props.isDragging || props.isDraggingConnection || props.isSelecting;
  hooks.useEffect(() => {
    if (!active) {
      pointer.current = null;
      return;
    }
    let frame: number;
    let previous: number | null = null;
    let disposed = false;
    const tick = (time: number) => {
      if (disposed) return;
      const p = current.current,
        point = pointer.current;
      const elapsed = previous === null ? 1000 / 60 : Math.min(50, Math.max(0, time - previous));
      previous = time;
      if (point) {
        const measured = p.canvasRef?.current?.getBoundingClientRect();
        const bounds =
          measured && measured.width > 0 && measured.height > 0
            ? measured
            : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const delta = (coordinate: number, size: number) => {
          const edge = Math.min(100, size / 2);
          if (edge <= 0) return 0;
          if (coordinate < edge) return Math.min(1, 1 - coordinate / edge) * 0.9 * elapsed;
          if (coordinate > size - edge)
            return -Math.min(1, 1 - (size - coordinate) / edge) * 0.9 * elapsed;
          return 0;
        };
        const x = delta(point.x - bounds.left, bounds.width),
          y = delta(point.y - bounds.top, bounds.height);
        if (x || y) {
          p.setViewport((value) => ({ ...value, x: value.x + x, y: value.y + y }));
          if (p.isDragging && p.selectedNodeIds.length)
            p.setNodes((nodes) =>
              adapter.moveNodes(nodes, {
                activeNodeId: p.selectedNodeIds[0],
                selectedNodeIds: p.selectedNodeIds,
                movementX: -x,
                movementY: -y,
                zoom: p.viewport.zoom,
              }),
            );
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      pointer.current = null;
    };
  }, [active, adapter]);
  return {
    updatePointerPos: hooks.useCallback((x: number, y: number) => {
      pointer.current = { x, y };
    }, []),
  };
}
