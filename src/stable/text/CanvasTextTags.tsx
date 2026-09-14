import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Tag, X } from 'lucide-react';
import {
  MAX_TEXT_NODE_TAGS,
  MAX_TEXT_TAG_LABEL_LENGTH,
  TEXT_NODE_TAG_PRESETS,
  TEXT_TAG_COLORS,
  TEXT_TAG_COLOR_LABELS,
  normalizeTextNodeTags,
  textNodeTagsReadError,
  textTagLabelError,
  textTagLabelKey,
  type TextNodeTag,
  type TextTagColor,
} from './textNodeTags';
import './textNodeTags.css';

export interface CanvasTextTagsProps {
  value?: unknown;
  onChange(tags: TextNodeTag[]): void;
  disabled?: boolean;
}

function stopCanvasEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

function TagDot({ color }: { color: TextTagColor }) {
  return <span className="af-text-tags-dot" data-tag-color={color} aria-hidden="true" />;
}

function TextTagsPopover({
  id,
  trigger,
  tags,
  readError,
  onChange,
  onClose,
}: {
  id: string;
  trigger: RefObject<HTMLButtonElement | null>;
  tags: TextNodeTag[];
  readError: string;
  onChange(tags: TextNodeTag[]): void;
  onClose(restoreFocus?: boolean): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<TextTagColor>('gray');
  const [error, setError] = useState('');
  const customTags = tags.filter(
    (tag) => !TEXT_NODE_TAG_PRESETS.some((item) => item.id === tag.id),
  );
  const nameError = name ? textTagLabelError(name) : '';
  const feedback = error || nameError || readError;

  useLayoutEffect(() => {
    const element = panel.current;
    const anchor = trigger.current;
    if (!element || !anchor) return;
    function position() {
      if (!element || !anchor) return;
      const margin = 12;
      const gap = 8;
      const bounds = anchor.getBoundingClientRect();
      const panelBounds = element.getBoundingClientRect();
      const width = panelBounds.width || Math.min(320, window.innerWidth - margin * 2);
      const height = Math.min(panelBounds.height, window.innerHeight - margin * 2);
      const below = bounds.bottom + gap;
      const preferredTop =
        below + height <= window.innerHeight - margin ? below : bounds.top - height - gap;
      element.style.left = `${Math.max(margin, Math.min(bounds.right - width, window.innerWidth - width - margin))}px`;
      element.style.top = `${Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin))}px`;
    }
    function outside(event: Event) {
      if (!(event.target instanceof Node)) return;
      if (element?.contains(event.target) || anchor?.contains(event.target)) return;
      onClose();
    }
    function focusOutside(event: FocusEvent) {
      if (!(event.target instanceof Node)) return;
      if (element?.contains(event.target) || anchor?.contains(event.target)) return;
      onClose(false);
    }
    position();
    element
      .querySelector<HTMLButtonElement>('[data-text-tag-option]')
      ?.focus({ preventScroll: true });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('focusin', focusOutside);
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    resizeObserver?.observe(element);
    resizeObserver?.observe(anchor);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('focusin', focusOutside);
      resizeObserver?.disconnect();
    };
  }, [onClose, trigger]);

  function update(next: TextNodeTag[]) {
    try {
      onChange(next);
      setError('');
      return true;
    } catch {
      setError('标签未能保存，请重试。');
      return false;
    }
  }

  function toggle(tag: TextNodeTag) {
    if (tags.some((item) => item.id === tag.id)) {
      update(tags.filter((item) => item.id !== tag.id));
    } else if (tags.some((item) => textTagLabelKey(item.label) === textTagLabelKey(tag.label))) {
      setError('已有同名自定义标签，请先移除它再选择常用标签。');
    } else if (tags.length >= MAX_TEXT_NODE_TAGS) {
      setError(`每个节点最多添加 ${MAX_TEXT_NODE_TAGS} 个标签，请先移除一个。`);
    } else {
      update([...tags, { ...tag }]);
    }
  }

  function addCustomTag() {
    const invalidName = textTagLabelError(name);
    if (invalidName) {
      setError(invalidName);
      nameInput.current?.focus();
      return;
    }
    const label = name.trim();
    if (
      [...tags, ...TEXT_NODE_TAG_PRESETS].some(
        (tag) => textTagLabelKey(tag.label) === textTagLabelKey(label),
      )
    ) {
      setError('已有同名标签，请选择已有标签或换一个名称。');
      nameInput.current?.focus();
      return;
    }
    if (tags.length >= MAX_TEXT_NODE_TAGS) {
      setError(`每个节点最多添加 ${MAX_TEXT_NODE_TAGS} 个标签，请先移除一个。`);
      return;
    }
    if (update([...tags, { id: `custom:${crypto.randomUUID()}`, label, color }])) {
      setName('');
      nameInput.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled)',
        ) || [],
      ).filter(
        (element) =>
          !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && event.target === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return createPortal(
    <div
      id={id}
      ref={panel}
      className="af-text-tags-popover"
      role="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onPointerDown={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      onClick={stopCanvasEvent}
      onDoubleClick={stopCanvasEvent}
      onContextMenu={stopCanvasEvent}
      onWheel={stopCanvasEvent}
      onKeyDown={onKeyDown}
      onKeyUp={stopCanvasEvent}
    >
      <div className="af-text-tags-heading">
        <h2 id={`${id}-title`}>节点标签</h2>
        <span className="af-text-tags-count">
          {tags.length}/{MAX_TEXT_NODE_TAGS}
        </span>
        <button
          type="button"
          className="af-text-tags-close"
          aria-label="关闭节点标签"
          onClick={() => onClose()}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <p id={`${id}-description`} className="af-text-tags-description">
        为当前节点分类，可选择多个标签。
      </p>
      <fieldset className="af-text-tags-section">
        <legend>常用标签</legend>
        <div className="af-text-tags-presets">
          {TEXT_NODE_TAG_PRESETS.map((tag) => {
            const selected = tags.some((item) => item.id === tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                data-text-tag-option="true"
                data-tag-color={tag.color}
                aria-pressed={selected}
                onClick={() => toggle(tag)}
              >
                <TagDot color={tag.color} />
                <span>{tag.label}</span>
                <Check
                  size={12}
                  aria-hidden="true"
                  className={selected ? '' : 'af-text-tags-check-hidden'}
                />
              </button>
            );
          })}
        </div>
      </fieldset>
      {customTags.length > 0 && (
        <section className="af-text-tags-section" aria-label="当前节点的自定义标签">
          <h3>自定义标签</h3>
          <ul className="af-text-tags-custom-list">
            {customTags.map((tag) => (
              <li key={tag.id}>
                <TagDot color={tag.color} />
                <span className="af-text-tags-custom-label">{tag.label}</span>
                <button
                  type="button"
                  aria-label={`删除标签：${tag.label}`}
                  onClick={() => {
                    if (update(tags.filter((item) => item.id !== tag.id)))
                      nameInput.current?.focus();
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <fieldset className="af-text-tags-section af-text-tags-create">
        <legend>新建标签</legend>
        <label htmlFor={`${id}-name`}>标签名称</label>
        <div className="af-text-tags-name-row">
          <input
            id={`${id}-name`}
            ref={nameInput}
            type="text"
            value={name}
            placeholder="例如：主角设定"
            autoComplete="off"
            aria-invalid={Boolean(nameError || error)}
            aria-describedby={`${id}-name-hint${feedback ? ` ${id}-error` : ''}`}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              event.preventDefault();
              addCustomTag();
            }}
          />
          <button type="button" className="af-text-tags-add" onClick={addCustomTag}>
            <Plus size={13} aria-hidden="true" />
            添加
          </button>
        </div>
        <p id={`${id}-name-hint`} className="af-text-tags-name-hint">
          {Array.from(name.trim()).length}/{MAX_TEXT_TAG_LABEL_LENGTH} 个字符
        </p>
        <fieldset className="af-text-tags-colors">
          <legend>标签颜色</legend>
          {TEXT_TAG_COLORS.map((token) => (
            <label key={token} data-tag-color={token}>
              <input
                type="radio"
                name={`${id}-color`}
                value={token}
                checked={color === token}
                onChange={() => setColor(token)}
              />
              <TagDot color={token} />
              <span>{TEXT_TAG_COLOR_LABELS[token]}</span>
            </label>
          ))}
        </fieldset>
      </fieldset>
      {feedback && (
        <p id={`${id}-error`} className="af-text-tags-error" role="alert">
          {feedback}
        </p>
      )}
    </div>,
    document.body,
  );
}

export function CanvasTextTags({ value, onChange, disabled = false }: CanvasTextTagsProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const tags = normalizeTextNodeTags(value);
  const readError = textNodeTagsReadError(value);
  if (disabled && open) setOpen(false);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus && trigger.current?.isConnected && !trigger.current.disabled)
      trigger.current.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="af-text-tags"
      data-fisherai-state={disabled ? 'disabled' : undefined}
      onPointerDown={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      onClick={stopCanvasEvent}
      onDoubleClick={stopCanvasEvent}
      onContextMenu={stopCanvasEvent}
      onKeyDown={stopCanvasEvent}
      onKeyUp={stopCanvasEvent}
    >
      <button
        ref={trigger}
        className="af-text-tags-trigger"
        type="button"
        aria-label="编辑文本节点标签"
        title={readError || '编辑文本节点标签'}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Tag size={13} aria-hidden="true" />
        <span>标签</span>
        {readError && (
          <span className="af-text-tags-warning" aria-label="已保存标签需要检查">
            !
          </span>
        )}
      </button>
      {tags.length > 0 && (
        <span className="af-text-tags-summary" role="list" aria-label="已选节点标签">
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="af-text-tags-chip"
              role="listitem"
              title={tag.label}
              data-tag-color={tag.color}
            >
              <TagDot color={tag.color} />
              <span>{tag.label}</span>
            </span>
          ))}
          {tags.length > 2 && (
            <span
              className="af-text-tags-more"
              role="listitem"
              aria-label={`另有 ${tags.length - 2} 个标签：${tags
                .slice(2)
                .map((tag) => tag.label)
                .join('、')}`}
              title={tags
                .slice(2)
                .map((tag) => tag.label)
                .join('、')}
            >
              +{tags.length - 2}
            </span>
          )}
        </span>
      )}
      {open && !disabled && (
        <TextTagsPopover
          id={id}
          trigger={trigger}
          tags={tags}
          readError={readError}
          onChange={onChange}
          onClose={close}
        />
      )}
    </div>
  );
}
