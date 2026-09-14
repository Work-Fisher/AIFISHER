import type * as ReactTypes from 'react';
import type { DashboardRuntime, DashboardIcon } from './dashboardRuntime';
import {
  createDashboardClient,
  dashboardBreadcrumb,
  visibleDashboard,
  type DashboardFilter,
  type DashboardSort,
  type DashboardOrder,
} from './projectDashboardData';
import { useProjectDashboard } from './useProjectDashboard';
import { useDashboardRename } from './dashboardRename';
import { activateModal } from '../design/modalFocus';
import type { DashboardHeaderProps } from './projectDashboardHeader';
import type { DashboardCardProps } from './projectDashboardCards';
import type { DashboardMenuProps } from './projectDashboardMenu';
import type { DashboardProject, DashboardFolder } from './projectDashboardData';
export interface ProjectDashboardProps {
  onOpenProject(id: string): void;
  onNewProject(folderId: string | null): void;
  initialFolderId?: string | null;
}
interface Components {
  DashboardHeader: ReactTypes.ComponentType<DashboardHeaderProps>;
  FolderCard: ReactTypes.ComponentType<
    DashboardCardProps & {
      folder: DashboardFolder;
      projects: DashboardProject[];
    }
  >;
  ProjectCard: ReactTypes.ComponentType<DashboardCardProps & { project: DashboardProject }>;
  ContextMenu: ReactTypes.ComponentType<DashboardMenuProps>;
  HomeIcon: DashboardIcon;
  AddIcon: DashboardIcon;
  FolderListIcon: DashboardIcon;
  MoreIcon: DashboardIcon;
  CloseIcon: DashboardIcon;
  FolderIcon: DashboardIcon;
  LoadingIcon: DashboardIcon;
}
interface Target {
  id: string;
  type: 'project' | 'folder';
}
interface ModalProps {
  label: string;
  busy: boolean;
  onDismiss(): void;
  error: string;
  onRefresh(): Promise<boolean>;
  children: ReactTypes.ReactNode;
}
function DashboardModal(React: DashboardRuntime, props: ModalProps) {
  const surface = React.useRef<HTMLDivElement>(null),
    currentRef = React.useRef(props);
  currentRef.current = props;
  React.useEffect(() => {
    if (surface.current)
      return activateModal(surface.current, () => {
        if (!currentRef.current.busy) currentRef.current.onDismiss();
      });
  }, []);
  return (
    <div
      className="fixed inset-0 bg-[var(--af-overlay)] backdrop-blur-sm flex items-center justify-center z-[110]"
      style={{ zIndex: 210 }}
    >
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        style={{
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100dvh - 32px)',
          overflow: 'auto',
        }}
      >
        <fieldset disabled={props.busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {props.children}
        </fieldset>
        {props.busy && (
          <p role="status" style={{ background: 'var(--af-surface-raised)', padding: 12 }}>
            正在处理…
          </p>
        )}
        {props.error && (
          <div
            role="alert"
            style={{
              background: 'var(--af-surface-raised)',
              color: 'var(--af-danger)',
              padding: 12,
            }}
          >
            {props.error}{' '}
            <button disabled={props.busy} onClick={() => void props.onRefresh()}>
              刷新列表
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
export function ProjectDashboard(
  React: DashboardRuntime,
  props: ProjectDashboardProps,
  components: Components,
) {
  const { onOpenProject, onNewProject, initialFolderId = null } = props;
  const {
    DashboardHeader,
    FolderCard,
    ProjectCard,
    ContextMenu,
    HomeIcon,
    AddIcon,
    FolderListIcon,
    MoreIcon,
    CloseIcon,
    FolderIcon,
    LoadingIcon,
  } = components;
  const client = React.useMemo(() => createDashboardClient(), []);
  const { projects, folders, setData, loading, loaded, busy, error, refresh, mutate } =
    useProjectDashboard(React, client);
  const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid'),
    [searchQuery, setSearchQuery] = React.useState(''),
    [filter, setFilter] = React.useState<DashboardFilter>('all'),
    [sort, setSort] = React.useState<DashboardSort>('recent'),
    [sortOrder, setSortOrder] = React.useState<DashboardOrder>('newest'),
    [folderId, setFolderId] = React.useState(initialFolderId);
  const [contextMenu, setContextMenu] = React.useState<(Target & { x: number; y: number }) | null>(
      null,
    ),
    [renaming, setRenaming] = React.useState<Target | null>(null),
    [moveProjectId, setMoveProjectId] = React.useState<string | null>(null),
    [deleteTarget, setDeleteTarget] = React.useState<
      (Target & { isOpen: boolean; name: string }) | null
    >(null),
    [cleanupPreview, setCleanupPreview] = React.useState<{
      id: string;
      files: string[];
    } | null>(null),
    [cleaningProjectId, setCleaningProjectId] = React.useState<string | null>(null);
  const currentFolderRef = React.useRef(folderId);
  currentFolderRef.current = folderId;
  const aliveRef = React.useRef(false);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (loaded && folderId && !folders.some((folder) => folder.id === folderId)) setFolderId(null);
  }, [loaded, folders, folderId]);
  const breadcrumbs = dashboardBreadcrumb(folders, folderId),
    { folders: visibleFolders, projects: visibleProjects } = visibleDashboard(
      { projects, folders },
      folderId,
      searchQuery,
      filter,
      sort,
      sortOrder,
    );
  const createFolder = () => {
    const parentId = folderId;
    return mutate(
      (signal) => client.createFolder(parentId, signal),
      (folder) => {
        setData((data) => ({
          ...data,
          folders: [...data.folders.filter((item) => item.id !== folder.id), folder],
        }));
        if (currentFolderRef.current === parentId) {
          setSearchQuery('');
          setFilter('all');
          setRenaming({ id: folder.id, type: 'folder' });
        }
      },
    );
  };
  const renameFolder = (id: string, name: string) => {
    const folder = folders.find((item) => item.id === id);
    if (!folder) return Promise.resolve(false);
    return mutate(
      (signal) => client.renameFolder(folder, name, signal),
      () =>
        setData((data) => ({
          ...data,
          folders: data.folders.map((item) => (item.id === id ? { ...item, name } : item)),
        })),
    );
  };
  const renameProject = (id: string, title: string) =>
    mutate(
      (signal) => client.renameProject(id, title, signal),
      () =>
        setData((data) => ({
          ...data,
          projects: data.projects.map((item) => (item.id === id ? { ...item, title } : item)),
        })),
    );
  const deleteProject = (id: string) =>
    mutate(
      (signal) => client.deleteProject(id, signal),
      () => {
        setDeleteTarget(null);
        setData((data) => ({
          ...data,
          projects: data.projects.filter((item) => item.id !== id),
        }));
      },
    );
  const deleteFolder = (id: string) =>
    mutate(
      (signal) => client.deleteFolder(id, signal),
      () => {
        setDeleteTarget(null);
        setData((data) => ({
          projects: data.projects.map((item) =>
            item.folderId === id ? { ...item, folderId: null } : item,
          ),
          folders: data.folders.filter((item) => item.id !== id),
        }));
      },
    );
  const moveProject = (id: string, target: string | null) =>
    mutate(
      (signal) => client.moveProject(id, target, signal),
      () => {
        setMoveProjectId(null);
        setData((data) => ({
          ...data,
          projects: data.projects.map((item) =>
            item.id === id ? { ...item, folderId: target } : item,
          ),
        }));
      },
    );
  const cleanupProject = async (id: string, confirmed = false) => {
    if (busy) return;
    setCleaningProjectId(id);
    await mutate(
      (signal) =>
        confirmed ? client.cleanupProject(id, signal) : client.previewCleanup(id, signal),
      (result) => {
        if (confirmed) setCleanupPreview(null);
        else setCleanupPreview({ id, files: result as string[] });
      },
      false,
    );
    if (aliveRef.current) setCleaningProjectId(null);
  };
  const moveSourceFolder =
    projects.find((project) => project.id === moveProjectId)?.folderId || null;
  const RenameLabel = React.useMemo(
    () => (props: Parameters<typeof DashboardRename>[1]) => DashboardRename(React, props),
    [React],
  );
  const Modal = React.useMemo(() => (props: ModalProps) => DashboardModal(React, props), [React]);
  const StatusMessage = () => (
    <div role="alert" style={{ color: 'var(--af-danger)', padding: '8px 0', fontSize: 13 }}>
      {error}{' '}
      <button disabled={busy || loading} onClick={() => void refresh()}>
        刷新列表
      </button>
    </div>
  );
  return (
    <div className={'min-h-screen bg-[var(--af-input)] text-[var(--af-text)] flex flex-col'}>
      <DashboardHeader
        viewMode={viewMode}
        setViewMode={setViewMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filter={filter}
        setFilter={setFilter}
        sort={sort}
        setSort={setSort}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        onNewProject={() => onNewProject(folderId)}
        onNewFolder={() => void createFolder()}
        busy={busy}
      />
      <main aria-busy={loading || busy} className={'flex-1 p-8 max-w-[1600px] mx-auto w-full'}>
        <div className={'flex items-center gap-2 mb-8 text-[17px]'}>
          <button
            onClick={() => setFolderId(null)}
            className={`flex items-center gap-2 transition-colors hover:text-[var(--af-text)] font-bold ${folderId ? 'text-[var(--af-text-muted)]' : 'text-[var(--af-text)]'}`}
          >
            <HomeIcon size={18} className={'transition-colors'} />
            <span>{'项目'}</span>
          </button>
          {breadcrumbs.map((item, value) => (
            <React.Fragment key={item.id}>
              <span className={'text-[var(--af-text-muted)] mx-1'}>{'/'}</span>
              <button
                onClick={() => setFolderId(item.id)}
                className={`transition-colors hover:text-[var(--af-text)] font-bold ${value === breadcrumbs.length - 1 ? 'text-[var(--af-text)]' : 'text-[var(--af-text-muted)]'}`}
              >
                {item.name}
                {value === breadcrumbs.length - 1 && (
                  <span className={'text-[var(--af-text-muted)] text-sm font-normal ml-2'}>
                    {'('}
                    {projects.filter((candidate) => candidate.folderId === item.id).length}
                    {')'}
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
        {!moveProjectId && !deleteTarget && !cleanupPreview && !cleaningProjectId && error && (
          <StatusMessage />
        )}
        {loading && (
          <p role="status" className="text-sm text-[var(--af-text-secondary)]">
            正在读取项目…
          </p>
        )}
        {viewMode === 'grid' ? (
          <div className={'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6'}>
            <div
              onClick={() => onNewProject(folderId)}
              className={
                'group relative bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg p-2 hover:bg-[var(--af-surface-raised)] hover:border-[var(--af-border-control)] transition-all duration-300 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-black/40 overflow-hidden'
              }
            >
              <div
                className={
                  'aspect-[4/3] border-2 border-dashed border-[var(--af-border)] rounded-md flex flex-col items-center justify-center gap-4 group-hover:border-[var(--af-border-control)] group-hover:bg-[var(--af-input)] transition-all duration-300'
                }
              >
                <div
                  className={
                    'w-14 h-14 rounded-full bg-[var(--af-primary)] flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg'
                  }
                >
                  <AddIcon size={30} className={'text-[var(--af-on-primary)]'} strokeWidth={2.5} />
                </div>
              </div>
              <div className={'px-2 pb-2 mt-3'}>
                <h3
                  className={
                    'text-[15px] font-bold text-[var(--af-text-secondary)] group-hover:text-[var(--af-text)] transition-colors'
                  }
                >
                  {'新建项目'}
                </h3>
                <div className={'text-[12px] text-[var(--af-text-muted)] font-medium'}>
                  {folderId ? '在此文件夹中创建' : '开始新的创作'}
                </div>
              </div>
            </div>
            {visibleFolders.map((item) => (
              <FolderCard
                folder={item}
                projects={projects}
                onOpen={setFolderId}
                onMenu={(value, candidate) =>
                  setContextMenu({
                    x: value.clientX,
                    y: value.clientY,
                    type: 'folder',
                    id: candidate,
                  })
                }
                onRename={renameFolder}
                isRenaming={
                  (renaming == null ? void 0 : renaming.id) === item.id &&
                  (renaming == null ? void 0 : renaming.type) === 'folder'
                }
                onRenameComplete={() => setRenaming(null)}
                key={item.id}
              />
            ))}
            {visibleProjects.map((item) => (
              <ProjectCard
                project={item}
                onOpen={onOpenProject}
                onMenu={(value, candidate) =>
                  setContextMenu({
                    x: value.clientX,
                    y: value.clientY,
                    type: 'project',
                    id: candidate,
                  })
                }
                onRename={renameProject}
                isRenaming={
                  (renaming == null ? void 0 : renaming.id) === item.id &&
                  (renaming == null ? void 0 : renaming.type) === 'project'
                }
                onRenameComplete={() => setRenaming(null)}
                key={item.id}
              />
            ))}
          </div>
        ) : (
          <div
            className={
              'w-full bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg overflow-hidden'
            }
          >
            <table className={'w-full text-left border-collapse'}>
              <thead>
                <tr
                  className={
                    'border-b border-[var(--af-border)] text-[var(--af-text-muted)] text-xs uppercase tracking-wider'
                  }
                >
                  <th className={'pl-8 pr-2 py-4 font-medium w-32'}>{'预览'}</th>
                  <th className={'px-2 py-4 font-medium'}>{'名称'}</th>
                  <th className={'px-6 py-4 font-medium'}>{'类型'}</th>
                  <th className={'px-6 py-4 font-medium'}>{'内容'}</th>
                  <th className={'px-6 py-4 font-medium'}>{'创建时间'}</th>
                  <th className={'px-6 py-4 font-medium'}>{'最近更新'}</th>
                </tr>
              </thead>
              <tbody className={'divide-y divide-[var(--af-border)]'}>
                {visibleFolders.map((item) => (
                  <tr
                    className={'hover:bg-[var(--af-input)] transition-colors cursor-pointer group'}
                    onClick={() => setFolderId(item.id)}
                    key={item.id}
                  >
                    <td className={'pl-8 pr-2 py-3'}>
                      <div
                        className={
                          'w-20 h-14 rounded-lg bg-[var(--af-info-bg)] flex items-center justify-center text-[var(--af-info)] shadow-inner'
                        }
                      >
                        <FolderListIcon size={24} />
                      </div>
                    </td>
                    <td className={'px-2 py-3'}>
                      <div className={'flex items-center justify-between group/name'}>
                        <RenameLabel
                          id={item.id}
                          label={item.name}
                          isRenaming={renaming?.id === item.id && renaming.type === 'folder'}
                          onRename={renameFolder}
                          onRenameComplete={() => setRenaming(null)}
                        />
                        <button
                          aria-label={
                            '更多操作：' + ('title' in item ? String(item.title) : item.name)
                          }
                          onClick={(value) => {
                            value.stopPropagation();
                            setContextMenu({
                              x: value.clientX,
                              y: value.clientY,
                              type: 'folder',
                              id: item.id,
                            });
                          }}
                          className={
                            'p-1 text-[var(--af-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity'
                          }
                        >
                          <MoreIcon size={14} />
                        </button>
                      </div>
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {'文件夹'}
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {item.projectCount || 0}
                      {' 个项目'}
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {new Date(item.createdAt || 0).toLocaleString('zh-CN', {
                        hour12: !1,
                      })}
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {'编辑于 '}
                      {new Date(item.updatedAt || 0).toLocaleDateString('zh-CN')}
                    </td>
                  </tr>
                ))}
                {visibleProjects.map((item) => (
                  <tr
                    className={'hover:bg-[var(--af-input)] transition-colors cursor-pointer group'}
                    onClick={() => onOpenProject(item.id)}
                    key={item.id}
                  >
                    <td className={'pl-8 pr-2 py-3'}>
                      <div
                        className={
                          'w-20 h-14 rounded-lg bg-[var(--af-input)] overflow-hidden shadow-lg border border-[var(--af-border)]'
                        }
                      >
                        {item.coverUrl ? (
                          <img
                            src={item.coverUrl}
                            className={'w-full h-full object-cover'}
                            draggable={!1}
                            onDragStart={(value) => value.preventDefault()}
                          />
                        ) : (
                          <div
                            className={
                              'w-full h-full bg-gradient-to-br from-[#8a9ab0] via-[#5c6b8a] to-[#2d3748] flex items-center justify-center relative overflow-hidden'
                            }
                          >
                            <div
                              className={
                                'absolute top-[-20%] right-[-10%] w-[80%] h-[80%] bg-[var(--af-info-bg)] blur-[30px] rounded-full'
                              }
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className={'px-2 py-3'}>
                      <div className={'flex items-center justify-between group/name'}>
                        <RenameLabel
                          id={item.id}
                          label={item.title}
                          isRenaming={renaming?.id === item.id && renaming.type === 'project'}
                          onRename={renameProject}
                          onRenameComplete={() => setRenaming(null)}
                        />
                        <button
                          aria-label={'更多操作：' + item.title}
                          onClick={(value) => {
                            value.stopPropagation();
                            setContextMenu({
                              x: value.clientX,
                              y: value.clientY,
                              type: 'project',
                              id: item.id,
                            });
                          }}
                          className={
                            'p-1 text-[var(--af-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity'
                          }
                        >
                          <MoreIcon size={14} />
                        </button>
                      </div>
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {'项目'}
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {item.nodeCount || 0}
                      {' 个节点'}
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {new Date(item.createdAt || 0).toLocaleString('zh-CN', {
                        hour12: !1,
                      })}
                    </td>
                    <td className={'px-6 py-3 text-sm text-[var(--af-text-secondary)]'}>
                      {'编辑于 '}
                      {new Date(item.updatedAt || 0).toLocaleDateString('zh-CN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          onClose={() => setContextMenu(null)}
          onOpen={() =>
            contextMenu.type === 'project'
              ? onOpenProject(contextMenu.id)
              : setFolderId(contextMenu.id)
          }
          onRename={() => {
            setRenaming({ id: contextMenu.id, type: contextMenu.type });
            setContextMenu(null);
          }}
          onDelete={() => {
            const item =
              contextMenu.type === 'project'
                ? projects.find((value) => value.id === contextMenu.id)
                : folders.find((value) => value.id === contextMenu.id);
            if (item) {
              setDeleteTarget({
                isOpen: !0,
                type: contextMenu.type,
                id: contextMenu.id,
                name: String(contextMenu.type === 'project' ? item.title : item.name),
              });
            }
          }}
          onMove={contextMenu.type === 'project' ? () => setMoveProjectId(contextMenu.id) : void 0}
          onCleanup={contextMenu.type === 'project' ? () => cleanupProject(contextMenu.id) : void 0}
        />
      )}
      {moveProjectId && (
        <Modal
          label="移动至"
          busy={busy}
          onDismiss={() => {
            setMoveProjectId(null);
          }}
          error={error}
          onRefresh={refresh}
        >
          <div
            className={
              'bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg p-6 w-[450px] shadow-2xl animate-in zoom-in duration-200'
            }
          >
            <div className={'flex items-center justify-between mb-6'}>
              <h3 className={'text-xl font-bold text-[var(--af-text)]'}>{'移动至...'}</h3>
              <button
                onClick={() => setMoveProjectId(null)}
                className={
                  'text-[var(--af-text-muted)] hover:text-[var(--af-text)] transition-colors'
                }
              >
                <CloseIcon size={20} />
              </button>
            </div>
            <div className={'space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar'}>
              <button
                onClick={() => moveProject(moveProjectId, null)}
                className={`w-full flex items-center justify-between p-4 rounded-lg transition-all border ${moveSourceFolder === null ? 'bg-[var(--af-info-bg)] border-[var(--af-info)] text-[var(--af-info)]' : 'bg-[var(--af-surface-raised)] border-transparent hover:bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)]'}`}
              >
                <div className={'flex items-center gap-3'}>
                  <HomeIcon size={18} />
                  <span className={'font-medium'}>{'项目主页'}</span>
                </div>
                {moveSourceFolder === null && (
                  <div className={'w-2 h-2 rounded-full bg-[var(--af-info-bg)]'} />
                )}
              </button>
              <div className={'h-px bg-[var(--af-surface-raised)] my-2 mx-1'} />
              {folders.length === 0 ? (
                <div className={'text-center py-8 text-[var(--af-text-muted)] text-sm'}>
                  {'暂无文件夹'}
                </div>
              ) : (
                folders.map((item) => {
                  return (
                    <button
                      onClick={() => moveProject(moveProjectId, item.id)}
                      className={`w-full flex items-center justify-between p-4 rounded-lg transition-all border ${moveSourceFolder === item.id ? 'bg-[var(--af-info-bg)] border-[var(--af-info)] text-[var(--af-info)]' : 'bg-[var(--af-surface-raised)] border-transparent hover:bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)]'}`}
                      key={item.id}
                    >
                      <div className={'flex items-center gap-3'}>
                        <FolderIcon size={18} className={'text-[var(--af-info)]'} />
                        <span className={'font-medium truncate max-w-[280px]'}>{item.name}</span>
                      </div>
                      {moveSourceFolder === item.id && (
                        <div className={'w-2 h-2 rounded-full bg-[var(--af-info-bg)]'} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
            <div className={'flex justify-end mt-8'}>
              <button
                onClick={() => setMoveProjectId(null)}
                className={
                  'px-6 py-2.5 rounded-lg bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] text-[var(--af-text)] text-sm font-bold transition-colors'
                }
              >
                {'取消'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          label="确认删除"
          busy={busy}
          onDismiss={() => {
            setDeleteTarget(null);
          }}
          error={error}
          onRefresh={refresh}
        >
          <div
            className={
              'bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg p-6 w-[400px] shadow-2xl animate-in zoom-in duration-200'
            }
          >
            <div className={'flex items-center justify-between mb-4'}>
              <h3 className={'text-xl font-bold text-[var(--af-text)]'}>{'确认删除'}</h3>
              <button
                onClick={() => setDeleteTarget(null)}
                className={
                  'text-[var(--af-text-muted)] hover:text-[var(--af-text)] transition-colors'
                }
              >
                <CloseIcon size={20} />
              </button>
            </div>
            <p className={'text-[var(--af-text-secondary)] text-sm mb-8 leading-relaxed'}>
              {'确定要删除'}
              {deleteTarget.type === 'project' ? '项目' : '文件夹'}{' '}
              <span className={'text-[var(--af-text)] font-bold'}>
                {'"'}
                {deleteTarget.name}
                {'"'}
              </span>
              {' 吗？ 此操作无法撤销。'}
            </p>
            <div className={'flex gap-3 justify-end'}>
              <button
                onClick={() => setDeleteTarget(null)}
                className={
                  'px-6 py-2.5 rounded-lg bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] text-[var(--af-text)] text-sm font-bold transition-colors'
                }
              >
                {'取消'}
              </button>
              <button
                onClick={() =>
                  deleteTarget.type === 'project'
                    ? deleteProject(deleteTarget.id)
                    : deleteFolder(deleteTarget.id)
                }
                className={
                  'px-6 py-2.5 rounded-lg bg-[var(--af-danger-bg)] hover:bg-[var(--af-danger-bg)] text-[var(--af-text)] text-sm font-bold transition-colors'
                }
              >
                {'删除'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {cleanupPreview && (
        <Modal
          label="确认清理冗余素材"
          busy={busy}
          onDismiss={() => {
            setCleanupPreview(null);
          }}
          error={error}
          onRefresh={refresh}
        >
          <div
            className={
              'bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg p-6 w-[500px] shadow-2xl animate-in zoom-in duration-200'
            }
          >
            <div className={'flex items-center justify-between mb-4'}>
              <h3 className={'text-xl font-bold text-[var(--af-text)]'}>{'确认清理冗余素材'}</h3>
              <button
                onClick={() => setCleanupPreview(null)}
                className={
                  'text-[var(--af-text-muted)] hover:text-[var(--af-text)] transition-colors'
                }
              >
                <CloseIcon size={20} />
              </button>
            </div>
            <p className={'text-[var(--af-text-secondary)] text-sm mb-4'}>
              {cleanupPreview.files.length
                ? '以下文件在当前画布中未被引用，确定要删除吗？'
                : '没有发现未引用的素材。'}
            </p>
            <div
              className={
                'bg-[var(--af-input)] rounded-lg p-4 mb-8 max-h-[300px] overflow-y-auto border border-[var(--af-border)] custom-scrollbar'
              }
            >
              <div className={'grid grid-cols-1 gap-1'}>
                {cleanupPreview.files.map((item, value) => (
                  <div
                    className={
                      'text-[12px] font-mono text-[var(--af-text-secondary)] flex items-center gap-2'
                    }
                    key={value}
                  >
                    <span
                      className={'w-1.5 h-1.5 rounded-full bg-[var(--af-danger-bg)] shrink-0'}
                    />
                    <span className={'truncate'}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={'flex gap-3 justify-end'}>
              <button
                onClick={() => setCleanupPreview(null)}
                className={
                  'px-6 py-2.5 rounded-lg bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] text-[var(--af-text)] text-sm font-bold transition-colors'
                }
              >
                {'取消'}
              </button>
              <button
                disabled={cleanupPreview.files.length === 0}
                onClick={() => cleanupProject(cleanupPreview.id, !0)}
                className={
                  'px-6 py-2.5 rounded-lg bg-[var(--af-info-bg)] hover:bg-[var(--af-info-bg)] text-[var(--af-text)] text-sm font-bold transition-colors shadow-lg shadow-blue-900/20'
                }
              >
                {'确认清理 ('}
                {cleanupPreview.files.length}
                {' 个文件)'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {cleaningProjectId && (
        <Modal
          label="正在检查素材"
          busy={busy}
          onDismiss={() => {}}
          error={error}
          onRefresh={refresh}
        >
          <div
            className={
              'bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg p-8 flex flex-col items-center gap-4 shadow-2xl'
            }
          >
            <LoadingIcon size={40} className={'text-[var(--af-info)] animate-spin'} />
            <div className={'text-[var(--af-text)] font-bold'}>
              {'正在清理项目中未使用的素材...'}
            </div>
            <div className={'text-[var(--af-text-muted)] text-sm'}>
              {'请稍候，这可能需要一点时间'}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DashboardRename(React: DashboardRuntime, props: Parameters<typeof useDashboardRename>[1]) {
  const rename = useDashboardRename(React, props);
  return rename.editing ? (
    <input
      ref={rename.input}
      value={rename.draft}
      readOnly={rename.pending}
      aria-label="名称"
      aria-busy={rename.pending}
      className="w-full bg-[var(--af-surface-raised)] rounded px-1 text-sm text-[var(--af-text)] outline-none"
      onChange={(event) => rename.setDraft(event.target.value)}
      onBlur={() => void rename.commit()}
      onKeyDown={rename.keyDown}
      onClick={(event) => event.stopPropagation()}
    />
  ) : (
    <span className="text-sm font-medium text-[var(--af-text)]">{props.label}</span>
  );
}
