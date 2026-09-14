import type * as ReactTypes from 'react';
import './canvasAnchoredPanel.css';
type Runtime = Pick<typeof ReactTypes, 'createElement' | 'useState' | 'useRef' | 'useEffect'>;
type Kind = 'images' | 'videos' | 'audios';
interface Asset {
  id: string;
  url: string;
  filename?: string;
  createdAt?: string;
  prompt?: string;
  model?: string;
  mode?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
}
interface Props {
  isOpen: boolean;
  onClose(): void;
  panelY?: number;
  projectId?: string;
  onSelectAsset(
    kind: Kind,
    url: string,
    prompt: string,
    model?: string,
    mode?: string,
    aspectRatio?: string,
    resolution?: string,
    duration?: number,
  ): void;
}
type Icon = ReactTypes.ComponentType<{ size: number; className?: string }>;
interface Icons {
  ImageIcon: Icon;
  VideoIcon: Icon;
  AudioIcon: Icon;
  CloseIcon: Icon;
  DeleteIcon: Icon;
  Spinner: Icon;
}
interface Page {
  assets: Asset[];
  total: number;
  hasMore: boolean;
}
interface State {
  key: string;
  items: Asset[];
  counts: Record<Kind, number>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  deleting: string | null;
}
const kinds: Kind[] = ['images', 'videos', 'audios'];
const label = (kind: Kind) => (kind === 'images' ? '图片' : kind === 'videos' ? '视频' : '音频');
const initial = (key: string): State => ({
  key,
  items: [],
  counts: { images: 0, videos: 0, audios: 0 },
  loading: true,
  loadingMore: false,
  hasMore: false,
  error: '',
  deleting: null,
});
function projectScope(id?: string) {
  if (id) return id;
  const query = new URLSearchParams(window.location.search);
  return (
    query.get('projectId') ||
    query.get('id') ||
    window.location.pathname
      .split('/')
      .find((part) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part),
      ) ||
    'default'
  );
}

