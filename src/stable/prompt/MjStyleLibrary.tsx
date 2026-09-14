import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activateSidePanel, useNodeSidePanel } from './nodeSidePanel';
import { ArrowLeft, ChevronDown, Search, X } from 'lucide-react';
import { activateModal } from '../design/modalFocus';
import type { CreativePreset } from './creativePresets';
import {
  filterMjStyles,
  mjCategoryGroups,
  mjStylePreset,
  mjStyleText,
  type MjStyle,
  type MjInsertMode,
} from './mjStyles';
import './MjStyleLibrary.css';

const groups = [
  ['all', '全部'],
  ['char', '角色人像'],
  ['scene', '场景环境'],
  ['juwu', '巨物怪兽'],
];
const modes: [MjInsertMode, string][] = [
  ['style', '风格码'],
  ['parameters', '风格＋参数'],
  ['full', '完整提示词'],
  ['vibe', '色调描述'],
];
const PAGE_SIZE = 36;
export default function MjStyleLibrary({
  anchor,
  onClose,
  onChoose,
}: {
  anchor?: import('react').RefObject<HTMLDivElement | null>;
  onClose(): void;
  onChoose(preset: CreativePreset): void;
}) {
  const [items, setItems] = useState<MjStyle[]>([]),
    [error, setError] = useState('');
  const [group, setGroup] = useState('all'),
    [category, setCategory] = useState('全部');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState(''),
    [codeKind, setCodeKind] = useState('all'),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<MjStyle | null>(null);
  const [mode, setMode] = useState<MjInsertMode>('style');
  const [draft, setDraft] = useState(''),
    [notice, setNotice] = useState('');
  const panel = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    selection = useRef(selected);
  useNodeSidePanel(panel, anchor);
  useLayoutEffect(() => {
    close.current = onClose;
    selection.current = selected;
  }, [onClose, selected]);
  useLayoutEffect(() => {
    const root = panel.current!,
      backdrop = root.parentElement!;
    const promoted = typeof backdrop.showPopover === 'function';
    if (promoted) {
      backdrop.setAttribute('popover', 'manual');
      backdrop.showPopover();
    }
    const release = (anchor ? activateSidePanel : activateModal)(root, () =>
      selection.current ? setSelected(null) : close.current(),
    );
    return () => {
      release();
      if (promoted) backdrop.hidePopover();
    };
  }, [anchor]);
  useEffect(() => {
    let alive = true;
    void import('./mjStyleCatalog.json')
      .then((module) => {
        if (alive) setItems(module.default);
      })
      .catch(() => {
        if (alive) setError('码图未能加载，请关闭后重新打开。');
      });
    return () => {
      alive = false;
    };
  }, []);
  const categories = [
    ...new Set(
      items.filter((item) => group === 'all' || item.group === group).map((item) => item.category),
    ),
  ];
  const filtered = filterMjStyles(items, group, category, query, codeKind);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  function choose(item: MjStyle) {
    setSelected(item);
    setMode('style');
    setDraft(mjStyleText(item, 'style'));
    setNotice('');
  }
  function changeMode(next: MjInsertMode) {
    setMode(next);
    if (selected) setDraft(mjStyleText(selected, next));
    setNotice('');
  }
  return createPortal(
    <div
      className={`af-creative-backdrop af-mj-backdrop${anchor ? ' af-node-side-backdrop' : ''}`}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="af-mj-panel"
        role="dialog"
        aria-modal={anchor ? undefined : true}
        aria-labelledby="af-mj-title"
        ref={panel}
      >
        <header className="af-mj-header">
          <div>
            <h2 id="af-mj-title">MJ 码图馆</h2>
            <p>按效果挑选风格，在正文光标处插入</p>
          </div>
          <button type="button" title="关闭 MJ 码图馆" aria-label="关闭 MJ 码图馆" onClick={onClose}>
            <X size={18} />
          </button>
          {!selected && (              <label className="af-mj-search">
                <Search size={15} />
                <input
                  aria-label="搜索 MJ 码图"
                  placeholder="搜索风格、色调或代码"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>)}
        </header>
        {!selected ? (
          <>
            <div className="af-mj-toolbar">
              <div className="af-mj-tabs">
                {groups.map(([id, name]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={group === id}
                    onClick={() => {
                      setGroup(id);
                      setCategory('全部');
                      setExpandedCategory(null);
                      setPage(0);
                    }}
                  >
                    {name}
                    <small>
                      {items.filter((item) => id === 'all' || item.group === id).length}
                    </small>
                  </button>
                ))}
              </div>

            </div>
            <div className="af-mj-browser">
              <nav aria-label="MJ 风格分类">
                <p className="af-mj-nav-label">按风格浏览</p>
                <button
                  type="button"
                  aria-current={category === '全部' ? 'true' : undefined}
                  onClick={() => {
                    setCategory('全部');
                    setExpandedCategory(null);
                    setPage(0);
                  }}
                >
                  全部风格
                </button>
                {mjCategoryGroups.map((section, index) => {
                  const available = section.categories.filter((name) => categories.includes(name));
                  if (!available.length) return null;
                  const expanded = expandedCategory === section.name;
                  return (
                    <div className="af-mj-category-group" key={section.name}>
                      <button
                        type="button"
                        className="af-mj-category-heading"
                        aria-expanded={expanded}
                        aria-controls={`af-mj-category-${index}`}
                        data-selected={available.includes(category) || undefined}
                        onClick={() => setExpandedCategory(expanded ? null : section.name)}
                      >
                        <span>{section.name}</span>
                        <ChevronDown size={14} />
                      </button>
                      {expanded && (
                        <div id={`af-mj-category-${index}`} className="af-mj-subcategories">
                          {available.map((name) => (
                            <button
                              type="button"
                              key={name}
                              aria-current={category === name ? 'true' : undefined}
                              onClick={() => {
                                setCategory(name);
                                setPage(0);
                              }}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
              <main key={`${group}:${category}:${query}:${codeKind}:${currentPage}`}>
                <div className="af-mj-results">
                  <span className="af-mj-result-heading">
                    <b>{category === '全部' ? '全部风格' : category}</b>
                    <small>{filtered.length} 组效果</small>
                  </span>
                  <select
                    aria-label="代码组合类型"
                    value={codeKind}
                    onChange={(event) => {
                      setCodeKind(event.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">全部代码</option>
                    <option value="solo">单码</option>
                    <option value="mixed">混码组合</option>
                  </select>
                </div>
                {error ? (
                  <p role="alert">{error}</p>
                ) : !items.length ? (
                  <p role="status">正在加载码图…</p>
                ) : !filtered.length ? (
                  <p>没有匹配的码图，试试其他关键词或分类。</p>
                ) : (
                  <div className="af-mj-grid">
                    {filtered
                      .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                      .map((item) => (
                        <button
                          className="af-mj-card"
                          type="button"
                          key={item.id}
                          onClick={() => choose(item)}
                          aria-label={`查看 ${item.id} ${item.name}`}
                        >
                          <img src={item.thumbnail} loading="lazy" decoding="async" alt="" />
                          <span>
                            <b>{item.name}</b>
                            <small>
                              {item.id.toUpperCase()} · {item.mixed ? '混码组合' : '单码'}
                            </small>
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </main>
            </div>
            <footer className="af-mj-footer">
              <span>混码按整组使用，效果图与代码一一对应</span>
              <div>
                <button
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  上一页
                </button>
                <span>
                  {currentPage + 1} / {pages}
                </span>
                <button
                  type="button"
                  disabled={currentPage + 1 >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  下一页
                </button>
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="af-mj-detail-top">
              <button type="button" onClick={() => setSelected(null)}>
                <ArrowLeft size={15} /> 返回码图
              </button>
              <span>
                {selected.category} · {selected.id.toUpperCase()}
              </span>
            </div>
            <div className="af-mj-detail">
              <div className="af-mj-large">
                <img src={selected.preview} alt={selected.name} />
                <p>{selected.medium}</p>
              </div>
              <section>
                <h3>{selected.name}</h3>
                <p>
                  {selected.mixed
                    ? '这是混码组合，整组使用才能保留示例风格。'
                    : '单码风格，可搭配你自己的主体描述。'}
                </p>
                <div className="af-mj-modes">
                  {modes.map(([id, title]) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={mode === id}
                      onClick={() => changeMode(id)}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <textarea
                  aria-label="将要插入的 MJ 提示词"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <p className="af-mj-tip">
                  {mode === 'full'
                    ? '包含案例主体与构图，可在上方修改后插入。'
                    : mode === 'vibe'
                      ? '仅使用色调描述，方便搭配其他图像模型。'
                      : '风格码适用于 MJ；参数兼容性以你选用的版本为准。'}
                </p>
                <span role="status">{notice}</span>
              </section>
            </div>
            <footer className="af-mj-footer">
              <span>插入后可继续编辑，不会开始生成</span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(draft)
                      .then(() => setNotice('已复制'))
                      .catch(() => setNotice('复制失败，请选中文字手动复制'));
                  }}
                >
                  复制
                </button>
                <button
                  type="button"
                  className="af-mj-primary"
                  disabled={!draft.trim() || draft.length > 12000}
                  onClick={() => onChoose(mjStylePreset(selected, draft))}
                >
                  插入正文
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
