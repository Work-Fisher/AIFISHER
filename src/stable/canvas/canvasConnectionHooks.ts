import type * as React from 'react';
import {
  installStableCanvasConnections,
  connectCanvasNodes,
  type ConnectCanvasNodesOptions,
  type CanvasConnectionNode,
  type CanvasConnectionIdentity,
} from './canvasConnections';
import type { CanvasViewport } from './canvasNavigation';

type Hooks = Pick<typeof React, 'useState' | 'useRef' | 'useCallback'>;
type Side = 'left' | 'right';
interface Node extends CanvasConnectionNode {
  x: number;
  y: number;
  kind?: string;
  comfyMode?: string;
}
interface WorkflowConnections {
  getOutputPortY?(node: Node, portIndex: number): number;
  resolveAvailableInputSlot(target: Node, source: Node, sourcePort: number): number;
  canConnect(target: Node, source: Node, targetPort: number, sourcePort: number): boolean;
  getInputSlots(node: Node): { slotIndex: number }[];
  getInputCapacity(node: Node): number;
  getConnectionLimitNotice(target: Node, source: Node, sourcePort: number): string | undefined;
}
export interface ConnectionRuntime {
  getWidth(node: Node): number;
  getHeight(node: Node): number;
  templates: { id: string; inputs: unknown[]; outputs: unknown[] }[];
  canConnect(source: Node, target: Node, nodes: Node[], targetPort?: number): string | false | null;
  getPortTop(): number;
  portHeight: number;
  portGap: number;
  workflow(): WorkflowConnections | undefined;
  minimax():
    | {
        resolvePortIndex(node: Node, relativeY: number, source?: Node): number;
        isConnectionAllowed(target: Node, source: Node, targetPort: number): boolean;
      }
    | undefined;
}
interface Point {
  x: number;
  y: number;
}
interface Start {
  nodeId: string;
  handle: Side;
  portIndex?: number;
}
interface DragState {
  isDraggingConnection: boolean;
  isPendingConnection: boolean;
  pendingBatchSourceNodeIds: string[];
  connectionStart: Start | null;
  tempConnectionEnd: Point | null;
  hoveredNodeId: string | null;
  hoveredSide: Side | null;
  hoveredPortIndex: number | null;
  isInvalidHover: boolean;
}
const empty = (): DragState => ({
  isDraggingConnection: false,
  isPendingConnection: false,
  pendingBatchSourceNodeIds: [],
  connectionStart: null,
  tempConnectionEnd: null,
  hoveredNodeId: null,
  hoveredSide: null,
  hoveredPortIndex: null,
  isInvalidHover: false,
});
type Pointer = Pick<PointerEvent, 'clientX' | 'clientY' | 'stopPropagation' | 'preventDefault'>;
type SetNodes = React.Dispatch<React.SetStateAction<Node[]>>;

