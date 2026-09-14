import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';
import { CanvasLibraryGrid } from './canvasLibraryGrid';
export { CanvasLibraryGrid } from './canvasLibraryGrid';
import './canvasLibrary.css';
import './canvasAnchoredPanel.css';

export type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useRef' | 'useEffect'
>;
export interface LibraryItem {
  id: string;
  name: string;
  category?: string;
  type?: string;
  url?: string;
  coverUrl?: string;
  ownership?: string;
  [key: string]: unknown;
}
type Icon = ReactTypes.ComponentType<{ size: number; className?: string; strokeWidth?: number }>;
export interface Icons {
  CloseIcon: Icon;
  DeleteIcon: Icon;
  ImageIcon: Icon;
  VideoIcon: Icon;
  AudioIcon: Icon;
  WorkflowIcon: Icon;
}
interface LibraryProps {
  isOpen: boolean;
  onClose(): void;
  panelY?: number;
  variant?: 'panel' | 'modal';
  onSelectAsset(item: LibraryItem): void;
}
interface CollectionState {
  epoch: number;
  assets: LibraryItem[];
  loading: boolean;
  deleting: string | null;
  saving: string | null;
  error: string;
}
const initial = (epoch: number): CollectionState => ({
  epoch,
  assets: [],
  loading: true,
  deleting: null,
  saving: null,
  error: '',
});

function useLibraryCollection(React: Runtime, isOpen: boolean, endpoint: string) {
  const [refreshIndex, setRefreshIndex] = React.useState(0);
  const key = JSON.stringify([isOpen, endpoint, refreshIndex]);
  const [scope, setScope] = React.useState({ key, epoch: 0 });
  if (scope.key !== key) setScope({ key, epoch: scope.epoch + 1 });
  const epoch = scope.epoch;
  const [stored, setStored] = React.useState<CollectionState>(() => initial(epoch));
  const actionsRef = React.useRef<{
    remove(id: string): Promise<boolean>;
    edit(id: string, fields: AssetFields): Promise<boolean>;
  }>({
    remove: async () => false,
    edit: async () => false,
  });
  React.useEffect(() => {
    if (!isOpen) return;
    let disposed = false,
      pending = true;
    const controllers = new Set<AbortController>();
    const active = () => !disposed;
    const update = (
      change: Partial<CollectionState> | ((state: CollectionState) => CollectionState),
    ) => {
      if (active())
        setStored((old) =>
          !active() || old.epoch !== epoch
            ? old
            : typeof change === 'function'
              ? change(old)
              : { ...old, ...change },
        );
    };
    const read = async <T,>(url: string, method = 'GET', body?: AssetFields): Promise<T> => {
      const controller = new AbortController();
      controllers.add(controller);
      let onAbort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(Error('操作未确认，请刷新列表核对。'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(url, {
              method,
              signal: controller.signal,
              ...(body
                ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
                : {}),
            });
            if (!response.ok)
              throw Error(
                method === 'DELETE'
                  ? '删除失败，请重试或刷新列表核对。'
                  : method === 'PATCH'
                    ? '保存失败，请重试或刷新列表核对。'
                    : '加载失败，请重试。',
              );
            return (await response.json()) as T;
          })(),
          aborted,
        ]);
      } finally {
        window.clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        controllers.delete(controller);
      }
    };
    setStored(initial(epoch));
    void read<LibraryItem[]>(endpoint)
      .then((assets) => {
        if (!Array.isArray(assets)) throw Error('列表格式不正确，请重试。');
        update({ assets });
      })
      .catch((error) => update({ error: error.message }))
      .finally(() => {
        pending = false;
        update({ loading: false });
      });
    actionsRef.current = {
      edit: async (id, fields) => {
        if (!active() || pending) return false;
        pending = true;
        update({ saving: id, error: '' });
        try {
          const receipt = await read<{ success?: boolean; asset?: LibraryItem }>(
            `${endpoint}/${encodeURIComponent(id)}`,
            'PATCH',
            fields,
          );
          if (!active()) return false;
          if (receipt.success !== true || receipt.asset?.id !== id)
            throw Error('未收到保存成功回执，请刷新列表核对。');
          update((old) => ({
            ...old,
            assets: old.assets.map((item) => (item.id === id ? receipt.asset! : item)),
          }));
          return true;
        } catch (error) {
          update({
            error: error instanceof Error ? error.message : '保存未确认，请刷新列表核对。',
          });
          return false;
        } finally {
          pending = false;
          update({ saving: null });
        }
      },
      remove: async (id) => {
        if (!active() || pending) return false;
        pending = true;
        update({ deleting: id, error: '' });
        try {
          const receipt = await read<{ success?: boolean }>(
            `${endpoint}/${encodeURIComponent(id)}`,
            'DELETE',
          );
          if (!active()) return false;
          if (receipt.success !== true) throw Error('未收到删除成功回执，请刷新列表核对。');
          update((old) => ({ ...old, assets: old.assets.filter((item) => item.id !== id) }));
          return true;
        } catch (error) {
          update({
            error: error instanceof Error ? error.message : '删除未确认，请刷新列表核对。',
          });
          return false;
        } finally {
          pending = false;
          update({ deleting: null });
        }
      },
    };
    return () => {
      disposed = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [isOpen, endpoint, epoch]);
  return {
    ...(stored.epoch === epoch ? stored : initial(epoch)),
    remove: (id: string) => actionsRef.current.remove(id),
    edit: (id: string, fields: AssetFields) => actionsRef.current.edit(id, fields),
    refresh: () => setRefreshIndex((value) => value + 1),
  };
}

