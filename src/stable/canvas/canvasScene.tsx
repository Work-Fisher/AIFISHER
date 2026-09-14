import type { CanvasComponent } from '../app/canvasComponentType';
import type { AlignmentGuide } from './canvasAlignment';
import type * as ReactTypes from 'react';
import type { EdgeNode } from './canvasEdges';
import { CanvasWallpaper } from '../appearance/CanvasWallpaper';
type Runtime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'memo'
  | 'useMemo'
  | 'useEffect'
  | 'useState'
  | 'useCallback'
  | 'useRef'
  | 'useLayoutEffect'
>;
interface Group {
  id: string;
  [key: string]: unknown;
}
interface Props extends Record<string, unknown> {
  documentEpoch?: number;
  nodes: EdgeNode[];
  viewport: { x: number; y: number; zoom: number };
  selectedNodeIds: string[];
  visibleNodeIds: Set<string>;
  visibleGroups: Group[];
  nodesByGroupId: Map<string, EdgeNode[]>;
  nodeDisplayData: Map<string, { inputUrl?: string; connectedImageNodes?: unknown[] }>;
  isPanning?: boolean;
  isDragging?: boolean;
  alignmentGuides?: AlignmentGuide[];
  isResizing?: boolean;
  canvasRef: ReactTypes.RefObject<HTMLDivElement | null>;
  onPointerDown: ReactTypes.PointerEventHandler;
  onPointerMove: ReactTypes.PointerEventHandler;
  onPointerUp: ReactTypes.PointerEventHandler;
  onWheel: ReactTypes.WheelEventHandler;
  onDoubleClick: ReactTypes.MouseEventHandler;
  onContextMenu: ReactTypes.MouseEventHandler;
  onDragOver: ReactTypes.DragEventHandler;
  onDrop: ReactTypes.DragEventHandler;
  onGroup(ids: string[]): void;
  onUngroup(id: string): void;
  onGroupPointerDown(event: ReactTypes.PointerEvent, ids: string[]): void;
  getCommonGroup(ids: string[]): Group | null;
  onNodePointerDown(event: ReactTypes.PointerEvent, id: string): void;
  onNodeMouseEnter(id: string): void;
  onNodeMouseLeave(): void;
}
interface Components {
  Edges: CanvasComponent;
  Selection: CanvasComponent;
  Node: CanvasComponent;
}
const emptyConnections: unknown[] = [];
const idleZoomIndependentTypes = new Set(['Text', 'Image', 'Upload Image', 'Video', 'Upload Video']);
const forwardedCallbacks = [
  'onGenerate',
  'onAddNext',
  'onSelect',
  'onConnectorDown',
  'onExpand',
  'onDragStart',
  'onDragEnd',
  'onWriteContent',
  'onTextToVideo',
  'onTextToImage',
  'onSaveAsset',
  'onAnnotate',
  'onCrop',
  'onResizeImage',
  'onUpscaleImage',
  'onAudioTrim',
  'onOpenCompare',
  'onOpenComposite',
  'onChangeAngleGenerate',
  'onUpscaleGenerate',
  'onQwenInpaintGenerate',
  'onQwenOutpaintGenerate',
  'onQwenPoseGenerate',
  'onZImageTurboT2IGenerate',
  'onKleinT2IGenerate',
  'onKleinI2IGenerate',
  'onKleinM2IGenerate',
  'onKleinIS2IGenerate',
  'onAuxPreprocessorGenerate',
  'onKleinOutpaintGenerate',
  'onVoxCPM2CloneGenerate',
  'onVoxCPM2VoiceDesignGenerate',
  'onIndexTTS2VectorEmoCloneGenerate',
  'onIndexTTS2VectorMultiEmoCloneGenerate',
  'onIndexTTS2AudioEmoCloneGenerate',
  'onIndexTTS2AudioMultiEmoCloneGenerate',
  'onQwen3TTSGenerate',
  'onQwen3CloneGenerate',
  'onQwen3VoiceDesignGenerate',
  'onSam3InteractiveGenerate',
  'onSam3TextGenerate',
  'onSam3PointGenerate',
  'onMiniMaxH3T2VAGenerate',
  'onVideoSnapshot',
  'onVideoFirstLastSnapshot',
  'onResizeStart',
];
const nodeActionNames = [
  ...forwardedCallbacks,
  'onNodePointerDown',
  'onNodeMouseEnter',
  'onNodeMouseLeave',
  'onUpdateNode',
  'onNodeContextMenu',
  'onNodeUpload',
];

