import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Clapperboard, SlidersHorizontal, X, Star } from 'lucide-react';
import { activateModal } from '../design/modalFocus';
import {
  creativeSelection,
  validCreativePreset,
  type CreativeKind,
  type CreativePreset,
} from './creativePresets';
import type { MediaComposerProps } from '../nodes/mediaComposer';
import './CreativeLibrary.css';
import MjStyleLibrary from './MjStyleLibrary';
import { activateSidePanel, useNodeSidePanel } from './nodeSidePanel';
import { expandPromptTags, parsePromptTags } from './promptPresets';

export function MjStyleStatus({ prompt }: { prompt: string }) {
  const styles = parsePromptTags(prompt).filter((tag) =>
    /(?:^|\s)--(?:sref|profile|p|personalize)(?=\s|$)/i.test(tag.prompt),
  );
  const expanded = expandPromptTags(prompt, { trailingParameters: true });
  const parameters = expanded.slice(expanded.indexOf('\n--') + 1);
  if (!styles.length) return null;
  return (
    <div
      role="status"
      style={{
        textAlign: 'right',
        color: 'var(--af-text-secondary)',
        fontSize: 11,
        padding: '4px 8px',
      }}
      title={parameters}
    >
      风格码已加入{styles.length > 1 ? `（${styles.length} 组）` : ''} · 自动放在末尾
    </div>
  );
}

type Tab = CreativeKind | 'custom';
const labels: Record<Tab, string> = {
  style: '风格',
  motion: '运镜',
  filter: '滤镜',
  custom: '自定义',
};
const icons = {
  style: Palette,
  motion: Clapperboard,
  filter: SlidersHorizontal,
  custom: SlidersHorizontal,
};
interface SavedLibrary {
  favorites: string[];
  custom: CreativePreset[];
}
async function readLibrary(response: Response): Promise<SavedLibrary> {
  if (!response.ok) throw new Error('未能读写本机预设，请检查本机连接。');
  const saved = await response.json();
  return {
    favorites: Array.isArray(saved.favorites)
      ? saved.favorites.filter((x: unknown) => typeof x === 'string')
      : [],
    custom: Array.isArray(saved.custom) ? saved.custom.filter(validCreativePreset) : [],
  };
}

function Preview({ preset, active }: { preset: CreativePreset; active: boolean }) {
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (active && video.current) void video.current.play().catch(() => setFailed(true));
  }, [active]);
  return (
    <>
      {preset.preview && (
        <img src={preset.poster || preset.preview} alt="" loading="lazy" decoding="async" />
      )}
      {active && preset.poster && !failed && (
        <video
          ref={video}
          src={preset.preview}
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
        />
      )}
    </>
  );
}

export function CreativePromptTokens({
  data: node,
  onUpdate,
  disabled = false,
}: Pick<MediaComposerProps, 'data' | 'onUpdate'> & { disabled?: boolean }) {
  const selected = creativeSelection(node.creativePresets);
  const tabs: Tab[] =
    node.type.toLowerCase() === 'video'
      ? ['style', 'motion', 'filter', 'custom']
      : ['style', 'filter', 'custom'];
  if (!tabs.some((tab) => selected[tab])) return null;
  return (
    <div
      className="af-creative-tools af-creative-prompt-tokens"
      aria-label="已加入提示词的预设"
      onClick={(event) => event.stopPropagation()}
    >
      {tabs.map(
        (tab) =>
          selected[tab] && (
            <button
              className="af-creative-tag"
              title={[selected[tab]!.prefix, selected[tab]!.prompt].filter(Boolean).join('\n')}
              type="button"
              key={tab}
              disabled={disabled}
              aria-label={`移除${labels[tab]}：${selected[tab]!.name}`}
              onClick={() => onUpdate(node.id, { creativePresets: { ...selected, [tab]: null } })}
            >
              {selected[tab]!.name}
              <span aria-hidden>×</span>
            </button>
          ),
      )}
    </div>
  );
}