export interface AssetFields {
  name: string;
  category: string;
  ownership: string;
}
export interface GridProps {
  selectedCategory: string;
  setSelectedCategory(category: string): void;
  assets: LibraryItem[];
  loading: boolean;
  deleting?: string | null;
  saving?: string | null;
  workflow?: boolean;
  onSelectAsset(item: LibraryItem): void;
  onDeleteAsset(id: string): Promise<boolean>;
  onEditAsset?(id: string, fields: AssetFields): Promise<boolean>;
}
function Library(React: Runtime, props: LibraryProps & { workflow?: boolean }, icons: Icons) {
  const {
    isOpen,
    onClose,
    onSelectAsset,
    panelY = 100,
    variant = 'panel',
    workflow = false,
  } = props;
  const [category, setCategory] = React.useState('All');
  const collection = useLibraryCollection(
    React,
    isOpen,
    workflow ? '/api/library/workflows' : '/api/library',
  );
  const close = React.useRef(onClose);
  close.current = onClose;
  const modalRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isOpen) return;
    if (variant === 'modal' && modalRef.current)
      return activateModal(modalRef.current, () => close.current());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) close.current();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [isOpen, variant]);
  if (!isOpen) return null;
  const { CloseIcon } = icons;
  const title = workflow ? 'SKILL 社区' : '资产库';
  const header = (
    <div
      data-fisherai-skill-community={workflow ? 'true' : undefined}
      className="flex items-start justify-between gap-4 p-4 border-b border-[var(--af-border)] shrink-0"
    >
      <div>
        <h2 className="text-base font-semibold text-[var(--af-text)]">{title}</h2>
        {!workflow && (
          <p className="text-xs text-[var(--af-text-secondary)] mt-1">
            按角色、场景与道具整理，点击素材添加到画布。
          </p>
        )}
        {workflow && (
          <p className="text-xs text-[var(--af-text-muted)] mt-1">
            本地 SKILL · 把常用画布组合沉淀为可复用能力
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={`关闭${workflow ? ' SKILL 社区' : '资产'}`}
        className="p-1.5 rounded-lg text-[var(--af-text-muted)] hover:text-[var(--af-text)] hover:bg-[var(--af-surface-raised)] transition-colors"
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
  const body = (
    <div className="fisher-library-body">
      {header}
      {collection.error && (
        <div role="alert" className="px-4 py-2 text-xs text-[var(--af-danger)]">
          {collection.error}
          <button className="ml-2 underline" onClick={collection.refresh}>
            刷新列表
          </button>
        </div>
      )}
      {React.createElement(Grid, {
        key: collection.epoch,
        React,
        icons,
        assets: collection.assets,
        loading: collection.loading,
        deleting: collection.deleting,
        saving: collection.saving,
        workflow,
        selectedCategory: category,
        setSelectedCategory: setCategory,
        onSelectAsset,
        onDeleteAsset: collection.remove,
        onEditAsset: workflow ? undefined : collection.edit,
      })}
    </div>
  );
  if (variant === 'modal')
    return (
      <div
        role="presentation"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--af-overlay)] backdrop-blur-sm"
        onClick={onClose}
        onWheel={(event) => event.stopPropagation()}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fisher-library-window fisher-library-modal"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') onClose();
          }}
        >
          {body}
        </div>
      </div>
    );
  return (
    <div
      role="region"
      aria-label={title}
      className="fisher-library-window fisher-library-panel fisher-canvas-anchored-panel"
      style={{ '--panel-anchor-y': `${panelY}px` } as ReactTypes.CSSProperties}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      {body}
    </div>
  );
}
function Grid(props: GridProps & { React: Runtime; icons: Icons }) {
  return CanvasLibraryGrid(props.React, props, props.icons);
}
export function CanvasAssetLibrary(React: Runtime, props: LibraryProps, icons: Icons) {
  return Library(React, props, icons);
}
export function CanvasWorkflowLibrary(
  React: Runtime,
  props: Omit<LibraryProps, 'onSelectAsset'> & { onSelectWorkflow(item: LibraryItem): void },
  icons: Icons,
) {
  return Library(React, { ...props, workflow: true, onSelectAsset: props.onSelectWorkflow }, icons);
}
