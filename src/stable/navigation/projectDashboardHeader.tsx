import type * as ReactTypes from 'react';
import type { DashboardRuntime, DashboardIcon } from './dashboardRuntime';
import type { DashboardFilter, DashboardSort, DashboardOrder } from './projectDashboardData';
import { desktopBridge } from '../desktop/desktopBridge';
export interface DashboardHeaderProps {
  viewMode: 'grid' | 'list';
  setViewMode(value: 'grid' | 'list'): void;
  searchQuery: string;
  setSearchQuery(value: string): void;
  filter: DashboardFilter;
  setFilter(value: DashboardFilter): void;
  sort: DashboardSort;
  setSort(value: DashboardSort): void;
  sortOrder: DashboardOrder;
  setSortOrder(value: DashboardOrder): void;
  onNewProject(): void;
  onNewFolder(): void;
  busy?: boolean;
}
export interface DashboardHeaderIcons {
  SearchIcon: DashboardIcon;
  ChevronIcon: DashboardIcon;
  CheckIcon: DashboardIcon;
  GridIcon: DashboardIcon;
  ListIcon: DashboardIcon;
  FolderAddIcon: DashboardIcon;
  AddIcon: DashboardIcon;
  versionInfo: { version: string };
}
export function ProjectDashboardHeader(
  React: DashboardRuntime,
  props: DashboardHeaderProps,
  icons: DashboardHeaderIcons,
) {
  const {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    sort,
    setSort,
    sortOrder,
    setSortOrder,
    onNewProject,
    onNewFolder,
    busy,
  } = props;
  const {
    SearchIcon,
    ChevronIcon,
    CheckIcon,
    GridIcon,
    ListIcon,
    FolderAddIcon,
    AddIcon,
    versionInfo,
  } = icons;
  const desktop = desktopBridge();
  const [switching, setSwitching] = React.useState(false);
  const [workspaceError, setWorkspaceError] = React.useState('');
  const switchWorkspace = async () => {
    if (switching || document.documentElement.dataset.aifisherUpdateApplying === 'true') return;
    setSwitching(true);
    setWorkspaceError('');
    try { await desktop?.switchWorkspace?.(); }
    catch { setWorkspaceError('工作区未切换，原项目仍保留。'); }
    finally { setSwitching(false); }
  };
  const [menuOpen, setMenuOpen] = React.useState(false),
    menuRoot = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  const menuKeyDown = (event: ReactTypes.KeyboardEvent) => {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      menuRoot.current?.querySelector('button')?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(menuRoot.current?.querySelectorAll('button') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[
        (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    }
  };
  const filterLabel = () =>
    filter === 'folders' ? '仅文件夹' : filter === 'projects' ? '仅项目' : '显示全部';
  return (
    <div
      className={
        'h-20 flex items-center justify-between px-8 bg-[var(--af-surface)] backdrop-blur-xl border-b border-[var(--af-border)] sticky top-0 z-40'
      }
    >
      <div className={'flex items-center gap-8'}>
        <div className={'flex items-center gap-2.5'} style={{ marginLeft: '-8px' }}>
          <img
            src={'/aifisher-mark-white.svg'}
            alt={'AIFISHER 画布 Logo'}
            className={'w-7 h-9 object-contain shrink-0'}
          />
          <div className={'flex flex-col justify-center'}>
            <h1
              className={
                'text-[17px] font-semibold text-[var(--af-text)] tracking-[0.035em] leading-none whitespace-nowrap'
              }
            >
              {'AIFISHER 画布'}
            </h1>
            <span
              className={
                'text-[10px] font-medium text-[var(--af-text-muted)] mt-1 tracking-[0.08em] leading-none'
              }
            >
              {'v'}
              {versionInfo.version}
            </span>
          </div>
        </div>
      </div>
      <div className={'flex items-center gap-4'}>
        <div data-fisherai-feedback-center-slot="true" />
        <div className={'relative group'}>
          <SearchIcon
            className={
              'absolute left-3 top-1/2 -translate-y-1/2 text-[var(--af-text-muted)] group-focus-within:text-[var(--af-text)]'
            }
            size={18}
          />
          <input
            type={'text'}
            placeholder={'搜索工程...'}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className={
              'bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg pl-10 pr-4 py-2 w-32 text-sm text-[var(--af-text)] focus:outline-none focus:border-[var(--af-border-control)] transition-all focus:w-48'
            }
          />
        </div>
        <div
          className={'relative'}
          ref={menuRoot}
          onKeyDown={menuKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setMenuOpen(false);
          }}
        >
          <button
            aria-label="筛选与排序"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            className={`flex items-center gap-2 px-4 py-2 bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg text-sm font-medium transition-all hover:border-[var(--af-border-control)] ${menuOpen ? 'text-[var(--af-text)] border-[var(--af-border-control)]' : 'text-[var(--af-text-secondary)]'}`}
          >
            <span>{filterLabel()}</span>
            <ChevronIcon
              size={14}
              className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {menuOpen && (
            <div
              className={
                'absolute right-0 mt-2 w-56 bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg shadow-2xl py-3 z-50 animate-in fade-in zoom-in duration-200'
              }
            >
              <div
                className={
                  'px-4 py-1 text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-wider'
                }
              >
                {'筛选'}
              </div>
              <button
                onClick={() => setFilter('all')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'显示全部'}</span>
                {filter === 'all' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
              <button
                onClick={() => setFilter('folders')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'仅文件夹'}</span>
                {filter === 'folders' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
              <button
                onClick={() => setFilter('projects')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'仅项目'}</span>
                {filter === 'projects' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
              <div className={'h-[1px] bg-[var(--af-surface-raised)] my-2 mx-3'} />
              <div
                className={
                  'px-4 py-1 text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-wider'
                }
              >
                {'排序方式'}
              </div>
              <button
                onClick={() => setSort('recent')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'按最近修改'}</span>
                {sort === 'recent' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
              <button
                onClick={() => setSort('created')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'按创建日期'}</span>
                {sort === 'created' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
              <div className={'h-[1px] bg-[var(--af-surface-raised)] my-2 mx-3'} />
              <div
                className={
                  'px-4 py-1 text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-wider'
                }
              >
                {'顺序'}
              </div>
              <button
                onClick={() => setSortOrder('newest')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'最新优先'}</span>
                {sortOrder === 'newest' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
              <button
                onClick={() => setSortOrder('oldest')}
                className={
                  'w-full flex items-center justify-between px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'
                }
              >
                <span>{'最早优先'}</span>
                {sortOrder === 'oldest' && (
                  <CheckIcon size={14} className={'text-[var(--af-text-secondary)]'} />
                )}
              </button>
            </div>
          )}
        </div>
        <div
          className={'flex bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg p-1'}
        >
          <button
            aria-label="网格视图"
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-[var(--af-surface-raised)] text-[var(--af-text)]' : 'text-[var(--af-text-muted)]'}`}
          >
            <GridIcon size={18} />
          </button>
          <button
            aria-label="列表视图"
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-[var(--af-surface-raised)] text-[var(--af-text)]' : 'text-[var(--af-text-muted)]'}`}
          >
            <ListIcon size={18} />
          </button>
        </div>
        <div className={'w-[1px] h-6 bg-[var(--af-surface-raised)] mx-2'} />
        <button
          aria-label="新建文件夹"
          disabled={busy}
          onClick={onNewFolder}
          className={
            'p-2 bg-[var(--af-input)] border border-[var(--af-border)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)] hover:border-[var(--af-border-control)] rounded-lg transition-all active:scale-95 shadow-lg'
          }
        >
          <FolderAddIcon size={20} />
        </button>
        {desktop?.switchWorkspace && <button type="button" disabled={busy || switching}
          onClick={() => void switchWorkspace()}
          className="px-3 py-2 rounded-lg border border-[var(--af-border)] text-[var(--af-text-secondary)] disabled:opacity-50">
          {switching ? '正在切换…' : '切换工作区'}
        </button>}
        {workspaceError && <span role="alert" className="text-xs text-[var(--af-danger)]">{workspaceError}</span>}

        <button
          onClick={onNewProject}
          className={
            'flex items-center gap-2 bg-[var(--af-input)] border border-[var(--af-border)] text-[var(--af-text-secondary)] px-4 py-2 rounded-lg font-medium hover:text-[var(--af-text)] hover:border-[var(--af-border-control)] transition-all active:scale-95 shadow-lg'
          }
        >
          <AddIcon size={18} />
          <span>{'新建项目'}</span>
        </button>
      </div>
    </div>
  );
}