/** Pointer state, compatibility and mutations belong to one connection gesture. */
export function useCanvasConnections(hooks: Hooks, runtime: ConnectionRuntime) {
  const adapter = installStableCanvasConnections();
  const [state, publish] = hooks.useState(empty);
  const current = hooks.useRef(state);
  const [selectedConnection, publishSelected] = hooks.useState<CanvasConnectionIdentity | null>(
    null,
  );
  const selected = hooks.useRef(selectedConnection);
  const setSelectedConnection = (update: React.SetStateAction<CanvasConnectionIdentity | null>) => {
    selected.current = typeof update === 'function' ? update(selected.current) : update;
    publishSelected(selected.current);
  };
  const update = (next: DragState) => {
    current.current = next;
    publish(next);
  };
  const template = (node: Node, mode = node.comfyMode) =>
    runtime.templates.find((item) => item.id === mode) ?? runtime.templates[0];
  const compatible = (
    nodes: Node[],
    source: Node,
    target: Node,
    targetPort: number,
    sourcePort: number,
  ) => {
    const workflow = runtime.workflow(),
      minimax = runtime.minimax();
    if (
      target.kind === 'workflow' &&
      (!workflow || !workflow.canConnect(target, source, targetPort, sourcePort))
    )
      return false;
    if (
      target.comfyMode === 'minimax-h3-t2va' &&
      minimax &&
      !minimax.isConnectionAllowed(target, source, targetPort)
    )
      return false;
    return runtime.canConnect(
      source.kind === 'workflow' ? { ...source, __fisherSourcePort: sourcePort } : source,
      target,
      nodes,
      targetPort,
    );
  };
  const hover = (point: Point, nodes: Node[], viewport: CanvasViewport): DragState => {
    const value = current.current,
      start = value.connectionStart;
    const next = {
      ...value,
      tempConnectionEnd: point,
      hoveredNodeId: null,
      hoveredSide: null,
      hoveredPortIndex: null,
      isInvalidHover: false,
    } as DragState;
    if (!start || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return next;
    const x = (point.x - viewport.x) / viewport.zoom,
      y = (point.y - viewport.y) / viewport.zoom;
    const node = nodes.find(
      (item) =>
        item.id !== start.nodeId &&
        x >= item.x &&
        x <= item.x + runtime.getWidth(item) &&
        y >= item.y &&
        y <= item.y + runtime.getHeight(item),
    );
    if (!node) return next;
    const side = start.handle === 'right' ? 'left' : 'right';
    let port = 0;
    const origin = nodes.find((item) => item.id === start.nodeId);
    if (node.type === 'ComfyUI') {
      const ports = side === 'left' ? template(node)?.inputs : template(node)?.outputs;
      if (node.kind === 'workflow') {
        // An input slot is chosen only when dragging into the workflow. When
        // dragging from an input, the hovered workflow supplies an output.
        if (side === 'left')
          port = origin
            ? (runtime.workflow()?.resolveAvailableInputSlot(node, origin, start.portIndex ?? 0) ??
              -1)
            : -1;
        else {
          const outputs = Array.isArray(node.outputPorts) ? node.outputPorts : [];
          port = -1;
          let closest = Infinity;
          outputs.forEach((_, index) => {
            const center =
              runtime.workflow()?.getOutputPortY?.(node, index) ??
              runtime.getPortTop() +
                runtime.portHeight / 2 +
                index * (runtime.portHeight + runtime.portGap);
            const distance = Math.abs(y - node.y - center);
            if (distance < closest) {
              closest = distance;
              port = index;
            }
          });
        }
      } else if (node.comfyMode === 'minimax-h3-t2va' && side === 'left') {
        port = runtime.minimax()?.resolvePortIndex(node, y - node.y, origin) ?? 0;
      } else if (ports && ports.length > 1) {
        port = Math.max(
          0,
          Math.min(
            ports.length - 1,
            Math.round(
              (y - node.y - runtime.getPortTop() - runtime.portHeight / 2) /
                (runtime.portHeight + runtime.portGap),
            ),
          ),
        );
      }
    }
    next.hoveredNodeId = node.id;
    next.hoveredSide = side;
    next.hoveredPortIndex = port;
    if (origin)
      next.isInvalidHover =
        port < 0 ||
        !compatible(
          nodes,
          start.handle === 'right' ? origin : node,
          start.handle === 'right' ? node : origin,
          start.handle === 'right' ? port : (start.portIndex ?? 0),
          start.handle === 'right' ? (start.portIndex ?? 0) : port,
        );
    return next;
  };
  const cancelConnectionDrag = () => update(empty());
  const resolveOperation = (
    nodes: Node[],
    intent: Pick<
      ConnectCanvasNodesOptions,
      'parentId' | 'childId' | 'portIndex' | 'sourcePortIndex'
    >,
  ): { operation?: ConnectCanvasNodesOptions; notice?: string } => {
    const source = nodes.find((node) => node.id === intent.parentId),
      target = nodes.find((node) => node.id === intent.childId);
    if (!source || !target) return {};
    const sourcePort = intent.sourcePortIndex ?? 0;
    const ports = [intent.portIndex ?? 0];
    if (target.type === 'ComfyUI') {
      const available =
        target.kind === 'workflow'
          ? (runtime
              .workflow()
              ?.getInputSlots(target)
              .map((slot) => slot.slotIndex) ?? [])
          : (template(target)?.inputs.map((_, index) => index) ?? []);
      for (const port of available) if (!ports.includes(port)) ports.push(port);
    }
    for (const port of ports) {
      const mode = compatible(nodes, source, target, port, sourcePort);
      if (!mode) continue;
      const inputCount =
        target.type === 'ComfyUI'
          ? target.kind === 'workflow'
            ? (runtime.workflow()?.getInputCapacity(target) ?? 0)
            : template(target, mode !== 'default' ? mode : target.comfyMode)?.inputs.length
          : undefined;
      const modeField =
        mode === 'default' || target.kind === 'workflow'
          ? undefined
          : ['Image', 'Upload Image'].includes(target.type)
            ? 'imageMode'
            : ['Video', 'Upload Video'].includes(target.type)
              ? 'videoMode'
              : target.type === 'ComfyUI'
                ? 'comfyMode'
                : undefined;
      return {
        operation: {
          ...intent,
          portIndex: port,
          sourcePortIndex: sourcePort,
          inputCount,
          connectionMode: mode,
          modeField,
        },
      };
    }
    return {
      notice:
        target.kind === 'workflow'
          ? runtime.workflow()?.getConnectionLimitNotice(target, source, sourcePort)
          : undefined,
    };
  };
  return {
    ...state,
    selectedConnection,
    setSelectedConnection,
    handleConnectorPointerDown(event: Pointer, nodeId: string, handle: Side, portIndex?: number) {
      event.stopPropagation();
      event.preventDefault();
      update({
        ...empty(),
        isDraggingConnection: true,
        connectionStart: { nodeId, handle, portIndex },
        tempConnectionEnd: { x: event.clientX, y: event.clientY },
      });
    },
    updateConnectionDrag(event: Pointer, nodes: Node[], viewport: CanvasViewport) {
      if (!current.current.isDraggingConnection) return false;
      update(hover({ x: event.clientX, y: event.clientY }, nodes, viewport));
      return true;
    },
    completeConnectionDrag(
      openMenu: (id: string, side: Side, x: number, y: number, ids: string[], sourcePortIndex?: number) => void,
      setNodes: SetNodes,
      nodes: Node[],
      onConnected?: (parent: string, child: string) => void,
      event?: Pick<PointerEvent, 'clientX' | 'clientY'>,
      batch?: string[],
    ) {
      const value = current.current,
        start = value.connectionStart;
      if (!value.isDraggingConnection || !start) return false;
      const x = event?.clientX ?? value.tempConnectionEnd?.x ?? 0,
        y = event?.clientY ?? value.tempConnectionEnd?.y ?? 0;
      const ids = [...new Set(batch?.length ? batch : [start.nodeId])];
      if (!value.hoveredNodeId || !value.hoveredSide) {
        update({
          ...value,
          isDraggingConnection: false,
          isPendingConnection: true,
          pendingBatchSourceNodeIds: ids,
        });
        openMenu(start.nodeId, start.handle, x, y, ids, start.portIndex ?? 0);
        return true;
      }
      const sourcePort =
        start.handle === 'right' ? (start.portIndex ?? 0) : (value.hoveredPortIndex ?? 0);
      let updated = nodes;
      const operations: ConnectCanvasNodesOptions[] = [];
      for (const id of ids) {
        if (id === value.hoveredNodeId) continue;
        const parentId = start.handle === 'right' ? id : value.hoveredNodeId;
        const childId = start.handle === 'right' ? value.hoveredNodeId : id;
        const preferred = start.handle === 'right' ? value.hoveredPortIndex : start.portIndex;
        const { operation, notice } = resolveOperation(updated, {
          parentId,
          childId,
          portIndex: preferred ?? undefined,
          sourcePortIndex: sourcePort,
        });
        if (!operation) {
          if (notice) window.alert(notice);
          continue;
        }
        const next = connectCanvasNodes(updated, operation);
        if (next !== updated) {
          updated = next;
          operations.push(operation);
          onConnected?.(parentId, childId);
        }
      }
      if (operations.length)
        setNodes((latest) =>
          operations.reduce((result, intent) => {
            const { operation } = resolveOperation(result, intent);
            return operation ? adapter.connect(result, operation) : result;
          }, latest),
        );
      cancelConnectionDrag();
      return true;
    },
    cancelConnectionDrag,
    handleEdgeClick(
      event: Pick<PointerEvent, 'stopPropagation'>,
      parentId: string,
      childId: string,
      portIndex?: number,
    ) {
      event.stopPropagation();
      setSelectedConnection({ parentId, childId, portIndex });
    },
    deleteSelectedConnection(setNodes: SetNodes) {
      const identity = selected.current;
      if (!identity) return false;
      setNodes((nodes) => adapter.disconnect(nodes, identity));
      setSelectedConnection(null);
      return true;
    },
  };
}
