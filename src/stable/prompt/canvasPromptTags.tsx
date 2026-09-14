import type * as ReactTypes from 'react';
import type { PromptRuntime, PromptIcons } from './promptComponents';
interface Props {
  node: { attrs: Record<string, unknown> };
  editor: { isEditable: boolean };
  deleteNode(): void;
}
type Wrapper = ReactTypes.ComponentType<{ children: ReactTypes.ReactNode; className: string }>;
export function CanvasPromptTag(
  React: PromptRuntime,
  props: Props,
  {
    Wrapper,
    CloseIcon,
    TagIcon,
  }: Pick<PromptIcons, 'CloseIcon' | 'TagIcon'> & { Wrapper: Wrapper },
) {
  const [hover, setHover] = React.useState(false),
    label = String(props.node.attrs.label || ''),
    editable = props.editor.isEditable;
  const remove = (event: ReactTypes.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (editable) props.deleteNode();
  };
  return (
    <Wrapper className="inline-block align-middle select-none">
      <span
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? `删除预设标签 ${label}` : undefined}
        className={`inline-flex items-center gap-1.5 px-2 py-0 rounded-full border text-xs font-medium mr-1 transition-all duration-200 bg-[var(--af-selected)] text-[var(--af-text-secondary)] border-[var(--af-border-control)] ${hover && editable ? 'cursor-pointer bg-[var(--af-danger-bg)] text-[var(--af-danger)] border-[var(--af-danger)]' : ''}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={remove}
        onKeyDown={(event) => {
          if (
            !event.nativeEvent.isComposing &&
            ['Enter', ' ', 'Backspace', 'Delete'].includes(event.key)
          )
            remove(event);
        }}
      >
        <span className="flex items-center justify-center transition-transform duration-200">
          {hover && editable ? (
            <CloseIcon size={12} />
          ) : (
            <TagIcon size={12} className="text-[var(--af-text-secondary)]" />
          )}
        </span>
        <span className="leading-none">{label}</span>
      </span>
    </Wrapper>
  );
}
export function CanvasMentionTag(
  React: PromptRuntime,
  props: Props,
  {
    Wrapper,
    CloseIcon,
    ImageIcon,
    VideoIcon,
    TextIcon,
    AudioIcon,
  }: Pick<PromptIcons, 'CloseIcon' | 'ImageIcon' | 'VideoIcon' | 'TextIcon' | 'AudioIcon'> & {
    Wrapper: Wrapper;
  },
) {
  const [hover, setHover] = React.useState(false),
    type = String(props.node.attrs.assetType || 'image'),
    label = String(props.node.attrs.label || ''),
    url = String(props.node.attrs.url || ''),
    editable = props.editor.isEditable;
  const remove = (event: ReactTypes.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (editable) props.deleteNode();
  };
  const color =
    hover && editable
      ? 'bg-[var(--af-danger-bg)] text-[var(--af-danger)] border-[var(--af-danger)]'
      : type === 'video'
        ? 'bg-[var(--af-success-bg)] text-[var(--af-success)] border-[var(--af-success)]'
        : type === 'text'
          ? 'bg-[var(--af-info-bg)] text-[var(--af-info)] border-[var(--af-info)]'
          : type === 'audio'
            ? 'bg-[var(--af-info-bg)] text-[var(--af-info)] border-[var(--af-info)]'
            : 'bg-[var(--af-warning-bg)] text-[var(--af-warning)] border-[var(--af-warning)]';
  const Icon =
    type === 'video'
      ? VideoIcon
      : type === 'text'
        ? TextIcon
        : type === 'audio'
          ? AudioIcon
          : ImageIcon;
  return (
    <Wrapper className="inline-block align-middle select-none leading-none">
      <span
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? `删除素材引用 ${label}` : undefined}
        className={`inline-flex h-[24px] items-stretch align-middle rounded-[4px] border mr-1.5 mb-0.5 leading-none transition-all duration-200 overflow-hidden group/mention ${color} ${editable ? 'cursor-pointer' : ''}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={remove}
        onKeyDown={(event) => {
          if (
            !event.nativeEvent.isComposing &&
            ['Enter', ' ', 'Backspace', 'Delete'].includes(event.key)
          )
            remove(event);
        }}
      >
        <span className="w-[24px] h-[24px] bg-[var(--af-surface)] flex items-center justify-center flex-shrink-0 relative border-r border-inherit overflow-hidden leading-none">
          {type === 'image' && url ? (
            <img src={url} alt="" className="block w-full h-full object-cover" draggable={false} />
          ) : (
            <Icon size={13} className="block shrink-0" />
          )}
          {hover && editable && (
            <span
              data-af-media-chrome="true"
              className="absolute inset-0 flex items-center justify-center leading-none"
              style={{ background: 'color-mix(in srgb, var(--af-media-bg) 85%, transparent)' }}
            >
              <CloseIcon size={13} className="block shrink-0 text-[var(--af-media-text)]" />
            </span>
          )}
        </span>
        <span className="h-full min-w-[48px] flex items-center justify-center text-[14px] font-black leading-none tracking-tight">
          {label}
        </span>
      </span>
    </Wrapper>
  );
}
