import type * as ReactTypes from 'react';
import type { CanvasViewport } from '../canvas/canvasNavigation';
import type { CanvasGroup } from '../canvas/canvasGroups';
import type { CanvasNodeFrame, SelectionResizeHandle } from '../canvas/canvasEditing';
import type { MinimapNode, NodeMeasurement } from './minimapGeometry';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'Fragment' | 'useState' | 'useRef' | 'useEffect' | 'useLayoutEffect'
>;
interface Props {
  documentEpoch?: number;
  selectedNodes: MinimapNode[];
  group?: CanvasGroup | null;
  viewport: CanvasViewport;
  onGroup(): void;
  onUngroup(): void;
  onBoundingBoxPointerDown(event: ReactTypes.PointerEvent): void;
  onSelectionResizeStart?(
    event: ReactTypes.PointerEvent,
    handle: SelectionResizeHandle,
    frames: CanvasNodeFrame[],
  ): void;
  onRenameGroup?(id: string, label: string): void;
  onToggleGridSlider?(): void;
  onCreateCollage?(): void;
  showGridSlider?: boolean;
  gridColumns?: number;
  isSelected?: boolean;
  isDragging?: boolean;
  isPanning?: boolean;
  onBatchConnectorDown?(event: ReactTypes.PointerEvent, side: 'left' | 'right'): void;
}
export function CanvasSelectionBounds(React: Runtime, props: Props, measure: NodeMeasurement) {
  const {
    documentEpoch,
    selectedNodes,
    group,
    viewport,
    onGroup,
    onUngroup,
    onBoundingBoxPointerDown,
    onSelectionResizeStart,
    onToggleGridSlider,
    onCreateCollage,
    showGridSlider,
    gridColumns,
    isSelected,
    isDragging,
    isPanning = false,
    onBatchConnectorDown,
  } = props;
  const [editing, setEditing] = React.useState(false),
    [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null),
    editOwnerRef = React.useRef<{ id: string; epoch: number | undefined } | null>(null),
    finishedRef = React.useRef(true),
    currentRef = React.useRef(props);
  React.useLayoutEffect(() => {
    currentRef.current = props;
  });
  React.useEffect(() => {
    finishedRef.current = true;
    editOwnerRef.current = null;
    setEditing(false);
  }, [group?.id, documentEpoch]);
  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const startRename = (event: ReactTypes.MouseEvent) => {
    event.stopPropagation();
    if (!group) return;
    finishedRef.current = false;
    editOwnerRef.current = { id: group.id, epoch: documentEpoch };
    setDraft(group.label);
    setEditing(true);
  };
  const commitTitle = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const owner = editOwnerRef.current,
      label = draft.trim();
    setEditing(false);
    if (
      owner &&
      currentRef.current.group?.id === owner.id &&
      currentRef.current.documentEpoch === owner.epoch &&
      label &&
      label !== currentRef.current.group.label
    )
      currentRef.current.onRenameGroup?.(owner.id, label);
  };
  const titleKeyDown = (event: ReactTypes.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finishedRef.current = true;
      setEditing(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commitTitle();
    }
  };
  const byId = new Map(selectedNodes.map((node) => [node.id, node]));
  const frames = selectedNodes.map((node) => {
    const parent = byId.get(node.parentIds?.[0] || ''),
      width = measure.width(node, parent),
      height = measure.height(node, parent),
      minSize = node.type === 'Text' ? 252 : 200;
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      width,
      height,
      minWidth: Math.min(width, minSize),
      minHeight: Math.min(height, minSize),
    };
  });
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const frame of frames) {
    left = Math.min(left, frame.x - 50);
    top = Math.min(top, frame.y - 50);
    right = Math.max(right, frame.x + frame.width + 50);
    bottom = Math.max(bottom, frame.y + frame.height + 50);
  }
  const width = right - left,
    height = bottom - top,
    isGroup = !!group,
    canGroup = selectedNodes.length > 1 && !isGroup,
    controlScale = Math.min(1 / viewport.zoom, 1.5),
    accent = '#3b82f6',
    borderColor = isSelected ? accent : '#444';
  const resizeSelection = (event: ReactTypes.PointerEvent, handle: SelectionResizeHandle) => {
    if (event.button !== 0 || !onSelectionResizeStart) return;
    event.stopPropagation();
    event.preventDefault();
    onSelectionResizeStart(event, handle, frames);
  };
  if (
    !frames.length ||
    (frames.length === 1 && !group) ||
    ![left, top, width, height, controlScale].every(Number.isFinite)
  )
    return null;
  return (
    <div
      data-selection-bounding-box={'true'}
      data-fisherai-group-id={group?.id}
      className={`absolute pointer-events-auto ${isPanning ? 'cursor-grabbing' : 'cursor-move'}`}
      style={{
        left: left,
        top: top,
        width: width,
        height: height,
        border: isGroup ? `2px solid ${borderColor}` : `2px dashed ${borderColor}`,
        borderRadius: '12px',
        backgroundColor: isGroup
          ? isSelected
            ? 'rgba(59, 130, 246, 0.15)'
            : 'rgba(68, 68, 68, 0.22)'
          : 'transparent',
        zIndex: 5,
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onBoundingBoxPointerDown(event);
        }
      }}
    >
      {!isGroup &&
        [
          { pos: 'top-left', cursor: 'nw-resize', top: -4, left: -4 },
          {
            pos: 'top',
            cursor: 'n-resize',
            top: -4,
            left: '50%',
            transform: 'translateX(-50%)',
          },
          { pos: 'top-right', cursor: 'ne-resize', top: -4, right: -4 },
          {
            pos: 'right',
            cursor: 'e-resize',
            top: '50%',
            right: -4,
            transform: 'translateY(-50%)',
          },
          { pos: 'bottom-right', cursor: 'se-resize', bottom: -4, right: -4 },
          {
            pos: 'bottom',
            cursor: 's-resize',
            bottom: -4,
            left: '50%',
            transform: 'translateX(-50%)',
          },
          { pos: 'bottom-left', cursor: 'sw-resize', bottom: -4, left: -4 },
          {
            pos: 'left',
            cursor: 'w-resize',
            top: '50%',
            left: -4,
            transform: 'translateY(-50%)',
          },
        ].map((event) => (
          <div
            data-fisherai-selection-resize-handle={event.pos}
            aria-label={'批量缩放选中节点'}
            className={
              'absolute w-2 h-2 bg-[var(--af-primary)] border rounded-sm pointer-events-auto'
            }
            style={{
              top: event.top,
              left: event.left,
              right: event.right,
              bottom: event.bottom,
              transform: event.transform,
              cursor: event.cursor,
              borderColor: borderColor,
            }}
            onPointerDown={(pointer) =>
              resizeSelection(pointer, event.pos as SelectionResizeHandle)
            }
            key={event.pos}
          />
        ))}
      {isSelected && selectedNodes.length > 1 && onBatchConnectorDown && !isDragging && (
        <React.Fragment>
          <div
            className={
              'absolute w-16 h-16 flex items-center justify-center z-10 pointer-events-auto rounded-full'
            }
            style={{
              left: '-52px',
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          >
            <button
              onPointerDown={(event) => {
                event.stopPropagation();
                onBatchConnectorDown(event, 'left');
              }}
              className={
                'w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-75 border-[var(--af-border-control)] bg-[var(--af-input)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)] hover:border-[var(--af-border-control)] cursor-crosshair shadow-lg opacity-100'
              }
              title={'批量输入连线'}
            >
              <svg
                width={'12'}
                height={'12'}
                viewBox={'0 0 24 24'}
                fill={'none'}
                stroke={'currentColor'}
                strokeWidth={'3'}
                strokeLinecap={'round'}
              >
                <path d={'M12 5v14'} />
                <path d={'M5 12h14'} />
              </svg>
            </button>
          </div>
          <div
            className={
              'absolute w-16 h-16 flex items-center justify-center z-10 pointer-events-auto rounded-full'
            }
            style={{
              right: '-52px',
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          >
            <button
              onPointerDown={(event) => {
                event.stopPropagation();
                onBatchConnectorDown(event, 'right');
              }}
              className={
                'w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-75 border-[var(--af-border-control)] bg-[var(--af-input)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)] hover:border-[var(--af-border-control)] cursor-crosshair shadow-lg opacity-100'
              }
              title={'批量输出连线'}
            >
              <svg
                width={'12'}
                height={'12'}
                viewBox={'0 0 24 24'}
                fill={'none'}
                stroke={'currentColor'}
                strokeWidth={'3'}
                strokeLinecap={'round'}
              >
                <path d={'M12 5v14'} />
                <path d={'M5 12h14'} />
              </svg>
            </button>
          </div>
        </React.Fragment>
      )}
      {isGroup && group && (
        <div
          data-fisherai-group-title={'true'}
          className={'absolute pointer-events-auto'}
          style={{
            bottom: 'calc(100% + 8px)',
            left: 0,
            transform: `scale(${controlScale})`,
            transformOrigin: 'bottom left',
            display: 'inline-grid',
            alignItems: 'center',
            padding: '4px 10px',
            border: 'none',
            borderRadius: '8px',
            backgroundColor: 'var(--af-surface)',
            boxShadow: '0 10px 28px rgba(0,0,0,.42)',
          }}
        >
          <span
            className={'text-sm font-medium px-1 py-1 invisible'}
            style={{ gridArea: '1/1', whiteSpace: 'pre', minWidth: '60px' }}
          >
            {(editing ? draft : group.label) || ' '}
          </span>
          {editing ? (
            <input
              ref={inputRef}
              aria-label="分组名称"
              type={'text'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={titleKeyDown}
              onPointerDown={(event) => {
                if (event.button !== 1) {
                  event.stopPropagation();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              className={'text-sm font-bold px-1 py-1 rounded outline-none transition-all'}
              style={{
                gridArea: '1/1',
                width: '100%',
                backgroundColor: 'transparent',
                color: accent,
                border: 'none',
              }}
            />
          ) : (
            <div
              className={
                'text-sm font-bold px-1 py-1 rounded cursor-text whitespace-nowrap transition-colors'
              }
              style={{
                gridArea: '1/1',
                backgroundColor: 'transparent',
                color: isSelected ? 'var(--af-text)' : 'var(--af-text)',
                border: 'none',
              }}
              onPointerDown={(event) => {
                if (event.button !== 1) {
                  event.stopPropagation();
                }
              }}
              onDoubleClick={startRename}
            >
              {group.label}
            </div>
          )}
        </div>
      )}
      {canGroup && isSelected && !isDragging && (
        <div
          className={
            'absolute flex gap-2 pointer-events-auto animate-in fade-in slide-in-from-bottom-1 duration-200'
          }
          style={{
            top: -10,
            right: 0,
            transform: `scale(${controlScale}) translateY(-100%)`,
            transformOrigin: 'bottom right',
          }}
        >
          {onCreateCollage && (
            <button
              onClick={onCreateCollage}
              className={
                'bg-[var(--af-input)] border border-[var(--af-border-control)] hover:bg-[var(--af-surface-raised)] text-[var(--af-text)] text-sm px-4 py-2.5 rounded-[12px] flex items-center gap-2 transition-colors'
              }
            >
              <svg
                width={'16'}
                height={'16'}
                viewBox={'0 0 24 24'}
                fill={'none'}
                stroke={'currentColor'}
                strokeWidth={'2'}
              >
                <rect x={'3'} y={'5'} width={'7'} height={'6'} />
                <rect x={'14'} y={'5'} width={'7'} height={'6'} />
                <rect x={'3'} y={'14'} width={'7'} height={'5'} />
                <rect x={'14'} y={'14'} width={'7'} height={'5'} />
              </svg>
              {'拼图'}
            </button>
          )}
          <div className={'relative flex items-center'}>
            <button
              onClick={() => {
                if (onToggleGridSlider) {
                  onToggleGridSlider();
                }
              }}
              className={`bg-[var(--af-input)] border border-[var(--af-border-control)] hover:bg-[var(--af-surface-raised)] text-[var(--af-text)] text-sm px-4 py-2.5 rounded-[12px] flex items-center gap-2 transition-colors ${showGridSlider ? 'border-[var(--af-info)] bg-[var(--af-info-bg)]' : ''}`}
            >
              <svg
                width={'16'}
                height={'16'}
                viewBox={'0 0 24 24'}
                fill={'none'}
                stroke={'currentColor'}
                strokeWidth={'2'}
              >
                <rect x={'3'} y={'3'} width={'7'} height={'7'} />
                <rect x={'14'} y={'3'} width={'7'} height={'7'} />
                <rect x={'14'} y={'14'} width={'7'} height={'7'} />
                <rect x={'3'} y={'14'} width={'7'} height={'7'} />
              </svg>
              {showGridSlider ? `列数: ${gridColumns}` : '排列'}
            </button>
          </div>
          <button
            onClick={onGroup}
            className={
              'bg-[var(--af-input)] border border-[var(--af-border-control)] hover:bg-[var(--af-surface-raised)] text-[var(--af-text)] text-sm px-4 py-2.5 rounded-[12px] flex items-center gap-2 transition-colors'
            }
          >
            <svg
              width={'16'}
              height={'16'}
              viewBox={'0 0 24 24'}
              fill={'none'}
              stroke={'currentColor'}
              strokeWidth={'2'}
            >
              <rect x={'3'} y={'3'} width={'7'} height={'7'} />
              <rect x={'14'} y={'3'} width={'7'} height={'7'} />
              <rect x={'14'} y={'14'} width={'7'} height={'7'} />
              <rect x={'3'} y={'14'} width={'7'} height={'7'} />
            </svg>
            {'打组'}
          </button>
        </div>
      )}
      {isGroup && isSelected && !isDragging && (
        <div
          className={
            'absolute flex gap-2 pointer-events-auto animate-in fade-in slide-in-from-bottom-1 duration-200'
          }
          style={{
            top: -10,
            left: '50%',
            transform: `translateX(-50%) scale(${controlScale}) translateY(-100%)`,
            transformOrigin: 'bottom center',
          }}
        >
          <button
            onClick={onUngroup}
            className={
              'bg-[var(--af-input)] border border-[var(--af-border-control)] hover:bg-[var(--af-surface-raised)] text-[var(--af-text)] text-sm px-4 py-2.5 rounded-[12px] flex items-center gap-2 transition-colors'
            }
          >
            <svg
              width={'16'}
              height={'16'}
              viewBox={'0 0 24 24'}
              fill={'none'}
              stroke={'currentColor'}
              strokeWidth={'2'}
            >
              <rect x={'3'} y={'3'} width={'7'} height={'7'} />
              <rect x={'14'} y={'3'} width={'7'} height={'7'} />
              <rect x={'14'} y={'14'} width={'7'} height={'7'} />
              <rect x={'3'} y={'14'} width={'7'} height={'7'} />
              <line x1={'3'} y1={'3'} x2={'21'} y2={'21'} />
            </svg>
            {'解组'}
          </button>
        </div>
      )}
    </div>
  );
}
