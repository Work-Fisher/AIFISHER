import type * as ReactTypes from 'react';
import type { DashboardRuntime, DashboardIcon } from './dashboardRuntime';
export interface DashboardMenuProps {
  x: number;
  y: number;
  type: 'project' | 'folder';
  onClose(): void;
  onOpen(): void;
  onRename(): void;
  onDelete(): void;
  onMove?: () => void;
  onCleanup?: () => void;
}
interface Icons {
  OpenIcon: DashboardIcon;
  RenameIcon: DashboardIcon;
  MoveIcon: DashboardIcon;
  CleanupIcon: DashboardIcon;
  DeleteIcon: DashboardIcon;
}
export function ProjectDashboardMenu(
  React: DashboardRuntime,
  props: DashboardMenuProps,
  icons: Icons,
) {
  const { x, y, type, onClose, onOpen, onRename, onDelete, onMove, onCleanup } = props;
  const { OpenIcon, RenameIcon, MoveIcon, CleanupIcon, DeleteIcon } = icons;
  const root = React.useRef<HTMLDivElement>(null),
    [position, setPosition] = React.useState({ left: x, top: y }),
    currentRef = React.useRef(props);
  currentRef.current = props;
  React.useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const bounds = () => {
      const rect = node.getBoundingClientRect();
      setPosition({
        left: Math.max(12, Math.min(x, window.innerWidth - rect.width - 12)),
        top: Math.max(12, Math.min(y, window.innerHeight - rect.height - 12)),
      });
    };
    bounds();
    node.querySelector('button')?.focus();
    window.addEventListener('resize', bounds);
    return () => window.removeEventListener('resize', bounds);
  }, [x, y]);
  React.useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) currentRef.current.onClose();
    };
    const blur = () => currentRef.current.onClose();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const keyDown = (event: ReactTypes.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll('button') || []),
        index = items.indexOf(document.activeElement as HTMLButtonElement);
      const target =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[target]?.focus();
    }
  };
  return (
    <div
      ref={root}
      className={
        'fixed z-[100] w-48 bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg shadow-2xl py-2'
      }
      role="menu"
      aria-label="项目操作"
      onKeyDown={keyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
      }}
      style={{
        left: position.left,
        top: position.top,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100dvh - 24px)',
        overflowY: 'auto',
      }}
    >
      <button
        role="menuitem"
        onClick={() => {
          onOpen();
          onClose();
        }}
        className={
          'w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)] transition-colors'
        }
      >
        <OpenIcon size={16} />
        {'打开'}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onRename();
          onClose();
        }}
        className={
          'w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)] transition-colors'
        }
      >
        <RenameIcon size={16} />
        {'重命名'}
      </button>
      {type === 'project' && onMove && (
        <button
          role="menuitem"
          onClick={() => {
            onMove();
            onClose();
          }}
          className={
            'w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)] transition-colors'
          }
        >
          <MoveIcon size={16} />
          {'移动至'}
        </button>
      )}
      {type === 'project' && onCleanup && (
        <button
          role="menuitem"
          onClick={() => {
            onCleanup();
            onClose();
          }}
          className={
            'w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)] transition-colors'
          }
        >
          <CleanupIcon size={16} className={'text-[var(--af-info)]'} />
          {'清理未用'}
        </button>
      )}
      <div className={'h-[1px] bg-[var(--af-surface-raised)] my-1 mx-2'} />
      <button
        role="menuitem"
        onClick={() => {
          onDelete();
          onClose();
        }}
        className={
          'w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--af-danger)] hover:bg-[var(--af-danger-bg)] transition-colors'
        }
      >
        <DeleteIcon size={16} />
        {'删除'}
      </button>
    </div>
  );
}