export function CanvasAssetHistory(React: Runtime, props: Props, icons: Icons) {
  const { isOpen, onClose, panelY = 200, onSelectAsset } = props;
  const [kind, setKind] = React.useState<Kind>('images'),
    [attempt, setAttempt] = React.useState(0);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const projectId = projectScope(props.projectId),
    key = JSON.stringify([isOpen, projectId, kind, attempt]);
  const [stored, setStored] = React.useState<State>(() => initial(key));
  const state = stored.key === key ? stored : initial(key);
  const currentKey = React.useRef(key),
    scrollRef = React.useRef<HTMLDivElement>(null),
    sentinelRef = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (!isOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [isOpen]);
  currentKey.current = key;
  const actions = React.useRef<{ more(): void; remove(id: string): void }>({
    more: () => {},
    remove: () => {},
  });
  React.useEffect(() => {
    if (!isOpen) return;
    let disposed = false,
      pagePending = false,
      mutationPending = false,
      offset = 0,
      hasMore = false;
    const controllers = new Set<AbortController>();
    const active = () => !disposed && currentKey.current === key;
    const update = (change: Partial<State> | ((old: State) => State)) => {
      if (active())
        setStored((old) =>
          !active() || old.key !== key
            ? old
            : typeof change === 'function'
              ? change(old)
              : { ...old, ...change },
        );
    };
    const read = async <T,>(url: string, method = 'GET'): Promise<T> => {
      const controller = new AbortController();
      controllers.add(controller);
      let cancel = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(Error('操作未确认，请刷新列表核对结果。'));
        controller.signal.addEventListener('abort', cancel, { once: true });
      });
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(url, { method, signal: controller.signal });
            const body = await response.json();
            if (!response.ok)
              throw Error(
                method === 'DELETE' ? '删除失败，请刷新后重试。' : '加载素材失败，请重试。',
              );
            return body as T;
          })(),
          cancelled,
        ]);
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancel);
        controllers.delete(controller);
      }
    };
    const url = (type: Kind, start: number, limit: number) =>
      `/api/assets/${type}?limit=${limit}&offset=${start}&projectId=${encodeURIComponent(projectId)}`;
    const load = async (first = false) => {
      if (!active() || pagePending || mutationPending || (!first && !hasMore)) return;
      pagePending = true;
      update({ error: '', loading: first, loadingMore: !first });
      try {
        const page = await read<Page>(url(kind, first ? 0 : offset, 20));
        if (!active()) return;
        if (!Array.isArray(page.assets)) throw Error('素材列表格式不正确，请重试。');
        offset = (first ? 0 : offset) + page.assets.length;
        hasMore = page.hasMore === true && page.assets.length > 0;
        update((old) => ({
          ...old,
          items: first
            ? page.assets
            : [
                ...new Map(
                  [...old.items, ...page.assets].map((asset) => [asset.id, asset]),
                ).values(),
              ],
          counts: { ...old.counts, [kind]: page.total },
          hasMore,
        }));
      } catch (error) {
        update({ error: error instanceof Error ? error.message : '加载素材失败，请重试。' });
      } finally {
        pagePending = false;
        update({ loading: false, loadingMore: false });
      }
    };
    const remove = async (id: string) => {
      if (!active() || pagePending || mutationPending) return;
      mutationPending = true;
      update({ deleting: id, error: '' });
      try {
        const result = await read<{ success?: boolean }>(
          `/api/assets/${kind}/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
          'DELETE',
        );
        if (!active()) return;
        if (result.success !== true) throw Error('未收到删除成功回执，请刷新列表核对。');
        offset = Math.max(0, offset - 1);
        update((old) => ({
          ...old,
          items: old.items.filter((asset) => asset.id !== id),
          counts: { ...old.counts, [kind]: Math.max(0, old.counts[kind] - 1) },
        }));
        setDeleteId(null);
      } catch (error) {
        update({ error: error instanceof Error ? error.message : '删除未确认，请刷新列表核对。' });
      } finally {
        mutationPending = false;
        update({ deleting: null });
      }
    };
    setStored(initial(key));
    setDeleteId(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    actions.current = {
      more: () => {
        void load();
      },
      remove: (id) => {
        void remove(id);
      },
    };
    void load(true);
    for (const type of kinds.filter((type) => type !== kind)) {
      void read<Page>(url(type, 0, 1))
        .then((page) =>
          update((old) => ({ ...old, counts: { ...old.counts, [type]: page.total } })),
        )
        .catch(() => {});
    }
    return () => {
      disposed = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [isOpen, key, kind, projectId]);
  React.useEffect(() => {
    const target = sentinelRef.current;
    if (
      !isOpen ||
      !target ||
      state.loading ||
      state.loadingMore ||
      !state.hasMore ||
      state.error ||
      state.deleting
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) actions.current.more();
      },
      { root: scrollRef.current, threshold: 0.1, rootMargin: '100px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [isOpen, key, state.loading, state.loadingMore, state.hasMore, state.error, state.deleting]);
  const select = (asset: Asset) => {
    onSelectAsset(
      kind,
      asset.url,
      asset.prompt || '',
      asset.model,
      asset.mode?.trim() || undefined,
      asset.aspectRatio?.trim() || undefined,
      asset.resolution?.trim() || undefined,
      Number.isFinite(asset.duration) ? asset.duration : undefined,
    );
  };
  const groups = new Map<string, Asset[]>();
  for (const asset of state.items) {
    const date = new Date(asset.createdAt || '');
    const day = Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-CA') : '日期未知';
    groups.set(day, [...(groups.get(day) || []), asset]);
  }
  const { ImageIcon, VideoIcon, AudioIcon, CloseIcon, DeleteIcon, Spinner } = icons;
  if (!isOpen) return null;
  return (
    <div
      data-fisherai-asset-history="true"
      role="region"
      aria-label="历史素材"
      className="fisher-canvas-anchored-panel backdrop-blur-xl border rounded-lg shadow-2xl flex flex-col overflow-hidden transition-colors duration-300 bg-[var(--af-input)] border-[var(--af-border)]"
      style={
        {
          '--panel-anchor-y': `${panelY}px`,
          '--panel-preferred-height': '500px',
          '--panel-preferred-width': '700px',
        } as ReactTypes.CSSProperties
      }
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 py-3 border-b border-[var(--af-border)]">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
          role="tablist"
          aria-label="素材类型"
        >
          {kinds.map((type) => {
            const Icon = type === 'images' ? ImageIcon : type === 'videos' ? VideoIcon : AudioIcon;
            return (
              <button
                key={type}
                role="tab"
                aria-selected={kind === type}
                className={`text-sm font-medium transition-colors pb-1 flex items-center gap-2 ${kind === type ? 'text-[var(--af-text)] border-b-2 border-[var(--af-border)]' : 'text-[var(--af-text-muted)] hover:text-[var(--af-text)]'}`}
                onClick={() => setKind(type)}
              >
                <Icon size={16} />
                {label(type)} ({state.counts[type]})
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          aria-label="关闭历史素材"
          className="shrink-0 transition-colors text-[var(--af-text-muted)] hover:text-[var(--af-text)]"
        >
          <CloseIcon size={18} />
        </button>
      </div>
      {state.error && (
        <div role="alert" className="px-4 py-2 text-xs text-[var(--af-danger)]">
          {state.error}
          <button onClick={() => setAttempt((value) => value + 1)} className="ml-2 underline">
            刷新列表
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#525252 #171717' }}
      >
        {state.loading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner size={24} className="animate-spin text-[var(--af-text-muted)]" />
          </div>
        ) : !state.items.length && !state.hasMore ? (
          <div className="flex flex-col items-center justify-center h-40 text-[var(--af-text-muted)]">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3 bg-[var(--af-surface-raised)]">
              <ImageIcon size={24} />
            </div>
            <p>未找到{label(kind)}</p>
            <p className="text-xs mt-1">生成或上传的{label(kind)}将显示在这里</p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...groups.keys()]
              .sort()
              .reverse()
              .map((day) => (
                <div key={day}>
                  <h3 className="text-sm mb-3 text-[var(--af-text-secondary)]">{day}</h3>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
                    {groups.get(day)!.map((asset) => (
                      <div
                        key={asset.id}
                        data-asset-id={asset.id}
                        onClick={() => select(asset)}
                        className="aspect-square rounded-lg overflow-hidden cursor-pointer transition-all group relative border bg-[var(--af-input)] border-[var(--af-border)] hover:border-[var(--af-border-control)]"
                      >
                        {kind === 'images' ? (
                          <img
                            src={asset.url}
                            alt={asset.filename || asset.prompt || '历史图片'}
                            loading="lazy"
                            className="w-full h-full object-contain bg-[var(--af-input)]"
                          />
                        ) : kind === 'videos' ? (
                          <video
                            src={asset.url}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-contain bg-[var(--af-input)]"
                            onMouseEnter={(event) => {
                              const video = event.currentTarget;
                              video.dataset.hovered = 'true';
                              void video
                                .play()
                                .then(() => {
                                  if (video.dataset.hovered !== 'true') video.pause();
                                })
                                .catch(() => {});
                            }}
                            onMouseLeave={(event) => {
                              const video = event.currentTarget;
                              video.dataset.hovered = '';
                              video.pause();
                              video.currentTime = 0;
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[var(--af-surface-raised)]">
                            <AudioIcon size={32} className="text-[var(--af-text-muted)]" />
                            <span className="text-[10px] px-2 text-center truncate w-full opacity-60 text-[var(--af-text-secondary)]">
                              {asset.filename}
                            </span>
                          </div>
                        )}
                        {deleteId === asset.id ? (
                          <div
                            data-af-media-chrome="true"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20"
                            style={{
                              background: 'color-mix(in srgb, var(--af-media-bg) 85%, transparent)',
                            }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="text-[var(--af-media-text)] text-[10px] font-medium">
                              删除?
                            </span>
                            <div className="flex gap-2">
                              <button
                                disabled={!!state.deleting || state.loadingMore}
                                onClick={() => actions.current.remove(asset.id)}
                                className="px-2 py-1 bg-[var(--af-danger-bg)] text-[var(--af-danger)] text-[10px] rounded"
                              >
                                {state.deleting === asset.id ? '删除中' : '是'}
                              </button>
                              <button
                                disabled={!!state.deleting}
                                onClick={() => setDeleteId(null)}
                                className="px-2 py-1 bg-[var(--af-hover)] text-[var(--af-text)] text-[10px] rounded"
                              >
                                否
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            aria-label={`删除${asset.filename || label(kind)}`}
                            disabled={!!state.deleting || state.loadingMore}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteId(asset.id);
                            }}
                            className="absolute top-1 right-1 p-1.5 bg-[var(--af-surface)] hover:bg-[var(--af-danger-bg)] rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                          >
                            <DeleteIcon size={14} className="text-[var(--af-text)]" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            {state.hasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center py-4">
                {state.loadingMore ? (
                  <Spinner size={20} className="animate-spin text-[var(--af-text-muted)]" />
                ) : (
                  <button
                    onClick={() => actions.current.more()}
                    disabled={!!state.deleting}
                    className="text-xs text-[var(--af-text-muted)]"
                  >
                    加载更多
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
