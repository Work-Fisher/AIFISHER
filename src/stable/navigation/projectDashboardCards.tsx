import type { DashboardRuntime, DashboardIcon } from './dashboardRuntime';
import type { DashboardProject, DashboardFolder } from './projectDashboardData';
import { useDashboardRename } from './dashboardRename';

export interface DashboardCardProps {
  onOpen(id: string): void;
  onMenu(event: React.MouseEvent, id: string): void;
  onRename(id: string, value: string): Promise<boolean>;
  isRenaming?: boolean;
  onRenameComplete(): void;
}
interface CardIcons {
  MoreIcon: DashboardIcon;
  RenameIcon: DashboardIcon;
  FolderIcon: DashboardIcon;
}
function relativeDate(value?: string) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  return seconds < 60
    ? '刚刚'
    : seconds < 3600
      ? Math.floor(seconds / 60) + ' 分钟前'
      : seconds < 86400
        ? Math.floor(seconds / 3600) + ' 小时前'
        : seconds < 2592000
          ? Math.floor(seconds / 86400) + ' 天前'
          : new Date(time).toLocaleDateString('zh-CN');
}
export function DashboardProjectCard(
  React: DashboardRuntime,
  props: DashboardCardProps & { project: DashboardProject },
  icons: CardIcons,
) {
  const { project, onOpen, onMenu } = props;
  const { MoreIcon, RenameIcon } = icons;
  const { editing, draft, setDraft, pending, input, startRename, commit, keyDown } =
    useDashboardRename(React, {
      ...props,
      id: project.id,
      label: project.title,
    });

  return (
    <div
      className={
        'group relative bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg p-2 hover:bg-[var(--af-surface-raised)] hover:border-[var(--af-border-control)] transition-all duration-300 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-black/40'
      }
      onClick={() => onOpen(project.id)}
    >
      <div className={'aspect-[4/3] bg-[var(--af-input)] rounded-md relative overflow-hidden mb-3'}>
        {project.coverUrl ? (
          <img
            src={project.coverUrl}
            alt={project.title}
            className={
              'w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out'
            }
            draggable={!1}
            onDragStart={(event) => event.preventDefault()}
          />
        ) : (
          <div
            className={
              'w-full h-full bg-gradient-to-br from-[#8a9ab0] via-[#5c6b8a] to-[#2d3748] flex items-center justify-center relative overflow-hidden'
            }
          >
            <div
              className={
                'absolute top-[-20%] right-[-10%] w-[80%] h-[80%] bg-[var(--af-info-bg)] blur-[60px] rounded-full'
              }
            />
            <div
              className={
                'absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] bg-[var(--af-info-bg)] blur-[50px] rounded-full'
              }
            />
          </div>
        )}
        <div
          className={'absolute inset-0 shadow-[inset_0_0_40px_rgba(0,0,0,0.2)] pointer-events-none'}
        />
        <button
          aria-label={`项目菜单：${project.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event, project.id);
          }}
          className={
            'absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-[var(--af-surface)] backdrop-blur-md rounded-full text-[var(--af-text)] opacity-0 group-hover:opacity-100 transition-all hover:bg-[var(--af-surface)] hover:text-[var(--af-text)]'
          }
        >
          <MoreIcon size={16} />
        </button>
      </div>
      <div className={'px-2 pb-2'}>
        <div className={'h-6 flex items-center mb-1'}>
          {editing ? (
            <input
              ref={input}
              aria-label="名称"
              aria-busy={pending}
              readOnly={pending}
              type={'text'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={keyDown}
              onClick={(event) => event.stopPropagation()}
              className={
                'w-full bg-[var(--af-surface-raised)] rounded px-1 text-[15px] font-bold text-[var(--af-text)] outline-none'
              }
            />
          ) : (
            <div
              className={'flex items-center justify-between group/title w-full cursor-text'}
              onClick={(event) => {
                event.stopPropagation();
                startRename();
              }}
            >
              <h3
                className={
                  'text-[15px] font-bold text-[var(--af-text)] truncate flex-1 group-hover:text-[var(--af-text)] transition-colors'
                }
              >
                {project.title}
              </h3>
              <RenameIcon
                size={12}
                className={
                  'text-[var(--af-text-muted)] opacity-0 group-hover/title:opacity-100 transition-opacity ml-2 shrink-0'
                }
              />
            </div>
          )}
        </div>
        <div className={'text-[12px] text-[var(--af-text-muted)] font-medium'}>
          {'编辑于 '}
          {relativeDate(project.updatedAt)}
        </div>
      </div>
    </div>
  );
}
export function DashboardFolderCard(
  React: DashboardRuntime,
  props: DashboardCardProps & {
    folder: DashboardFolder;
    projects: DashboardProject[];
  },
  icons: CardIcons,
) {
  const { folder, onOpen, onMenu } = props;
  const { MoreIcon, RenameIcon, FolderIcon } = icons;
  const { editing, draft, setDraft, pending, input, startRename, commit, keyDown } =
    useDashboardRename(React, {
      ...props,
      id: folder.id,
      label: folder.name,
    });
  const projectCount = props.projects.filter((project) => project.folderId === folder.id).length;
  return (
    <div
      className={
        'group relative bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg p-2 hover:bg-[var(--af-surface-raised)] hover:border-[var(--af-border-control)] transition-all duration-300 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-black/40'
      }
      onClick={() => onOpen(folder.id)}
    >
      <div
        className={
          'aspect-[4/3] rounded-md relative overflow-hidden mb-3 flex items-center justify-center'
        }
        style={{
          background:
            'linear-gradient(136deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%), rgb(29, 36, 42)',
        }}
      >
        <div
          className={
            'absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-105'
          }
          style={{ perspective: '600px' }}
        >
          <div
            className={'absolute w-[36%] left-[48%] top-[18%] z-30 transition-all duration-500'}
            style={{
              transform: 'rotate(15deg)',
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className={
                'w-full rounded-xl shadow-[-4px_4px_15px_rgba(0,0,0,0.5)] border border-[var(--af-border)] flex items-center justify-center'
              }
              style={{
                aspectRatio: '100 / 134',
                background: 'linear-gradient(180deg, #94a3b8 0%, #475569 100%)',
              }}
            >
              <FolderIcon size={18} className={'text-[var(--af-text)]'} />
            </div>
          </div>
          <div className={'absolute w-[36%] left-[32%] top-[15%] z-20 transition-all duration-500'}>
            <div
              className={
                'w-full rounded-xl shadow-[0_8px_20px_rgba(0,0,0,0.6)] border border-[var(--af-border)] flex items-center justify-center'
              }
              style={{
                aspectRatio: '100 / 134',
                background: 'linear-gradient(180deg, #cbd5e1 0%, #64748b 100%)',
              }}
            >
              <FolderIcon size={18} className={'text-[var(--af-text-muted)]'} />
            </div>
          </div>
          <div
            className={'absolute w-[36%] left-[16%] top-[18%] z-10 transition-all duration-500'}
            style={{
              transform: 'rotate(-15deg)',
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className={
                'w-full rounded-xl shadow-[4px_4px_15px_rgba(0,0,0,0.5)] border border-[var(--af-border)] flex items-center justify-center'
              }
              style={{
                aspectRatio: '100 / 134',
                background: 'linear-gradient(180deg, var(--af-primary) 0%, #64748b 100%)',
              }}
            >
              <FolderIcon size={18} className={'text-[var(--af-text-muted)]'} />
            </div>
          </div>
        </div>
        <button
          aria-label={`文件夹菜单：${folder.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event, folder.id);
          }}
          className={
            'absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-[var(--af-surface)] backdrop-blur-md rounded-full text-[var(--af-text)] opacity-0 group-hover:opacity-100 transition-all hover:bg-[var(--af-surface)] hover:text-[var(--af-text)]'
          }
        >
          <MoreIcon size={16} />
        </button>
      </div>
      <div className={'px-2 pb-2'}>
        <div className={'h-6 flex items-center mb-1'}>
          {editing ? (
            <input
              ref={input}
              aria-label="名称"
              aria-busy={pending}
              readOnly={pending}
              type={'text'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={keyDown}
              onClick={(event) => event.stopPropagation()}
              className={
                'w-full bg-[var(--af-surface-raised)] rounded px-1 text-[15px] font-bold text-[var(--af-text)] outline-none'
              }
            />
          ) : (
            <div
              className={'flex items-center justify-between group/title w-full cursor-text'}
              onClick={(event) => {
                event.stopPropagation();
                startRename();
              }}
            >
              <h3
                className={
                  'text-[15px] font-bold text-[var(--af-text)] truncate flex-1 group-hover:text-[var(--af-text)] transition-colors'
                }
              >
                {folder.name}
              </h3>
              <RenameIcon
                size={12}
                className={
                  'text-[var(--af-text-muted)] opacity-0 group-hover/title:opacity-100 transition-opacity ml-2 shrink-0'
                }
              />
            </div>
          )}
        </div>
        <div
          className={
            'flex items-center justify-between text-[12px] text-[var(--af-text-muted)] font-medium'
          }
        >
          <div className={'flex items-center gap-2'}>
            <FolderIcon size={12} className={'text-[var(--af-info)]'} />
            <span>
              {projectCount}
              {' 个项目'}
            </span>
          </div>
          <span>{relativeDate(folder.updatedAt)}</span>
        </div>
      </div>
      <div
        className={
          'absolute bottom-[-4px] left-[10%] right-[10%] h-[1px] bg-[var(--af-surface-raised)] rounded-full opacity-50'
        }
      />
    </div>
  );
}
