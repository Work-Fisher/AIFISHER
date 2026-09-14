import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import {
  drawComposite,
  initialCompositeScene,
  type CompositeLayer,
  type LayerTransform,
} from '../dialogs/compositeScene';
type Runtime = Pick<typeof ReactTypes, 'createElement' | 'useRef' | 'useState' | 'useEffect'>;
interface ConnectedImage {
  id: string;
  url?: string;
  title?: string;
}
interface NodeData {
  id: string;
  title?: string;
  compositeLayout?: Record<string, Partial<LayerTransform>>;
}
interface Components {
  Frame: CanvasComponent;
  Header: CanvasComponent;
  Empty: CanvasComponent;
}
interface Props extends Record<string, unknown> {
  data: NodeData;
  selected?: boolean;
  connectedImageNodes?: ConnectedImage[];
  onOpenCompare?: (payload: {
    leftUrl: string;
    rightUrl: string;
    leftLabel: string;
    rightLabel: string;
    title: string;
  }) => void;
  onOpenComposite?: (payload: {
    nodeId: string;
    layers: { nodeId: string; url: string; title?: string }[];
    layout: Record<string, Partial<LayerTransform>>;
  }) => void;
}
const imagesOf = (nodes: ConnectedImage[] | undefined, limit: number) =>
  (nodes || [])
    .filter(
      (node) => node.url && !['text-node-placeholder', 'audio-node-placeholder'].includes(node.url),
    )
    .slice(0, limit);
function frameProps(props: Props) {
  return {
    data: props.data,
    selected: props.selected,
    onNodePointerDown: props.onNodePointerDown,
    onContextMenu: props.onContextMenu,
    onConnectorDown: props.onConnectorDown,
    isHoveredForConnection: props.isHoveredForConnection,
    isInvalidHover: props.isInvalidHover,
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    isResizing: props.isResizing ?? false,
    isDragging: props.isDragging ?? false,
    onResizeStart: props.onResizeStart,
    zoom: props.zoom,
  };
}
function headerProps(props: Props) {
  return {
    data: props.data,
    selected: props.selected,
    onUpdate: props.onUpdate,
  };
}
export function CanvasCompareNode(
  React: Runtime,
  props: Props,
  { Frame, Header, Empty }: Components,
) {
  const [position, setPosition] = React.useState(50),
    surface = React.useRef<HTMLDivElement>(null);
  const [left, right] = imagesOf(props.connectedImageNodes, 2),
    ready = !!(left?.url && right?.url);
  return (
    <Frame {...frameProps(props)}>
      <Header {...headerProps(props)} />
      <div
        ref={surface}
        data-fisherai-original-media="true"
        style={{ containerType: 'inline-size' }}
        className={
          'relative w-full h-full rounded-lg overflow-hidden bg-[var(--af-surface)] ' +
          (ready ? 'cursor-zoom-in' : 'cursor-default')
        }
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (left?.url && right?.url)
            props.onOpenCompare?.({
              leftUrl: left.url,
              rightUrl: right.url,
              leftLabel: left.title || 'A',
              rightLabel: right.title || 'B',
              title: props.data.title || '图片对比',
            });
        }}
        onMouseMove={(event) => {
          const bounds = surface.current?.getBoundingClientRect();
          if (ready && bounds && bounds.width > 0)
            setPosition(
              Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
            );
        }}
      >
        {ready ? (
          <div
            data-af-media-chrome
            className="absolute inset-0 rounded-lg overflow-hidden bg-[var(--af-media-bg)] shadow-xl pointer-events-none"
          >
            <img
              src={right!.url}
              alt="对比图 B"
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
            />
            <div
              className="absolute left-0 top-0 h-full overflow-hidden border-r border-black/50"
              style={{ width: `${position}%` }}
            >
              <img
                src={left!.url}
                alt="对比图 A"
                className="absolute left-0 top-0 h-full object-cover"
                style={{ width: '100cqw', maxWidth: 'none' }}
                draggable={false}
              />
            </div>
          </div>
        ) : left?.url ? (
          <div
            data-af-media-chrome
            className="absolute inset-0 rounded-lg overflow-hidden bg-[var(--af-media-bg)] shadow-xl"
          >
            <img
              src={left.url}
              alt="图片对比预览"
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
          </div>
        ) : (
          <div className="w-full h-full bg-[var(--af-surface)] flex items-center justify-center">
            <div className="text-[var(--af-text-muted)]">
              <Empty size={40} />
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}
export function CanvasCompositeNode(
  React: Runtime,
  props: Props,
  { Frame, Header, Empty }: Components,
) {
  const canvas = React.useRef<HTMLCanvasElement>(null),
    [layers, setLayers] = React.useState<CompositeLayer[]>([]);
  const images = imagesOf(props.connectedImageNodes, 10);
  const signature = JSON.stringify(
    images.map((node) => ({ nodeId: node.id, url: node.url, title: node.title })),
  );
  React.useEffect(() => {
    let active = true;
    setLayers([]);
    const requests: { image: HTMLImageElement; cancel(): void }[] = [];
    const sources = JSON.parse(signature) as { nodeId: string; url: string; title?: string }[];
    const pending = sources.map(
      (source) =>
        new Promise<CompositeLayer | null>((resolve) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          requests.push({ image, cancel: () => resolve(null) });
          image.onload = () =>
            resolve(
              image.naturalWidth && image.naturalHeight
                ? { ...source, image, width: image.naturalWidth, height: image.naturalHeight }
                : null,
            );
          image.onerror = () => resolve(null);
          image.src = source.url;
        }),
    );
    void Promise.all(pending).then((results) => {
      if (active) setLayers(results.filter((layer): layer is CompositeLayer => !!layer));
    });
    return () => {
      active = false;
      requests.forEach(({ image, cancel }) => {
        image.onload = null;
        image.onerror = null;
        cancel();
      });
    };
  }, [signature]);
  React.useEffect(() => {
    const element = canvas.current,
      context = element?.getContext('2d');
    if (!element || !context) return;
    const width = Math.max(1, ...layers.map((layer) => layer.width)),
      height = Math.max(1, ...layers.map((layer) => layer.height)),
      scale = Math.min(252 / width, 252 / height);
    element.width = Math.round(width * scale);
    element.height = Math.round(height * scale);
    context.save();
    context.scale(scale, scale);
    drawComposite(context, layers, initialCompositeScene(layers, props.data.compositeLayout));
    context.restore();
  }, [layers, props.data.compositeLayout]);
  return (
    <Frame {...frameProps(props)}>
      <Header {...headerProps(props)} />
      <div
        className={
          'relative w-full h-full rounded-lg overflow-hidden bg-[var(--af-surface)] ' +
          (images.length ? 'cursor-zoom-in' : 'cursor-default')
        }
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (images.length)
            props.onOpenComposite?.({
              nodeId: props.data.id,
              layers: images.map((node) => ({
                nodeId: node.id,
                url: node.url!,
                title: node.title,
              })),
              layout: props.data.compositeLayout || {},
            });
        }}
      >
        {images.length ? (
          <div
            data-af-media-chrome
            className="absolute inset-0 rounded-lg overflow-hidden bg-[var(--af-media-bg)] shadow-xl"
          >
            <canvas
              ref={canvas}
              className="w-full h-full object-contain pointer-events-none"
              aria-label="合成预览"
            />
          </div>
        ) : (
          <div className="w-full h-full bg-[var(--af-surface)] flex items-center justify-center">
            <div className="text-[var(--af-text-muted)]">
              <Empty size={40} />
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}
