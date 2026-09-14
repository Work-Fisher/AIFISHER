import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'Fragment' | 'useState' | 'useRef' | 'useEffect' | 'useLayoutEffect' | 'useMemo'
>;
interface Props {
  canvasTitle: string;
  isEditingTitle: boolean;
  editingTitleValue: string;
  canvasTitleInputRef: ReactTypes.RefObject<HTMLInputElement | null>;
  setCanvasTitle(value: string): void;
  setIsEditingTitle(value: boolean): void;
  setEditingTitleValue(value: string): void;
  onSave(): Promise<{ unchanged?: boolean } | null | undefined>;
  onBack?(): unknown;
  onImportProjectJson?(): void;
  documentEpoch?: number;
  hasUnsavedChanges: boolean;
  lastAutoSaveTime?: number | null;
  lastSavedBy?: string;
  lastSavedRevision?: number | null;
  isChatOpen?: boolean;
  chatPanelWidth?: number;
}
interface Components {
  Tooltip: ReactTypes.ComponentType<{
    text: string;
    position?: string;
    children: ReactTypes.ReactNode;
  }>;
  SaveIcon: CanvasComponent;
  ImportIcon: CanvasComponent;
  BackIcon: CanvasComponent;
}
export function CanvasHeader(React: Runtime, props: Props, components: Components) {
  const {
    canvasTitle,
    isEditingTitle,
    editingTitleValue,
    canvasTitleInputRef,
    setCanvasTitle,
    setIsEditingTitle,
    setEditingTitleValue,
    onImportProjectJson,
    hasUnsavedChanges,
    lastAutoSaveTime,
    lastSavedBy = '用户-',
    lastSavedRevision = null,
    isChatOpen = false,
    chatPanelWidth = 400,
    documentEpoch,
  } = props;
  const { Tooltip, SaveIcon, ImportIcon, BackIcon } = components;
  const [menuOpen, setMenuOpen] = React.useState(false),
    menuRoot = React.useRef<HTMLDivElement>(null),
    [saving, setSaving] = React.useState(false),
    [error, setError] = React.useState('');
  const live = React.useRef(props);
  live.current = props;
  const savingNow = React.useRef(false),
    lifetime = React.useRef(0),
    titleFinished = React.useRef(false);
  const commitTitle = () => {
    if (titleFinished.current) return;
    titleFinished.current = true;
    const value = editingTitleValue.trim();
    if (value) setCanvasTitle(value);
    else setEditingTitleValue(canvasTitle);
    setIsEditingTitle(false);
  };
  const titleKeyDown = (event: ReactTypes.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      titleFinished.current = true;
      setEditingTitleValue(canvasTitle);
      setIsEditingTitle(false);
    }
  };
  const startRename = () => {
    titleFinished.current = false;
    setEditingTitleValue(canvasTitle);
    setIsEditingTitle(true);
  };
  const save = async (exit = false) => {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError('');
    setMenuOpen(false);
    const owner = lifetime.current;
    try {
      const result = await live.current.onSave();
      if (owner !== lifetime.current) return;
      if (exit) {
        const titleDraft =
          live.current.isEditingTitle &&
          live.current.editingTitleValue.trim() !== live.current.canvasTitle;
        if (!result || result.unchanged === false || titleDraft) {
          setError('还有编辑尚未保存，请保存后再退出');
          return;
        }
        live.current.onBack?.();
      }
    } catch (cause) {
      if (owner === lifetime.current)
        setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      if (owner === lifetime.current) {
        savingNow.current = false;
        setSaving(false);
      }
    }
  };
  const leave = () => {
    setMenuOpen(false);
    live.current.onBack?.();
  };
  React.useLayoutEffect(() => {
    const owner = ++lifetime.current;
    savingNow.current = false;
    setSaving(false);
    titleFinished.current = false;
    setMenuOpen(false);
    setError('');
    return () => {
      lifetime.current = owner + 1;
    };
  }, [documentEpoch]);
  React.useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRoot.current?.contains(event.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);

  return (
    <React.Fragment>
      <div
        className={
          'af-canvas-header fixed top-0 left-0 h-14 flex items-center justify-between px-6 z-50 bg-[var(--af-surface)] border-b border-[var(--af-border)] pointer-events-none transition-all duration-300'
        }
        style={{
          width: isChatOpen ? `calc(100% - ${chatPanelWidth}px)` : '100%',
        }}
      >
        <div className={'flex items-center gap-3 pointer-events-auto'}>
          <div
            className={'relative'}
            ref={menuRoot}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                setMenuOpen(false);
                menuRoot.current?.querySelector('button')?.focus();
              }
            }}
            onBlur={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setMenuOpen(false);
            }}
          >
            <Tooltip text="项目菜单" position="bottom">
              <button
                type="button"
                aria-label="项目菜单"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
                className="p-0 bg-transparent border-none cursor-pointer"
              >
                <img
                  src="/aifisher-mark-white.svg"
                  alt="AIFISHER 画布 Logo"
                  className="w-8 h-8 rounded-md object-contain bg-[var(--af-surface)] transition-transform hover:scale-110"
                />
              </button>
            </Tooltip>
            {menuOpen && (
              <div
                className={
                  'absolute top-11 left-0 w-44 bg-[var(--af-input)] border border-[var(--af-border-control)] rounded-lg p-1.5 shadow-2xl z-[200]'
                }
              >
                <button
                  onClick={() => {
                    void save(true);
                  }}
                  disabled={saving}
                  className={
                    'w-full h-9 px-2.5 rounded-md text-left text-sm text-[var(--af-text)] hover:bg-[var(--af-surface-raised)] flex items-center gap-2'
                  }
                  type={'button'}
                >
                  <SaveIcon
                    size={14}
                    className={
                      hasUnsavedChanges
                        ? 'text-[var(--af-info)]'
                        : 'text-[var(--af-text-secondary)]'
                    }
                  />
                  {'保存退出'}
                </button>
                <button
                  onClick={() => {
                    void save();
                  }}
                  disabled={saving}
                  className={
                    'w-full h-9 px-2.5 rounded-md text-left text-sm text-[var(--af-text)] hover:bg-[var(--af-surface-raised)] flex items-center gap-2'
                  }
                  type={'button'}
                >
                  <SaveIcon
                    size={14}
                    className={
                      hasUnsavedChanges
                        ? 'text-[var(--af-info)]'
                        : 'text-[var(--af-text-secondary)]'
                    }
                  />
                  <span className={'flex-1'}>{'保存'}</span>
                  <span className={'text-[10px] text-[var(--af-text-muted)]'}>{'Ctrl+S'}</span>
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onImportProjectJson?.();
                  }}
                  className={
                    'w-full h-9 px-2.5 rounded-md text-left text-sm text-[var(--af-text)] hover:bg-[var(--af-surface-raised)] flex items-center gap-2'
                  }
                  type={'button'}
                >
                  <ImportIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                  {'导入项目 JSON'}
                </button>
                <button
                  onClick={leave}
                  className={
                    'w-full h-9 px-2.5 rounded-md text-left text-sm text-[var(--af-text)] hover:bg-[var(--af-surface-raised)] flex items-center gap-2'
                  }
                  type={'button'}
                >
                  <BackIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                  {'退出项目'}
                </button>
              </div>
            )}
          </div>
          {isEditingTitle ? (
            <input
              ref={canvasTitleInputRef}
              type={'text'}
              value={editingTitleValue}
              onChange={(participant) => setEditingTitleValue(participant.target.value)}
              onBlur={commitTitle}
              aria-label="项目名称"
              onKeyDown={titleKeyDown}
              className={
                'font-semibold text-[var(--af-text-secondary)] bg-transparent outline-none min-w-[100px]'
              }
            />
          ) : (
            <Tooltip text={'点击重命名'} position={'bottom'}>
              <span
                className={
                  'font-semibold cursor-pointer transition-colors text-[var(--af-text-secondary)] hover:text-[var(--af-text)]'
                }
                onClick={startRename}
              >
                {canvasTitle}
              </span>
            </Tooltip>
          )}
        </div>
        <div className={'flex items-center gap-2 pointer-events-auto'}>
          <div data-fisherai-account-center-slot={'true'} />
          <div
            className={
              'text-[10px] font-medium px-2 py-1 rounded-md border text-[var(--af-text-muted)] border-[var(--af-border)]'
            }
          >
            {saving
              ? '保存中…'
              : hasUnsavedChanges
                ? '未保存'
                : lastAutoSaveTime
                  ? 'Saved ' +
                    new Date(lastAutoSaveTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }) +
                    ' by ' +
                    lastSavedBy +
                    ' · r' +
                    String(lastSavedRevision ?? '--')
                  : '尚未保存'}
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          style={{ position: 'fixed', left: 24, top: 72, zIndex: 210, pointerEvents: 'none' }}
          className="fixed left-6 top-16 z-[210] rounded-md border border-[var(--af-danger)] bg-[var(--af-input)] px-3 py-2 text-xs text-[var(--af-danger)]"
        >
          {error}
        </div>
      )}
    </React.Fragment>
  );
}
