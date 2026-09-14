import type { Runtime, GridProps, Icons, LibraryItem, AssetFields } from './canvasLibrary';
import { ASSET_CATEGORIES, assetCategory } from '../media/assetOrganization';

export function CanvasLibraryGrid(React: Runtime, props: GridProps, icons: Icons) {
  const {
    selectedCategory,
    setSelectedCategory,
    assets,
    loading,
    deleting,
    saving,
    workflow,
    onSelectAsset,
    onDeleteAsset,
    onEditAsset,
  } = props;
  const [confirmation, setConfirmation] = React.useState<string | null>(null);
  const [failedImages, setFailedImages] = React.useState<Record<string, string>>({});
  const [query, setQuery] = React.useState('');
  const [ownershipFilter, setOwnershipFilter] = React.useState('');
  const [layout, setLayout] = React.useState<'grid' | 'list'>('grid');
  const [editing, setEditing] = React.useState<(AssetFields & { id: string }) | null>(null);
  const editInput = React.useRef<HTMLInputElement>(null);
  const owner = React.useRef(true);
  React.useEffect(() => {
    owner.current = true;
    return () => {
      owner.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (editing?.id) editInput.current?.focus();
  }, [editing?.id]);
  const categoryOf = (item: LibraryItem) =>
    workflow ? item.category || '其他' : assetCategory(item.category);
  const categories = [
    'All',
    ...new Set([
      ...(workflow ? [] : ASSET_CATEGORIES),
      ...assets.map(categoryOf).filter((category) => category !== 'All'),
    ]),
  ];
  const selected = categories.includes(selectedCategory) ? selectedCategory : 'All';
  const ownerships = [
    ...new Set(
      assets.map((item) => item.ownership?.trim()).filter((value): value is string => !!value),
    ),
  ];
  const effectiveOwnership =
    ownershipFilter === '__unassigned' || ownerships.includes(ownershipFilter)
      ? ownershipFilter
      : '';
  const filtered = assets.filter(
    (item) =>
      (selected === 'All' || categoryOf(item) === selected) &&
      (!effectiveOwnership ||
        (effectiveOwnership === '__unassigned'
          ? !item.ownership?.trim()
          : item.ownership?.trim() === effectiveOwnership)) &&
      (!query.trim() ||
        [item.name, categoryOf(item), item.ownership]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())),
  );
  const { DeleteIcon, ImageIcon, VideoIcon, AudioIcon, WorkflowIcon } = icons;
  const busy = !!deleting || !!saving;
  const preview = (item: LibraryItem) => {
    const source = workflow ? item.coverUrl : item.url;
    const Placeholder = workflow ? WorkflowIcon : item.type === 'audio' ? AudioIcon : ImageIcon;
    if (!workflow && item.type === 'video')
      return (
        <div className="fisher-library-preview">
          <video
            src={source}
            preload="metadata"
            muted
            playsInline
            onMouseEnter={(event) => {
              const video = event.currentTarget;
              video.dataset.hovered = 'true';
              void video
                .play()
                .then(() => {
                  if (!video.isConnected || video.dataset.hovered !== 'true') video.pause();
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
          <span className="fisher-library-media-type">
            <VideoIcon size={12} />
          </span>
        </div>
      );
    return (
      <div className="fisher-library-preview">
        {source && item.type !== 'audio' && failedImages[item.id] !== source ? (
          <img
            src={source}
            alt={item.name}
            loading="lazy"
            onError={() => setFailedImages((old) => ({ ...old, [item.id]: source }))}
          />
        ) : (
          <Placeholder size={32} strokeWidth={1.5} />
        )}
      </div>
    );
  };
  const actions = (item: LibraryItem) => (
    <div className="fisher-library-item-actions">
      {!workflow && onEditAsset && (
        <button
          type="button"
          disabled={busy}
          aria-label={`编辑 ${item.name}`}
          onClick={() => {
            setConfirmation(null);
            setEditing({
              id: item.id,
              name: item.name,
              category: categoryOf(item),
              ownership: item.ownership || '',
            });
          }}
        >
          编辑
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        title={workflow ? '删除本地 SKILL' : '删除资产'}
        aria-label={`删除${item.name}`}
        onClick={() => {
          setEditing(null);
          setConfirmation(item.id);
        }}
      >
        <DeleteIcon size={14} />
      </button>
    </div>
  );
  const confirmDelete = (item: LibraryItem) =>
    confirmation === item.id && (
      <div className="fisher-library-confirm" role="group" aria-label={`确认删除 ${item.name}`}>
        <span>确认删除？</span>
        <button
          type="button"
          disabled={busy}
          className="is-danger"
          onClick={() => {
            void onDeleteAsset(item.id).then((success) => {
              if (success && owner.current)
                setConfirmation((current) => (current === item.id ? null : current));
            });
          }}
        >
          {deleting === item.id ? '删除中' : '删除'}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirmation(null)}>
          取消
        </button>
      </div>
    );
  return (
    <div className="fisher-library-content">
      <div
        className="fisher-library-categories"
        role="tablist"
        aria-label={workflow ? 'SKILL 分类' : '资产分类'}
      >
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={selected === category}
            tabIndex={selected === category ? 0 : -1}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = categories.indexOf(category);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? categories.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : categories.length - 1)) %
                      categories.length;
              setSelectedCategory(categories[next]);
              setConfirmation(null);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('button')
                .item(next)?.focus();
            }}
            onClick={() => {
              setSelectedCategory(category);
              setConfirmation(null);
            }}
          >
            {category === 'All' ? '全部' : category}
          </button>
        ))}
      </div>
      {!workflow && (
        <div className="fisher-library-tools">
          <input
            type="search"
            aria-label="搜索资产"
            placeholder="搜索名称、分类或归属"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="筛选归属"
            value={effectiveOwnership}
            onChange={(event) => setOwnershipFilter(event.target.value)}
          >
            <option value="">全部归属</option>
            <option value="__unassigned">通用资产</option>
            {ownerships.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <div className="fisher-library-view" role="group" aria-label="资产视图">
            <button
              type="button"
              aria-pressed={layout === 'grid'}
              onClick={() => setLayout('grid')}
            >
              卡片
            </button>
            <button
              type="button"
              aria-pressed={layout === 'list'}
              onClick={() => setLayout('list')}
            >
              列表
            </button>
          </div>
        </div>
      )}
      <div className="fisher-library-scroll">
        {editing && (
          <form
            className="fisher-library-editor"
            aria-label="编辑资产信息"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !editing.name.trim() || !editing.category.trim()) return;
              const current = editing;
              void onEditAsset?.(current.id, {
                name: current.name.trim(),
                category: current.category.trim(),
                ownership: current.ownership.trim(),
              }).then((success) => {
                if (success && owner.current)
                  setEditing((value) => (value?.id === current.id ? null : value));
              });
            }}
          >
            <strong>编辑资产信息</strong>
            <div className="fisher-library-fields">
              <label>
                名称
                <input
                  ref={editInput}
                  required
                  maxLength={200}
                  value={editing.name}
                  disabled={busy}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </label>
              <label>
                分类
                <input
                  required
                  maxLength={80}
                  value={editing.category}
                  disabled={busy}
                  onChange={(event) => setEditing({ ...editing, category: event.target.value })}
                />
              </label>
              <label>
                归属
                <input
                  maxLength={120}
                  value={editing.ownership}
                  disabled={busy}
                  placeholder="项目／短剧名，留空为通用"
                  onChange={(event) => setEditing({ ...editing, ownership: event.target.value })}
                />
              </label>
            </div>
            <select aria-label="选择已有分类" disabled={busy} className="w-full rounded-lg border border-neutral-700 bg-[#1a1a1a] px-3 py-2 text-white"
              value={categories.includes(editing.category) ? editing.category : ''}
              onChange={(event) => { if (event.target.value) setEditing({ ...editing, category: event.target.value }); }}>
              <option value="" disabled>选择已有分类</option>
              {categories
                .filter((value) => value !== 'All')
                .map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
            </select>
            <div className="fisher-library-editor-actions">
              <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                type="submit"
                className="is-primary"
                disabled={busy || !editing.name.trim() || !editing.category.trim()}
              >
                {saving ? '保存中…' : '保存修改'}
              </button>
            </div>
          </form>
        )}
        {loading ? (
          <div className="fisher-library-empty" role="status">
            加载中...
          </div>
        ) : !filtered.length ? (
          <div className="fisher-library-empty">
            {workflow
              ? '当前分类还没有 SKILL。选中画布节点后，可将组合保存为本地 SKILL。'
              : '当前分类下没有资产。'}
            {!workflow && <p>选中画布中的图片、视频或音频，点击「保存到资产」。</p>}
            {(query || effectiveOwnership) && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setOwnershipFilter('');
                  setSelectedCategory('All');
                }}
              >
                清除筛选
              </button>
            )}
          </div>
        ) : layout === 'list' && !workflow ? (
          <div className="fisher-library-table-wrap">
            <table className="fisher-library-table">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">分类</th>
                  <th scope="col">归属</th>
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} data-library-id={item.id}>
                    <td>
                      <button
                        type="button"
                        className="fisher-library-list-name"
                        aria-label={`插入资产 ${item.name}`}
                        onClick={() => onSelectAsset(item)}
                      >
                        {preview(item)}
                        <span title={item.name}>{item.name}</span>
                      </button>
                    </td>
                    <td>{categoryOf(item)}</td>
                    <td title={item.ownership || '通用资产'}>{item.ownership || '通用资产'}</td>
                    <td>{confirmation === item.id ? confirmDelete(item) : actions(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="fisher-library-grid">
            {filtered.map((item) => (
              <article key={item.id} data-library-id={item.id} className="fisher-library-card">
                <button
                  type="button"
                  className="fisher-library-insert"
                  aria-label={`${workflow ? '插入 SKILL' : '插入资产'} ${item.name}`}
                  onClick={() => onSelectAsset(item)}
                >
                  {preview(item)}
                  <span className="fisher-library-name" title={item.name}>
                    {item.name}
                  </span>
                </button>
                <div className="fisher-library-card-info">
                  <span>{categoryOf(item)}</span>
                  {actions(item)}
                </div>
                {!workflow && (
                  <p className="fisher-library-ownership" title={item.ownership || '通用资产'}>
                    归属：{item.ownership || '通用资产'}
                  </p>
                )}
                {confirmDelete(item)}
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="fisher-library-count" role="status">
        {loading
          ? '正在读取资产'
          : `${filtered.length} 项${filtered.length !== assets.length ? ` / 共 ${assets.length} 项` : ''}`}
      </div>
    </div>
  );
}
