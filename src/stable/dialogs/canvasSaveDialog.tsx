import type * as ReactTypes from 'react';
import './canvasSaveDialog.css';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useRef' | 'useEffect' | 'useCallback'
>;
export interface CanvasSaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  nameLabel?: string;
  categoryLabel?: string;
  defaultName: string;
  categories: string[];
  coverUrl?: string;
  coverAlt?: string;
  defaultOwnership?: string;
  compactCategory?: boolean;
  onSave: (name: string, category: string, ownership?: string) => void | Promise<void>;
  closeImmediatelyOnSave?: boolean;
}
const fieldClass =
  'w-full bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg px-3 py-2 text-[var(--af-text)] focus:outline-none focus:border-[var(--af-info)] transition-colors';

/** Shared asset/SKILL form. A save must settle before closing and cannot outlive its dialog. */
export function CanvasSaveDialog(React: Runtime, props: CanvasSaveDialogProps) {
  const liveRef = React.useRef(props);
  liveRef.current = props;
  const [name, setName] = React.useState(props.defaultName);
  const [category, setCategory] = React.useState(props.categories[0] || '');
  const [newCategory, setNewCategory] = React.useState('');
  const [ownership, setOwnership] = React.useState(props.defaultOwnership || '');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [error, setError] = React.useState('');
  const sessionRef = React.useRef(0),
    savingRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dialogRef = React.useRef<HTMLDivElement>(null),
    nameRef = React.useRef<HTMLInputElement>(null);
  const idRef = React.useRef(`canvas-save-${crypto.randomUUID()}`);
  const invalidateSession = React.useCallback(() => {
    sessionRef.current++;
    clearTimeout(timerRef.current);
  }, []);
  const close = () => {
    invalidateSession();
    liveRef.current.onClose();
  };
  React.useEffect(() => {
    invalidateSession();
    savingRef.current = false;
    if (!props.isOpen) return;
    const current = liveRef.current;
    setName(current.defaultName);
    setCategory(current.categories[0] || '');
    setNewCategory('');
    setOwnership(current.defaultOwnership || '');
    setMenuOpen(false);
    setStatus('idle');
    setError('');
    const previous = document.activeElement;
    nameRef.current?.focus();
    nameRef.current?.select();
    return () => {
      invalidateSession();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [props.isOpen, invalidateSession]);
  const save = async (event: ReactTypes.FormEvent) => {
    event.preventDefault();
    const selectedCategory = newCategory.trim() || category.trim();
    if (savingRef.current || !name.trim() || !selectedCategory || !liveRef.current.isOpen) return;
    const session = sessionRef.current;
    const current = liveRef.current;
    savingRef.current = true;
    setStatus('saving');
    setError('');
    try {
      if (current.defaultOwnership !== undefined)
        await current.onSave(name.trim(), selectedCategory, ownership.trim());
      else await current.onSave(name.trim(), selectedCategory);
      if (session !== sessionRef.current || !liveRef.current.isOpen) return;
      setStatus('success');
      if (current.closeImmediatelyOnSave) close();
      else
        timerRef.current = setTimeout(() => {
          if (session === sessionRef.current && liveRef.current.isOpen) close();
        }, 1000);
    } catch (failure) {
      if (session !== sessionRef.current || !liveRef.current.isOpen) return;
      savingRef.current = false;
      setStatus('error');
      setError(failure instanceof Error ? failure.message : '保存失败，请重试。');
    }
  };
  const keyDown = (event: ReactTypes.KeyboardEvent) => {
    // Dialog shortcuts and text editing must never reach canvas-level commands.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      if (menuOpen) setMenuOpen(false);
      else close();
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ) || [],
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  if (!props.isOpen) return null;
  const nameLabel = props.nameLabel || '名称',
    categoryLabel = props.categoryLabel || '分类';
  const busy = status === 'saving' || status === 'success';
  return (
    <div
      className="fixed inset-0 bg-[var(--af-overlay)] backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onKeyDown={keyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idRef.current}-title`}
        className="fisher-save-dialog"
      >
        <div className="fisher-save-header">
          <div className="flex items-center gap-6 border-b border-[var(--af-border-control)] pb-2">
            <h2
              id={`${idRef.current}-title`}
              className="text-[var(--af-text)] font-medium border-b-2 border-[var(--af-border)] pb-2 -mb-2.5"
            >
              {props.title}
            </h2>
          </div>
        </div>
        <form onSubmit={save} className="fisher-save-form">
          <div className="fisher-save-scroll">
            <div className="fisher-save-fields">
              <div className="fisher-save-cover">
                <span className="text-sm font-medium text-[var(--af-text)]">封面</span>
                <div className="fisher-save-preview">
                  {props.coverUrl ? (
                    <img
                      src={props.coverUrl}
                      alt={props.coverAlt || '封面'}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-[var(--af-text-muted)]">
                      暂无封面
                    </div>
                  )}
                </div>
              </div>
              <div className="fisher-save-details">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`${idRef.current}-name`}
                    className="text-sm font-medium text-[var(--af-text)]"
                  >
                    {nameLabel} <span className="text-[var(--af-danger)]">*</span>
                  </label>
                  <input
                    ref={nameRef}
                    id={`${idRef.current}-name`}
                    type="text"
                    value={name}
                    maxLength={200}
                    onChange={(event) => setName(event.target.value)}
                    className={fieldClass}
                    placeholder={`输入${nameLabel}`}
                    disabled={busy}
                  />
                </div>
                {props.compactCategory ? (
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor={`${idRef.current}-category`}
                      className="text-sm font-medium text-[var(--af-text)]"
                    >
                      {categoryLabel} <span className="text-[var(--af-danger)]">*</span>
                    </label>
                    <input
                      id={`${idRef.current}-category`}
                      className={fieldClass}
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      maxLength={80}
                      disabled={busy}
                      placeholder="选择分类，也可以自行填写"
                    />
                    <select aria-label="选择已有分类" className={fieldClass} disabled={busy}
                      value={props.categories.includes(category) ? category : ''}
                      onChange={(event) => { if (event.target.value) setCategory(event.target.value); }}>
                      <option value="" disabled>选择已有分类</option>
                      {props.categories.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                    <span className="text-xs text-neutral-400">可选择已有分类，或输入新分类。</span>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 relative">
                      <span className="text-sm font-medium text-[var(--af-text)]">
                        选择现有{categoryLabel}
                      </span>
                      <button
                        type="button"
                        aria-label={`选择现有${categoryLabel}`}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen(!menuOpen)}
                        disabled={busy}
                        className="w-full bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg px-3 py-2 text-[var(--af-text)] focus:outline-none flex items-center justify-between hover:bg-[var(--af-surface-raised)]"
                      >
                        <span>{category || `请选择${categoryLabel}`}</span>
                        <span aria-hidden="true">⌄</span>
                      </button>
                      {menuOpen && (
                        <div className="absolute top-[70px] left-0 right-0 bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg shadow-xl z-10 py-1 max-h-56 overflow-y-auto">
                          {props.categories.length ? (
                            props.categories.map((item) => (
                              <button
                                type="button"
                                key={item}
                                onClick={() => {
                                  setCategory(item);
                                  setMenuOpen(false);
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-[var(--af-surface-raised)] flex items-center justify-between group"
                              >
                                <span className="text-[var(--af-text-secondary)] group-hover:text-[var(--af-text)]">
                                  {item}
                                </span>
                                {category === item && <span aria-hidden="true">✓</span>}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-sm text-[var(--af-text-muted)]">
                              暂无现有分类
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor={`${idRef.current}-category`}
                        className="text-sm font-medium text-[var(--af-text)]"
                      >
                        {categoryLabel} <span className="text-[var(--af-danger)]">*</span>
                      </label>
                      <input
                        id={`${idRef.current}-category`}
                        type="text"
                        value={newCategory}
                        maxLength={80}
                        onChange={(event) => setNewCategory(event.target.value)}
                        className={fieldClass}
                        placeholder={`输入新${categoryLabel}，留空则使用上方已选${categoryLabel}`}
                        disabled={busy}
                      />
                    </div>
                  </>
                )}
                {props.defaultOwnership !== undefined && (
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor={`${idRef.current}-ownership`}
                      className="text-sm font-medium text-[var(--af-text)]"
                    >
                      归属
                    </label>
                    <input
                      id={`${idRef.current}-ownership`}
                      value={ownership}
                      maxLength={120}
                      onChange={(event) => setOwnership(event.target.value)}
                      className={fieldClass}
                      placeholder="项目／短剧名，留空为通用资产"
                      disabled={busy}
                    />
                  </div>
                )}
              </div>
            </div>
            {error && (
              <p
                role="alert"
                style={{ color: 'var(--af-danger)', margin: '0 24px 16px', fontSize: 12 }}
              >
                {error}
              </p>
            )}
          </div>
          <div className="fisher-save-footer">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-[var(--af-text-secondary)] hover:text-[var(--af-text)] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || !(newCategory.trim() || category.trim())}
              className="flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all duration-200"
              style={{
                background: status === 'saving' ? 'var(--af-hover)' : 'var(--af-primary)',
                color: status === 'saving' ? 'var(--af-text)' : 'var(--af-on-primary)',
                opacity:
                  !busy && (!name.trim() || !(newCategory.trim() || category.trim())) ? 0.5 : 1,
              }}
            >
              {status === 'saving'
                ? '保存中...'
                : status === 'success'
                  ? '已保存！'
                  : props.submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
