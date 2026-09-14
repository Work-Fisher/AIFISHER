import type * as ReactTypes from 'react';
import { memo } from 'react';
import {
  edgeFlowSegments,
  edgeLength,
  edgePath,
  edgePhase,
  type Curve,
  type Point,
} from './canvasEdgeGeometry';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useMemo' | 'useEffect' | 'useId'
>;
export interface EdgeNode {
  id: string;
  type?: string;
  x: number;
  y: number;
  parentIds?: string[];
  sourcePortIndices?: number[];
  [key: string]: unknown;
}
interface Connection {
  nodeId: string;
  handle: 'left' | 'right';
  portIndex?: number;
}
interface Props {
  nodes: EdgeNode[];
  viewport: { x: number; y: number; zoom: number };
  viewportSize?: { width: number; height: number };
  isDraggingConnection?: boolean;
  connectionStart?: Connection | null;
  tempConnectionEnd?: Point | null;
  batchConnectionSourceNodeIds?: string[];
  hoveredNodeId?: string | null;
  hoveredSide?: 'left' | 'right' | null;
  hoveredPortIndex?: number | null;
  isInvalidHover?: boolean;
  selectedNodeIds: string[];
  visibleNodeIds?: Set<string>;
  selectedConnection?: { parentId: string; childId: string; portIndex: number } | null;
  onEdgeClick(
    event: ReactTypes.MouseEvent,
    parentId: string,
    childId: string,
    portIndex: number,
  ): void;
  onEdgeDoubleClick?(
    event: ReactTypes.MouseEvent,
    parentId: string,
    childId: string,
    portIndex: number,
  ): void;
}
interface Geometry {
  getWidth(node: EdgeNode): number;
  getHeight(node: EdgeNode, parent?: EdgeNode): number;
  getPortX(node: EdgeNode, side: 'left' | 'right', width: number): number;
  getPortY(node: EdgeNode, side: 'left' | 'right', index: number, height: number): number;
}
interface ResolvedEdge {
  parentId: string;
  childId: string;
  portIndex: number;
  key: string;
  curve: Curve;
}
type RenderedEdge = ResolvedEdge & { path: string; length: number; phase: number };

// Immutable endpoint records are the cache keys. Moving/resizing either endpoint,
// changing its ports, or replacing the measurer invalidates only the affected edges.
// Weak keys release old drag positions; offscreen edges never need curve sampling.
function createEdgeGeometryCache(geometry: Geometry) {
  const sizes = new WeakMap<EdgeNode, { width: number; height: number }>();
  const endpoints = new WeakMap<EdgeNode, WeakMap<EdgeNode, Map<number, ResolvedEdge>>>();
  const rendered = new WeakMap<ResolvedEdge, RenderedEdge>();
  const size = (node: EdgeNode) => {
    let value = sizes.get(node);
    if (!value) {
      value = { width: geometry.getWidth(node), height: geometry.getHeight(node) };
      sizes.set(node, value);
    }
    return value;
  };
  return {
    size,
    resolve(parent: EdgeNode, child: EdgeNode, portIndex: number) {
      let parents = endpoints.get(child);
      if (!parents) endpoints.set(child, (parents = new WeakMap()));
      let ports = parents.get(parent);
      if (!ports) parents.set(parent, (ports = new Map()));
      let edge = ports.get(portIndex);
      if (!edge) {
        const parentSize = size(parent),
          childSize = size(child);
        edge = {
          parentId: parent.id,
          childId: child.id,
          portIndex,
          key: JSON.stringify([parent.id, child.id, portIndex]),
          curve: {
            start: {
              x: geometry.getPortX(parent, 'right', parentSize.width),
              y: geometry.getPortY(
                parent,
                'right',
                child.sourcePortIndices?.[portIndex] ?? 0,
                parentSize.height,
              ),
            },
            end: {
              x: geometry.getPortX(child, 'left', childSize.width),
              y: geometry.getPortY(child, 'left', portIndex, geometry.getHeight(child, parent)),
            },
          },
        };
        ports.set(portIndex, edge);
      }
      return edge;
    },
    render(edge: ResolvedEdge) {
      let value = rendered.get(edge);
      if (!value) {
        value = {
          ...edge,
          path: edgePath(edge.curve),
          length: edgeLength(edge.curve),
          phase: edgePhase(`${edge.parentId}-${edge.childId}-${edge.portIndex}`),
        };
        rendered.set(edge, value);
      }
      return value;
    },
  };
}

