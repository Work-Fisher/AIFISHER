import type * as ReactTypes from 'react';
import type { CanvasViewport } from '../canvas/canvasNavigation';
import type { MinimapNode } from './minimapGeometry';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'Fragment' | 'useState' | 'useRef' | 'useEffect'
>;
interface Props {
  view: string;
  nodes: MinimapNode[];
  viewport: CanvasViewport;
  onViewportChange(viewport: CanvasViewport): void;
  isMinimapOpen: boolean;
  setIsMinimapOpen: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>;
  minimapWidth: number;
  zoomControlsRef: ReactTypes.RefObject<HTMLDivElement | null>;
  canvasRef?: ReactTypes.RefObject<HTMLElement | null>;
  documentEpoch?: number;
  onResetCanvas(nodes: MinimapNode[]): void;
  onSliderZoom(event: ReactTypes.ChangeEvent<HTMLInputElement>): void;
  showGridSlider: boolean;
  setShowGridSlider(value: boolean): void;
  gridColumns: number;
  setGridColumns(value: number): void;
  isCompact: boolean;
  setIsCompact(value: boolean): void;
  onGridLayout(columns: number, compact: boolean): void;
  selectedNodeIds: string[];
}
interface Components {
  Tooltip: ReactTypes.ComponentType<{
    text: string;
    children: ReactTypes.ReactNode;
  }>;
  Minimap: ReactTypes.ComponentType<{
    nodes: MinimapNode[];
    viewport: CanvasViewport;
    onViewportChange(viewport: CanvasViewport): void;
    width: number;
    height: number;
    canvasRef?: ReactTypes.RefObject<HTMLElement | null>;
    documentEpoch?: number;
  }>;
}
export function CanvasViewportControls(React: Runtime, props: Props, components: Components) {
  const {
    view,
    nodes,
    viewport,
    onViewportChange,
    isMinimapOpen,
    setIsMinimapOpen,
    minimapWidth,
    zoomControlsRef,
    canvasRef,
    documentEpoch,
    onResetCanvas,
    onSliderZoom,
    showGridSlider,
    setShowGridSlider,
    gridColumns,
    setGridColumns,
    isCompact,
    setIsCompact,
    onGridLayout,
    selectedNodeIds,
  } = props;
  const { Tooltip, Minimap } = components;
  const [helpOpen, setHelpOpen] = React.useState(false),
    gridRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    setHelpOpen(false);
  }, [documentEpoch, view]);
  const helpKeyDown = (event: ReactTypes.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setHelpOpen(false);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setHelpOpen((value) => !value);
    }
  };
  const gridKeyDown = (event: ReactTypes.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setShowGridSlider(false);
    }
  };
  return (
    <React.Fragment>
      {view === 'canvas' && isMinimapOpen && (
        <Minimap
          nodes={nodes}
          canvasRef={canvasRef}
          documentEpoch={documentEpoch}
          viewport={viewport}
          onViewportChange={onViewportChange}
          width={minimapWidth}
          height={minimapWidth * 0.6}
        />
      )}
      <div
        ref={zoomControlsRef}
        className={
          'fixed bottom-6 left-6 h-[42px] rounded-lg px-3 flex items-center gap-2.5 z-50 transition-colors duration-300 bg-[var(--af-input)]'
        }
      >
        <Tooltip text={isMinimapOpen ? '关闭小地图' : '打开小地图'}>
          <button
            aria-label={isMinimapOpen ? '关闭小地图' : '打开小地图'}
            onClick={() => setIsMinimapOpen((event) => !event)}
            className={`p-1.5 rounded-full transition-colors ${isMinimapOpen ? 'bg-[var(--af-info-bg)] text-[var(--af-info)]' : 'hover:bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)]'}`}
          >
            <svg
              viewBox={'0 0 24 24'}
              className={'w-4 h-4'}
              fill={'none'}
              stroke={'currentColor'}
              strokeWidth={'2'}
              strokeLinecap={'round'}
              strokeLinejoin={'round'}
            >
              <polygon points={'1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6'} />
              <line x1={'8'} y1={'2'} x2={'8'} y2={'18'} />
              <line x1={'16'} y1={'6'} x2={'16'} y2={'22'} />
            </svg>
          </button>
        </Tooltip>
        <Tooltip text={'显示所有节点'}>
          <button
            aria-label="显示所有节点"
            onClick={() => onResetCanvas(nodes)}
            className={
              'p-1.5 rounded-full hover:bg-[var(--af-surface-raised)] transition-colors text-[var(--af-text-secondary)]'
            }
          >
            <svg
              viewBox={'0 0 24 24'}
              className={'w-4 h-4'}
              fill={'none'}
              stroke={'currentColor'}
              strokeWidth={'2'}
              strokeLinecap={'round'}
              strokeLinejoin={'round'}
            >
              <path d={'M8 3H5a2 2 0 0 0-2 2v3'} />
              <path d={'M21 8V5a2 2 0 0 0-2-2h-3'} />
              <path d={'M3 16v3a2 2 0 0 0 2 2h3'} />
              <path d={'M16 21h3a2 2 0 0 0 2-2v-3'} />
              <rect x={'9'} y={'9'} width={'6'} height={'6'} />
            </svg>
          </button>
        </Tooltip>
        <input
          type={'range'}
          min={'0.05'}
          max={'5'}
          step={'0.05'}
          value={viewport.zoom}
          aria-label="画布缩放"
          onChange={onSliderZoom}
          className={
            'w-16 h-1 bg-[var(--af-hover)] rounded-lg appearance-none cursor-pointer accent-blue-500'
          }
        />
        <Tooltip text={'当前缩放比例'}>
          <span className={'text-[11px] font-bold min-w-[32px] text-[var(--af-text-secondary)]'}>
            {Math.round(viewport.zoom * 100)}
            {'%'}
          </span>
        </Tooltip>
      </div>
      {view === 'canvas' && (
        <div className={'fixed bottom-6 left-[240px] z-50 group'} onKeyDown={helpKeyDown}>
          <div
            role="button"
            tabIndex={0}
            aria-label="快捷键说明"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((value) => !value)}
            onFocus={() => setHelpOpen(true)}
            onBlur={() => setHelpOpen(false)}
            className={
              'h-[42px] w-[42px] flex items-center justify-center cursor-help transition-all duration-300'
            }
          >
            <svg
              viewBox={'0 0 24 24'}
              className={
                'w-6 h-6 text-[var(--af-text-muted)] group-hover:text-[var(--af-info)] transition-all duration-300 drop-shadow-lg'
              }
              fill={'none'}
              stroke={'currentColor'}
              strokeWidth={'2'}
              strokeLinecap={'round'}
              strokeLinejoin={'round'}
            >
              <circle cx={'12'} cy={'12'} r={'10'} />
              <path d={'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'} />
              <line x1={'12'} y1={'17'} x2={'12.01'} y2={'17'} />
            </svg>
          </div>
          <div
            style={helpOpen ? { opacity: 1, pointerEvents: 'auto', transform: 'none' } : undefined}
            className={
              'absolute bottom-full left-0 mb-4 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all duration-300 translate-y-2 group-hover:translate-y-0'
            }
          >
            <div
              className={
                'bg-[var(--af-input)] border border-[var(--af-border-control)] p-5 rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.6)] w-64 backdrop-blur-2xl'
              }
            >
              <h3 className={'text-[var(--af-text)] font-bold mb-4 flex items-center gap-2'}>
                <span className={'w-1.5 h-4 bg-[var(--af-info-bg)] rounded-full'} />
                {'快捷键说明'}
              </h3>
              <div className={'space-y-3'}>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'平移画布'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'中键拖拽 / Alt+滚轮'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'缩放画布'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'滚轮 / Ctrl+滚轮'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'聚焦选中/全部'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'F'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'自动排列'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'L'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'保存工作流'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'Ctrl + S'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'复制 / 粘贴'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'Ctrl + C / V'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'节点打组'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'Ctrl + G'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'撤销 / 重做'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'Ctrl + Z / Y'}
                  </kbd>
                </div>
                <div className={'flex justify-between items-center text-sm'}>
                  <span className={'text-[var(--af-text-secondary)]'}>{'删除节点'}</span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'Del / Backspace'}
                  </kbd>
                </div>
                <div
                  className={
                    'flex justify-between items-center text-sm border-t border-[var(--af-border)] pt-2 mt-2'
                  }
                >
                  <span className={'text-[var(--af-text-secondary)] font-medium'}>
                    {'断开连线'}
                  </span>
                  <kbd
                    className={
                      'px-2 py-1 bg-[var(--af-surface-raised)] rounded border border-[var(--af-border-control)] text-xs text-[var(--af-info)] font-mono'
                    }
                  >
                    {'双击连线'}
                  </kbd>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showGridSlider && selectedNodeIds.length > 1 && view === 'canvas' && (
        <div
          className={
            'fixed top-6 left-1/2 -translate-x-1/2 bg-[var(--af-input)] border border-[var(--af-border-control)] p-5 rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.6)] w-64 flex flex-col gap-4 z-[10000] backdrop-blur-2xl animate-in fade-in slide-in-from-top-4 duration-300'
          }
          ref={gridRef}
          role="dialog"
          aria-label="排列选中节点"
          onKeyDown={gridKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className={'flex flex-col gap-3'}>
            <div className={'flex justify-between items-center'}>
              <span
                className={
                  'text-[12px] text-[var(--af-text-secondary)] font-bold uppercase tracking-widest'
                }
              >
                {'宫格列数 (Columns)'}
              </span>
              <span
                className={
                  'bg-[var(--af-info-bg)] text-[var(--af-text)] text-xs font-black px-2 py-0.5 rounded-full min-w-[24px] text-center'
                }
              >
                {gridColumns}
              </span>
            </div>
            <input
              type={'range'}
              min={'1'}
              max={'10'}
              step={'1'}
              aria-label="宫格列数"
              value={gridColumns}
              onChange={(event) => {
                const columns = parseInt(event.target.value);
                setGridColumns(columns);
                onGridLayout(columns, isCompact);
              }}
              className={
                'w-full h-1.5 bg-[var(--af-surface-raised)] rounded-lg appearance-none cursor-pointer accent-blue-500'
              }
            />
            <div
              className={
                'flex justify-between text-[10px] text-[var(--af-text-muted)] font-medium px-1'
              }
            >
              <span>{'1'}</span>
              <span>{'10'}</span>
            </div>
          </div>
          <div
            className={
              'flex items-center justify-between px-1 py-1 border-t border-[var(--af-border)] pt-3'
            }
          >
            <span className={'text-[12px] text-[var(--af-text-secondary)] font-medium'}>
              {'紧凑模式 (Compact)'}
            </span>
            <button
              role="switch"
              aria-label="紧凑模式"
              aria-checked={isCompact}
              onClick={() => {
                const compact = !isCompact;
                setIsCompact(compact);
                onGridLayout(gridColumns, compact);
              }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${isCompact ? 'bg-[var(--af-info-bg)]' : 'bg-[var(--af-hover)]'}`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-[var(--af-primary)] transition-transform duration-200 ${isCompact ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </button>
          </div>
          <button
            onClick={() => setShowGridSlider(!1)}
            className={
              'w-full py-2 bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] text-[var(--af-text-secondary)] text-xs font-bold rounded-lg transition-colors'
            }
          >
            {'完成 (Done)'}
          </button>
        </div>
      )}
    </React.Fragment>
  );
}