// Position updates rebuild application callbacks. Keep the card's action identities
// stable, but dispatch through the latest committed scene (never a stale closure).
function useNodeActions(React: Runtime, props: Props) {
  const committedRef = React.useRef(props);
  React.useLayoutEffect(() => {
    committedRef.current = props;
  });
  const available = nodeActionNames.filter((name) => typeof props[name] === 'function').join('|');
  return React.useMemo(
    () =>
      Object.fromEntries(
        available
          .split('|')
          .filter(Boolean)
          .map((name) => [
            name,
            (...args: unknown[]) => {
              const action = committedRef.current[name];
              if (typeof action === 'function') return action(...args);
            },
          ]),
      ),
    [available],
  );
}
function SceneNode({
  React,
  component,
  nodeProps,
  nodeId,
  down,
  enter,
  leave,
}: {
  React: Runtime;
  component: CanvasComponent;
  nodeProps: Record<string, unknown>;
  nodeId: string;
  down: Props['onNodePointerDown'];
  enter: Props['onNodeMouseEnter'];
  leave: Props['onNodeMouseLeave'];
}) {
  const onDown = React.useCallback(
    (event: ReactTypes.PointerEvent) => down(event, nodeId),
    [down, nodeId],
  );
  const onEnter = React.useCallback(() => enter(nodeId), [enter, nodeId]);
  return React.createElement(component, {
    ...nodeProps,
    onNodePointerDown: onDown,
    onMouseEnter: onEnter,
    onMouseLeave: leave,
  });
}
function sameSceneNode(a: Parameters<typeof SceneNode>[0], b: Parameters<typeof SceneNode>[0]) {
  if (a.React !== b.React || a.component !== b.component || a.nodeId !== b.nodeId ||
    a.down !== b.down || a.enter !== b.enter || a.leave !== b.leave) return false;
  const keys = Object.keys(a.nodeProps);
  return keys.length === Object.keys(b.nodeProps).length &&
    keys.every(key => Object.is(a.nodeProps[key], b.nodeProps[key]));
}