const EdgeFlow = memo(function EdgeFlow({
  React,
  edge,
  edgeIndex,
  scope,
  filterId,
  over,
}: {
  React: Runtime;
  edge: RenderedEdge;
  edgeIndex: number;
  scope: string;
  filterId: string;
  over: boolean;
}) {
  const [time, setTime] = React.useState(0);
  React.useEffect(() => {
    let frame: number | null = null;
    let disposed = false;
    const tick = (now: number) => {
      frame = null;
      if (disposed || document.hidden) return;
      setTime(now);
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      if (disposed) return;
      if (document.hidden) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      } else if (frame === null) frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const segments = Array.from({ length: 3 }, (_, index) =>
    edgeFlowSegments(
      edge.curve,
      time / 1000 / 2.5 + edge.phase + index / 3,
      Math.min(0.16, Math.min(800, Math.max(32, edge.length * 0.5)) / Math.max(edge.length, 1)),
    ),
  ).flat();
  return (
    <g
      data-fisherai-edge-flow-tone={over ? 'danger' : 'primary'}
      className="edge-flow-segments pointer-events-none"
    >
      {segments.map((segment, index) => {
        const prefix = `${scope}-${edgeIndex}-${index}`,
          outer = `edge-flow-grad-outer-${prefix}`,
          inner = `edge-flow-grad-inner-${prefix}`;
        return (
          <g key={index}>
            <defs>
              <linearGradient
                id={outer}
                x1={segment.tail.x}
                y1={segment.tail.y}
                x2={segment.head.x}
                y2={segment.head.y}
                gradientUnits="userSpaceOnUse"
              >
                <stop
                  offset="0%"
                  stopColor={over ? 'rgba(255, 77, 90, 0)' : 'rgba(59, 130, 246, 0)'}
                />
                <stop
                  offset="62%"
                  stopColor={over ? 'rgba(255, 77, 90, 0.18)' : 'rgba(59, 130, 246, 0.16)'}
                />
                <stop
                  offset="100%"
                  stopColor={over ? 'rgba(255, 77, 90, 0.98)' : 'rgba(59, 130, 246, 0.98)'}
                />
              </linearGradient>
              <linearGradient
                id={inner}
                x1={segment.tail.x}
                y1={segment.tail.y}
                x2={segment.head.x}
                y2={segment.head.y}
                gradientUnits="userSpaceOnUse"
              >
                <stop
                  offset="0%"
                  stopColor={over ? 'rgba(255, 196, 201, 0)' : 'rgba(147, 197, 253, 0)'}
                />
                <stop
                  offset="72%"
                  stopColor={over ? 'rgba(255, 122, 132, 0.38)' : 'rgba(96, 165, 250, 0.34)'}
                />
                <stop
                  offset="100%"
                  stopColor={over ? 'rgba(255, 224, 227, 1)' : 'rgba(191, 219, 254, 1)'}
                />
              </linearGradient>
            </defs>
            <path
              d={segment.path}
              stroke={`url(#${outer})`}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={over ? undefined : `url(#${filterId})`}
              opacity="0.96"
            />
            <path
              d={segment.path}
              stroke={`url(#${inner})`}
              strokeWidth={1}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={over ? undefined : `url(#${filterId})`}
            />
          </g>
        );
      })}
    </g>
  );
});

export function CanvasEdges(React: Runtime, props: Props, geometry: Geometry) {
  const { getWidth, getHeight, getPortX, getPortY } = geometry;
  const [hovered, setHovered] = React.useState<string | null>(null);
  const scope = React.useId().replace(/:/g, ''),
    filterId = `edge-flow-${scope}`;
  const { nodes, viewport, selectedConnection, selectedNodeIds } = props;
  const selected = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const byId = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const geometryCache = React.useMemo(
    () => createEdgeGeometryCache({ getWidth, getHeight, getPortX, getPortY }),
    [getWidth, getHeight, getPortX, getPortY],
  );
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const width = props.viewportSize?.width ?? window.innerWidth,
    height = props.viewportSize?.height ?? window.innerHeight;
  const edges = React.useMemo(() => {
    const bounds = {
      left: -viewport.x / zoom - 800,
      top: -viewport.y / zoom - 800,
      right: (width - viewport.x) / zoom + 800,
      bottom: (height - viewport.y) / zoom + 800,
    };
    return nodes.flatMap((child) =>
      (child.parentIds || []).flatMap((parentId, portIndex) => {
        const parent = parentId ? byId.get(parentId) : undefined;
        if (!parent) return [];
        const edge = geometryCache.resolve(parent, child, portIndex),
          { curve } = edge;
        // A long edge can cross the viewport while both endpoint cards are outside it.
        const horizontal = Math.abs(curve.end.x - curve.start.x) / 2;
        if (
          Math.max(curve.start.x + horizontal, curve.end.x) < bounds.left ||
          Math.min(curve.start.x, curve.end.x - horizontal) > bounds.right ||
          Math.max(curve.start.y, curve.end.y) < bounds.top ||
          Math.min(curve.start.y, curve.end.y) > bounds.bottom
        )
          return [];
        return [geometryCache.render(edge)];
      }),
    );
  }, [nodes, byId, geometryCache, viewport.x, viewport.y, zoom, width, height]);
  const temporary =
    props.isDraggingConnection && props.connectionStart && props.tempConnectionEnd
      ? [
          ...new Set(
            props.batchConnectionSourceNodeIds?.length
              ? props.batchConnectionSourceNodeIds
              : [props.connectionStart.nodeId],
          ),
        ].flatMap((id) => {
          const node = byId.get(id),
            start = props.connectionStart!,
            end = props.tempConnectionEnd!;
          if (!node) return [];
          const size = geometryCache.size(node);
          const target = props.hoveredNodeId ? byId.get(props.hoveredNodeId) : undefined;
          const side = props.hoveredSide;
          const index =
            target?.type === 'ComfyUI'
              ? (props.hoveredPortIndex ?? (side === 'left' ? target.parentIds?.length || 0 : 0))
              : 0;
          const curve: Curve = {
            start: {
              x: getPortX(node, start.handle, size.width),
              y: getPortY(node, start.handle, start.portIndex ?? 0, size.height),
            },
            end:
              target && side
                ? {
                    x: getPortX(target, side, geometryCache.size(target).width),
                    y: getPortY(
                      target,
                      side,
                      index,
                      geometryCache.size(target).height || getHeight(target, node),
                    ),
                  }
                : { x: (end.x - viewport.x) / zoom, y: (end.y - viewport.y) / zoom },
            side: start.handle,
          };
          return [
            <g key={`temp-${id}`} className="pointer-events-none">
              <path d={edgePath(curve)} stroke="var(--af-edge-halo)" strokeWidth="5" fill="none" />
              <path
                d={edgePath(curve)}
                stroke={
                  props.isInvalidHover
                    ? 'var(--af-danger)'
                    : target && side
                      ? 'var(--af-focus)'
                      : 'var(--af-edge)'
                }
                strokeWidth="2"
                strokeDasharray="5,5"
                fill="none"
                className="pointer-events-none"
              />
            </g>,
          ];
        })
      : null;
  return (
    <>
      <defs>
        <filter
          id={filterId}
          filterUnits="objectBoundingBox"
          x="-20%"
          y="-160%"
          width="140%"
          height="420%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="blurOuter" />
          <feFlood floodColor="rgba(59, 130, 246, 0.45)" result="floodOuter" />
          <feComposite in="blurOuter" in2="floodOuter" operator="in" result="glowOuter" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.95" result="blurInner" />
          <feFlood floodColor="rgba(147, 197, 253, 0.82)" result="floodInner" />
          <feComposite in="blurInner" in2="floodInner" operator="in" result="glowInner" />
          <feMerge>
            <feMergeNode in="glowOuter" />
            <feMergeNode in="glowInner" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {edges.map((edge, edgeIndex) => {
        const chosen =
          selectedConnection?.parentId === edge.parentId &&
          selectedConnection.childId === edge.childId &&
          selectedConnection.portIndex === edge.portIndex;
        const related = selected.has(edge.parentId) || selected.has(edge.childId),
          highlighted = related || chosen,
          over = hovered === edge.key;
        // Keep the preloaded line/hit target, but animate only when its curve can be seen.
        // Bezier controls may cross the screen even if both endpoint cards are outside it.
        const horizontal = Math.abs(edge.curve.end.x - edge.curve.start.x) / 2;
        const flowVisible =
          Math.max(edge.curve.start.x + horizontal, edge.curve.end.x) >= (-viewport.x - 32) / zoom &&
          Math.min(edge.curve.start.x, edge.curve.end.x - horizontal) <= (width - viewport.x + 32) / zoom &&
          Math.max(edge.curve.start.y, edge.curve.end.y) >= (-viewport.y - 32) / zoom &&
          Math.min(edge.curve.start.y, edge.curve.end.y) <= (height - viewport.y + 32) / zoom;
        return (
          <g
            key={edge.key}
            data-edge-key={`${edge.parentId}-${edge.childId}-${edge.portIndex}`}
            onClick={(event) =>
              props.onEdgeClick(event, edge.parentId, edge.childId, edge.portIndex)
            }
            onDoubleClick={(event) =>
              props.onEdgeDoubleClick?.(event, edge.parentId, edge.childId, edge.portIndex)
            }
            onMouseEnter={() => setHovered(edge.key)}
            onMouseLeave={() => setHovered((current) => (current === edge.key ? null : current))}
            data-fisherai-edge-hovered={over ? 'true' : 'false'}
            className="cursor-pointer group pointer-events-auto fisherai-canvas-edge"
            style={{ opacity: highlighted || over ? 1 : 0.78 }}
          >
            <path
              data-fisherai-edge-hit-target="true"
              d={edge.path}
              stroke="transparent"
              strokeWidth="32"
              fill="none"
            />
            <path
              data-af-edge-halo
              d={edge.path}
              stroke="var(--af-edge-halo)"
              strokeWidth={highlighted ? 6.2 : 5.4}
              fill="none"
              className="pointer-events-none"
            />
            <path
              data-fisherai-edge-visible="true"
              d={edge.path}
              stroke="var(--af-edge)"
              strokeWidth={highlighted ? 3.2 : 2.4}
              fill="none"
              className="fisherai-edge-visible"
            />
            <g
              data-fisherai-edge-scissors="true"
              className="fisherai-edge-scissors pointer-events-none"
              transform={`translate(${(edge.curve.start.x + edge.curve.end.x) / 2} ${(edge.curve.start.y + edge.curve.end.y) / 2})`}
            >
              <title>双击断开连线</title>
              <circle
                r={15}
                fill="var(--af-surface-raised)"
                stroke="var(--fisherai-edge-danger)"
                strokeWidth={1.5}
              />
              <g
                fill="none"
                stroke="var(--af-text)"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M-7 -7L3 3M7 -7L-3 3" />
                <circle cx={-5} cy={6} r={3.2} />
                <circle cx={5} cy={6} r={3.2} />
              </g>
            </g>
            {(highlighted || over) && flowVisible && (
              <EdgeFlow
                React={React}
                edge={edge}
                edgeIndex={edgeIndex}
                scope={scope}
                filterId={filterId}
                over={over}
              />
            )}
          </g>
        );
      })}
      {temporary}
    </>
  );
}