export function CreativeLibraryTools({
  data: node,
  onUpdate,
  disabled = false,
}: Pick<MediaComposerProps, 'data' | 'onUpdate'> & { disabled?: boolean }) {
  const [open, setOpen] = useState<Tab | 'mj' | null>(null);
  const toolsRoot = useRef<HTMLDivElement>(null);
  const selected = creativeSelection(node.creativePresets);
  function insertPreset(preset: CreativePreset) {
    setOpen(null);
    if (disabled) return;
    const composer = toolsRoot.current?.closest('[data-fisherai-generation-composer]');
    requestAnimationFrame(() => {
      if (composer?.isConnected)
        composer.dispatchEvent(
          new CustomEvent('fisherai:insert-creative-preset', { detail: preset }),
        );
    });
  }
  const tabs: Tab[] =
    node.type.toLowerCase() === 'video'
      ? ['style', 'motion', 'filter', 'custom']
      : ['style', 'filter', 'custom'];
  return (
    <div
      className="af-creative-tools"
      ref={toolsRoot}
      data-fisherai-creative-tools="true"
      onClick={(e) => e.stopPropagation()}
    >
      {tabs
        .filter((t) => t !== 'custom')
        .map((tab) => {
          const Icon = icons[tab];
          return (
            <Fragment key={tab}>
              <button
                type="button"
                disabled={disabled}
                aria-haspopup="dialog"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setOpen(tab)}
              >
                <Icon size={14} aria-hidden /> {labels[tab]}
              </button>
              {tab === 'style' && node.type.toLowerCase() === 'image' && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-haspopup="dialog"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setOpen('mj')}
                >
                  MJ 码图
                </button>
              )}
            </Fragment>
          );
        })}
      {open === 'mj' && (
        <MjStyleLibrary key={node.id} anchor={toolsRoot} onClose={() => setOpen(null)} onChoose={insertPreset} />
      )}
      {open && open !== 'mj' && (
        <CreativeLibraryPanel
          key={`${node.id}:${open}`}
          initialTab={open}
          anchor={toolsRoot}
          tabs={tabs}
          selected={selected}
          disabled={disabled}
          onClose={() => setOpen(null)}
          onChoose={(slot, preset) => {
            setOpen(null);
            if (disabled) return;
            if (!preset) {
              onUpdate(node.id, { creativePresets: { ...selected, [slot]: null } });
              return;
            }
            insertPreset(preset);
          }}
        />
      )}
    </div>
  );
}

