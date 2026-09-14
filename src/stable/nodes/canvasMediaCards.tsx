import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import { CanvasTextNodeContent } from '../text/CanvasTextNodeContent';
import { installGenerationScheduler } from '../generation/generationScheduler';
type Runtime = Pick<typeof ReactTypes, 'createElement' | 'useState' | 'useRef' | 'useEffect'>;
interface NodeData {
  id: string;
  type: string;
  prompt?: string;
  textContent?: string;
  textModel?: string;
  status?: string;
  projectId?: string;
  [key: string]: unknown;
}
interface Props extends Record<string, unknown> {
  data: NodeData;
  selected?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
  showControls?: boolean;
  isVisible?: boolean;
  onUpdate(id: string, patch: Record<string, unknown>): void;
  onSelect?(id: string): void;
  onUpload?(id: string, file: File): void;
  onVideoSnapshot?(id: string, data: string): unknown;
  onVideoFirstLastSnapshot?(id: string, first: string, last: string): unknown;
  onResizeStart?(event: ReactTypes.PointerEvent, id: string, width: number, height: number): void;
  connectedImageNodes?: Array<{ id: string; type?: string; url?: string; [key: string]: unknown }>;
}
interface Components {
  Frame: CanvasComponent;
  Header: CanvasComponent;
  Toolbar: CanvasComponent;
  Composer: CanvasComponent;
  Preview: CanvasComponent;
}
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
function toolbarProps(props: Props) {
  return {
    projectId: props.projectId,
    data: props.data,
    selected: props.selected,
    showControls: props.showControls ?? true,
    isDragging: props.isDragging ?? false,
    zoom: props.zoom,
    onExpand: props.onExpand,
    onSaveAsset: props.onSaveAsset,
    onDragStart: props.onDragStart,
    onDragEnd: props.onDragEnd,
    onUpdate: props.onUpdate,
  };
}
function headerProps(props: Props) {
  return {
    data: props.data,
    selected: props.selected,
    onUpdate: props.onUpdate,
  };
}
function MediaCard(
  React: Runtime,
  props: Props,
  { Frame, Header, Toolbar, Composer, Preview }: Components,
  kind: 'Image' | 'Video',
) {
  const fileInput = React.useRef<HTMLInputElement>(null),
    node = props.data;
  const upload = node.type === `Upload ${kind}`,
    showControls = props.showControls ?? true;
  const controls =
    props.selected &&
    !props.isDragging &&
    !upload &&
    showControls &&
    node.mediaOperation !== 'seedvr2-upscale' ? (
      <div
        className="flex flex-col items-center w-full"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Composer
          data={node}
          isLoading={node.status === 'loading'}
          inputUrl={props.inputUrl}
          connectedImageNodes={props.connectedImageNodes}
          onUpdate={props.onUpdate}
          onGenerate={props.onGenerate}
          onSelect={props.onSelect}
          zoom={props.zoom}
        />
      </div>
    ) : null;
  const previewProps =
    kind === 'Video'
      ? {
          inputUrl: props.inputUrl,
          onSnapshot: props.onVideoSnapshot
            ? (data: string) => props.onVideoSnapshot?.(node.id, data)
            : undefined,
          onSnapshotFirstLast: props.onVideoFirstLastSnapshot
            ? (first: string, last: string) =>
                props.onVideoFirstLastSnapshot?.(node.id, first, last)
            : undefined,
        }
      : { onUpload: props.onUpload };
  return (
    <Frame {...frameProps(props)} width={kind === 'Video' ? '385px' : '365px'} controls={controls}>
      {(kind !== 'Image' || !(props.isVisible ?? true)) && <Header {...headerProps(props)} />}
      <Toolbar
        {...toolbarProps(props)}
        fileInputRef={fileInput}
        {...(kind === 'Image'
          ? {
              onAnnotate: props.onAnnotate,
              onCrop: props.onCrop,
              onResizeImage: props.onResizeImage,
              onUpscaleImage: props.onUpscaleImage,
            }
          : {})}
      />
      {upload && (
        <input
          ref={fileInput}
          type="file"
          accept={kind === 'Image' ? 'image/*' : 'video/*'}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onUpload?.(node.id, file);
            event.target.value = '';
          }}
        />
      )}
      {(props.isVisible ?? true) && (
        <Preview
          data={node}
          selected={props.selected}
          onUpdate={props.onUpdate}
          {...(kind === 'Image'
            ? {
                renderHeader: (historyControl: ReactTypes.ReactNode) => (
                  <Header {...headerProps(props)}>{historyControl}</Header>
                ),
              }
            : {})}
          {...previewProps}
        />
      )}
    </Frame>
  );
}
export function CanvasImageCard(React: Runtime, props: Props, components: Components) {
  return MediaCard(React, props, components, 'Image');
}
export function CanvasVideoCard(React: Runtime, props: Props, components: Components) {
  return MediaCard(React, props, components, 'Video');
}
interface TextComponents extends Omit<Components, 'Preview' | 'Toolbar'> {
  defaultModel: string;
  nodeWidth(node: NodeData): number;
  nodeHeight(node: NodeData): number;
}
export function CanvasTextCard(
  React: Runtime,
  props: Props,
  { Frame, Header, Composer, defaultModel, nodeWidth, nodeHeight }: TextComponents,
) {
  const { data: node, onUpdate } = props;
  React.useEffect(() => {
    const patch = installGenerationScheduler().legacyTextPatch(
      {
        id: node.id,
        type: node.type,
        textModel: node.textModel,
        prompt: node.prompt,
        textContent: node.textContent,
      },
      defaultModel,
    );
    if (patch) onUpdate(node.id, patch);
  }, [node.id, node.type, node.textModel, node.prompt, node.textContent, defaultModel, onUpdate]);
  const showControls = props.showControls ?? true;
  return (
    <Frame
      {...frameProps(props)}
      controls={
        props.selected && !props.isDragging && showControls ? (
          <Composer
            data={node}
            onUpdate={onUpdate}
            onGenerate={props.onGenerate}
            onSelect={props.onSelect}
            zoom={props.zoom}
            connectedAssets={props.connectedImageNodes || []}
          />
        ) : null
      }
    >
      <CanvasTextNodeContent
        key={node.id}
        node={node}
        selected={props.selected}
        isDragging={props.isDragging}
        isResizing={props.isResizing}
        showControls={showControls}
        onUpdate={onUpdate}
        onSelect={props.onSelect}
        renderHeader={(children) => <Header {...headerProps(props)}>{children}</Header>}
      />
      {props.selected && props.onResizeStart && showControls && (
        <div
          className="absolute -bottom-6 -right-6 w-14 h-14 cursor-nwse-resize z-50 flex items-center justify-center group/resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            props.onResizeStart?.(event, node.id, nodeWidth(node), nodeHeight(node));
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-[var(--af-text-muted)] group-hover/resize:text-[var(--af-info)] transition-all duration-300 drop-shadow-[0_0_5px_rgba(0,0,0,0.6)]"
          >
            <path
              d="M 12 28 C 22 28 28 22 28 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </Frame>
  );
}