export function CanvasScene(React: Runtime, props: Props, components: Components) {
  const MemoSceneNode = React.useMemo(() => React.memo(SceneNode, sameSceneNode), [React]);
  const actions = useNodeActions(React, props);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);
  const enterNode = React.useCallback((id: string) => {
    setHoveredNodeId(id);
    actions.onNodeMouseEnter?.(id);
  }, [actions]);
  const leaveNode = React.useCallback(() => {
    setHoveredNodeId(null);
    actions.onNodeMouseLeave?.();
  }, [actions]);
  const {
    nodes,
    viewport,
    selectedNodeIds,
    visibleNodeIds,
    visibleGroups,
    nodesByGroupId,
    nodeDisplayData,
    documentEpoch,
    canvasRef,
  } = props;
  const selected = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodes = React.useMemo(
    () => nodes.filter((node) => selected.has(node.id)),
    [nodes, selected],
  );
  const visible = React.useMemo(
    () => nodes.filter((node) => visibleNodeIds.has(node.id)),
    [nodes, visibleNodeIds],
  );
  const [viewportSize, setViewportSize] = React.useState<{ width: number; height: number }>();
  React.useEffect(() => {
    const surface = canvasRef.current;
    if (!surface) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const width = surface.clientWidth,
        height = surface.clientHeight;
      setViewportSize((current) =>
        disposed || (current?.width === width && current.height === height)
          ? current
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [canvasRef, documentEpoch]);
  const selectionProps = {
    documentEpoch,
    viewport,
    onRenameGroup: props.onRenameGroup,
    onGridLayout: props.onGridLayout,
    onToggleGridSlider: props.onToggleGridSlider,
    onCreateCollage: props.onCreateCollage,
    showGridSlider: props.showGridSlider,
    gridColumns: props.gridColumns,
    isDragging: props.isDragging,
    isPanning: props.isPanning,
  };
  const callbacks = Object.fromEntries(forwardedCallbacks.map((name) => [name, actions[name]]));
  const { Edges, Selection } = components;
  return (
    <div
      key={documentEpoch}
      ref={canvasRef}
      id="canvas-background"
      className={`absolute inset-0 ${props.isPanning ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}`}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onWheel={props.onWheel}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      style={{ backgroundColor: 'var(--af-canvas)', backgroundImage: 'none' }}
    >
      <CanvasWallpaper />
      <div
        id="canvas-viewport-content"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      >
        <div data-canvas-grid-background="true" style={{ display: 'none' }} />
        <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0">
          <Edges
            nodes={nodes}
            viewport={viewport}
            viewportSize={viewportSize}
            isDraggingConnection={props.isDraggingConnection || props.isPendingConnection}
            connectionStart={props.connectionStart}
            tempConnectionEnd={props.tempConnectionEnd}
            batchConnectionSourceNodeIds={props.batchConnectionSourceNodeIds || []}
            hoveredNodeId={props.connectionHoveredNodeId}
            hoveredSide={props.connectionHoveredSide}
            hoveredPortIndex={props.connectionHoveredPortIndex}
            isInvalidHover={props.isInvalidHover}
            selectedNodeIds={selectedNodeIds}
            visibleNodeIds={visibleNodeIds}
            selectedConnection={props.selectedConnection}
            onEdgeClick={props.onEdgeClick}
            onEdgeDoubleClick={props.onEdgeDoubleClick}
          />
        </svg>
        {selectedNodeIds.length > 1 && (
          <Selection
            {...selectionProps}
            selectedNodes={selectedNodes}
            group={props.getCommonGroup(selectedNodeIds)}
            onGroup={() => props.onGroup(selectedNodeIds)}
            onUngroup={() => {
              const group = props.getCommonGroup(selectedNodeIds);
              if (group) props.onUngroup(group.id);
            }}
            onBoundingBoxPointerDown={(event: ReactTypes.PointerEvent) => {
              if (event.button !== 1) {
                event.stopPropagation();
                props.onGroupPointerDown(event, selectedNodeIds);
              }
            }}
            onSelectionResizeStart={props.onSelectionResizeStart}
            isSelected={true}
            onBatchConnectorDown={props.onSelectionBatchConnectorDown}
          />
        )}
        {visibleGroups.map((group) => {
          const members = nodesByGroupId.get(group.id) || [];
          if (!members.length || members.every((node) => selected.has(node.id))) return null;
          return (
            <Selection
              key={group.id}
              {...selectionProps}
              selectedNodes={members}
              group={group}
              onGroup={() => {}}
              onUngroup={() => props.onUngroup(group.id)}
              onBoundingBoxPointerDown={(event: ReactTypes.PointerEvent) => {
                if (event.button !== 1) {
                  event.stopPropagation();
                  props.onGroupPointerDown(
                    event,
                    members.map((node) => node.id),
                  );
                }
              }}
              isSelected={false}
            />
          );
        })}
        <div data-canvas-nodes-layer="true" className="pointer-events-auto">
          {visible.map((node) => {
            const display = nodeDisplayData.get(node.id);
            return React.createElement(MemoSceneNode, {
              key: node.id,
              React,
              component: components.Node,
              nodeId: node.id,
              down: actions.onNodePointerDown,
              enter: enterNode,
              leave: leaveNode,
              nodeProps: {
                ...callbacks,
                data: node,
                isVisible: true,
                inputUrl: display?.inputUrl,
                connectedImageNodes: display?.connectedImageNodes?.length
                  ? display.connectedImageNodes
                  : emptyConnections,
                onUpdate: actions.onUpdateNode,
                selected: selected.has(node.id),
                showControls: selectedNodeIds.length === 1 && selected.has(node.id),
                isHoveredForConnection: props.connectionHoveredNodeId === node.id,
                isInvalidHover: props.connectionHoveredNodeId === node.id && props.isInvalidHover,
                onContextMenu: actions.onNodeContextMenu,
                onUpload: actions.onNodeUpload,
                // Update visible controls locally; an inherited zoom variable invalidates
                // styles throughout every card on each animation frame.
                zoom: idleZoomIndependentTypes.has(node.type ?? '') && !selected.has(node.id) && hoveredNodeId !== node.id ? 1 : viewport.zoom,
                isDragging: Boolean(props.isDragging && selected.has(node.id)),
                isResizing: props.isResizing && selected.has(node.id),
                projectId: props.projectId,
              },
            });
          })}
        </div>
        <div
          id="canvas-portal-layer"
          className="absolute top-0 left-0 pointer-events-auto z-[1000]"
        />
        {props.isDragging && Boolean(props.alignmentGuides?.length) && (
          <svg data-canvas-alignment-guides="true" aria-hidden="true"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 1100 }}>
            {props.alignmentGuides?.map(guide => (
              <line key={guide.axis} stroke="#00b8db" strokeWidth={1} vectorEffect="non-scaling-stroke"
                x1={guide.axis === 'x' ? guide.position : guide.start}
                y1={guide.axis === 'y' ? guide.position : guide.start}
                x2={guide.axis === 'x' ? guide.position : guide.end}
                y2={guide.axis === 'y' ? guide.position : guide.end} />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