function CreativeLibraryPanel({
  anchor,
  initialTab,
  tabs,
  selected,
  disabled,
  onClose,
  onChoose,
}: {
  anchor?: import('react').RefObject<HTMLDivElement | null>;
  initialTab: Tab;
  tabs: Tab[];
  selected: ReturnType<typeof creativeSelection>;
  disabled: boolean;
  onClose(): void;
  onChoose(slot: Tab, preset: CreativePreset | null): void;
}) {
  const [tab, setTab] = useState(initialTab),
    [category, setCategory] = useState('全部'),
    [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState<CreativePreset[]>([]),
    [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedLibrary>({ favorites: [], custom: [] });
  const [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false);
  const [active, setActive] = useState<string | null>(null),
    [name, setName] = useState(selected.custom?.name || '');
  const [prefix, setPrefix] = useState(selected.custom?.prefix || ''),
    [suffix, setSuffix] = useState(selected.custom?.prompt || ''),
    [customId, setCustomId] = useState(selected.custom?.id || '');
  const root = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  useNodeSidePanel(root, anchor);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    const panel = root.current;
    const backdrop = panel?.parentElement;
    if (!panel || !backdrop) return;
    // The expanded composer is in the browser top layer; z-index alone cannot cover it.
    const promoted = typeof backdrop.showPopover === 'function';
    if (promoted) {
      backdrop.setAttribute('popover', 'manual');
      backdrop.showPopover();
    }
    const release = (anchor ? activateSidePanel : activateModal)(panel, () => close.current());
    return () => {
      release();
      if (promoted) backdrop.hidePopover();
    };
  }, [anchor]);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void fetch('/api/prompts/creative-library', { cache: 'no-store', signal: controller.signal })
      .then(readLibrary)
      .then((data) => {
        if (alive) {
          setSaved(data);
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) setError('收藏和自定义预设暂时无法读取，请检查本机连接后重新打开。');
      });
    void import('./creativeCatalog.json')
      .then((data) => {
        const records: unknown[] = data.default;
        if (alive) setCatalog(records.filter(validCreativePreset));
      })
      .catch(() => {
        if (alive) setError('预设加载失败，请关闭后重试。');
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const stop = () => setActive(null);
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, []);
  async function save(next: SavedLibrary) {
    if (!ready || saving) return false;
    setSaving(true);
    try {
      const favoriteChanges = [...new Set([...saved.favorites, ...next.favorites])]
        .filter((id) => saved.favorites.includes(id) !== next.favorites.includes(id))
        .map((id) => ({ id, saved: next.favorites.includes(id) }));
      const customUpserts = next.custom.filter(
        (p) => !saved.custom.some((old) => JSON.stringify(old) === JSON.stringify(p)),
      );
      const customDeletes = saved.custom
        .filter((p) => !next.custom.some((n) => n.id === p.id))
        .map((p) => p.id);
      const result = await fetch('/api/prompts/creative-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favoriteChanges, customUpserts, customDeletes }),
      }).then(readLibrary);
      setSaved(result);
      setError('');
      return true;
    } catch {
      setError('未能保存预设，请检查本机连接和存储空间后重试。');
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function applyCustom(persist: boolean) {
    if (!name.trim() || !(prefix.trim() || suffix.trim())) {
      setError('请填写名称和至少一段提示词。');
      return;
    }
    const preset: CreativePreset = {
      id: customId || `custom-${crypto.randomUUID()}`,
      kind: 'style',
      category: '自定义',
      name: name.trim(),
      description: '自定义前后缀',
      prefix: prefix.trim(),
      prompt: suffix.trim(),
    };
    if (!validCreativePreset(preset)) {
      setError('名称最多 80 字，前后缀各最多 12000 字。');
      return;
    }
    if (persist) {
      if (
        await save({
          ...saved,
          custom: [...saved.custom.filter((x) => x.id !== preset.id), preset],
        })
      )
        setCustomId(preset.id);
    } else onChoose('custom', preset);
  }
  const categoryOrder: Record<string, string[]> = {
    style: ['真人风格', '2D风格', '3D风格'],
    motion: ['基础运镜', '组合运镜', '高阶运镜'],
    filter: ['通用', '人像质感'],
  };
  const categories = ['全部', '收藏', ...(categoryOrder[tab] || [])];
  const items = catalog.filter(
    (p) =>
      p.kind === tab &&
      (category === '全部' ||
        (category === '收藏' && saved.favorites.includes(p.id)) ||
        p.category === category) &&
      `${p.name} ${p.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return createPortal(
    <div
      className={`af-creative-backdrop${anchor ? ' af-node-side-backdrop' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        ref={root}
        className="af-creative-panel"
        role="dialog"
        aria-modal={anchor ? undefined : true}
        aria-label="创作预设库"
      >
        <header className="af-creative-header">
          <div className="af-creative-tabs">
            {tabs.map((t) => (
              <button
                type="button"
                key={t}
                aria-pressed={tab === t}
                onClick={() => {
                  setTab(t);
                  setCategory('全部');
                  setSearch('');
                  setActive(null);
                }}
              >
                {labels[t]}
              </button>
            ))}
          </div>
          {tab !== 'custom' && (
            <input
              type="search"
              aria-label="搜索预设"
              placeholder={`搜索${labels[tab]}`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(null);
              }}
            />
          )}
          <button type="button" onClick={onClose} className="af-creative-close" title="关闭创作预设库" aria-label="关闭创作预设库">
            <X size={18} />
          </button>
        </header>
        {tab !== 'custom' ? (
          <>
            <nav className="af-creative-categories" aria-label="预设分类">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => {
                    setCategory(c);
                    setActive(null);
                  }}
                >
                  {c}
                </button>
              ))}
            </nav>
            <div className="af-creative-grid" onScroll={() => setActive(null)}>
              {items.map((p) => (
                <article
                  key={p.id}
                  className={`af-creative-card${selected[tab]?.id === p.id ? ' is-selected' : ''}`}
                  onMouseEnter={() => setActive(p.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.id)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setActive(null);
                  }}
                >
                  <button
                    type="button"
                    className="af-creative-choose"
                    aria-label={`应用${p.name}`}
                    aria-pressed={selected[tab]?.id === p.id}
                    disabled={disabled}
                    title={p.description}
                    onClick={() => onChoose(tab, p)}
                  >
                    <Preview preset={p} active={active === p.id} />
                    <span className="af-creative-title">{p.name}</span>
                  </button>
                  <button
                    className="af-creative-star"
                    type="button"
                    disabled={!ready || saving}
                    aria-label={`${saved.favorites.includes(p.id) ? '取消收藏' : '收藏'}${p.name}`}
                    aria-pressed={saved.favorites.includes(p.id)}
                    onClick={() =>
                      save({
                        ...saved,
                        favorites: saved.favorites.includes(p.id)
                          ? saved.favorites.filter((id) => id !== p.id)
                          : [...saved.favorites, p.id],
                      })
                    }
                  >
                    <Star
                      size={16}
                      fill={saved.favorites.includes(p.id) ? 'currentColor' : 'none'}
                    />
                  </button>
                </article>
              ))}
              {!items.length && (
                <p className="af-creative-empty">
                  {error ||
                    (!catalog.length
                      ? '正在加载预设…'
                      : category === '收藏'
                        ? '点击卡片上的星标，收藏常用预设。'
                        : '没有匹配的预设，请换个关键词。')}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="af-creative-custom">
            <label>
              已保存预设
              <select
                aria-label="已保存预设"
                value={customId}
                onChange={(e) => {
                  const p = saved.custom.find((x) => x.id === e.target.value);
                  setCustomId(p?.id || '');
                  setName(p?.name || '');
                  setPrefix(p?.prefix || '');
                  setSuffix(p?.prompt || '');
                }}
              >
                <option value="">新建预设</option>
                {saved.custom.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="给预设起个名字"
              />
            </label>
            <label>
              前缀内容
              <textarea
                maxLength={12000}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="生成时放在正文之前"
              />
            </label>
            <label>
              后缀内容
              <textarea
                maxLength={12000}
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder="生成时放在正文之后"
              />
            </label>
            <div className="af-creative-actions">
              {customId && (
                <button
                  type="button"
                  onClick={() => {
                    save({ ...saved, custom: saved.custom.filter((p) => p.id !== customId) });
                    setCustomId('');
                  }}
                >
                  删除预设
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setName('');
                  setPrefix('');
                  setSuffix('');
                  setCustomId('');
                }}
              >
                清空
              </button>
              <button type="button" disabled={!ready || saving} onClick={() => applyCustom(true)}>
                保存预设
              </button>
              <button
                type="button"
                className="primary"
                disabled={disabled}
                onClick={() => applyCustom(false)}
              >
                应用
              </button>
            </div>
          </div>
        )}
        <footer className="af-creative-footer">
          <span role="status">
            {error ||
              (tab === 'custom'
                ? '前后缀随节点保存，不修改正文。'
                : `${items.length} 个预设 · 收藏保存在本机账号${tab === 'motion' ? ' · 悬停预览运镜' : ''}`)}
          </span>
          {selected[tab] && (
            <button type="button" disabled={disabled} onClick={() => onChoose(tab, null)}>
              清除{labels[tab]}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
