import type * as ReactTypes from 'react';
import type { PromptRuntime, PromptIcons, PromptKeyHandle } from './promptComponents';
import { isolatePromptMenuKeyboard } from './promptComponents';
interface MentionItem {
  id: string;
  label: string;
  type: string;
  url?: string;
  title?: string;
}
interface Props {
  items: MentionItem[];
  command(value: { id: string; label: string; assetType: string; url?: string }): void;
}
export function CanvasMentionList(
  React: PromptRuntime,
  props: Props,
  ref: ReactTypes.ForwardedRef<PromptKeyHandle>,
  { VideoIcon, TextIcon, AudioIcon }: Pick<PromptIcons, 'VideoIcon' | 'TextIcon' | 'AudioIcon'>,
) {
  const [selected, setSelected] = React.useState(0),
    rootRef = React.useRef<HTMLDivElement>(null);
  const select = (index: number) => {
    const item = props.items[index];
    if (item)
      props.command({
        id: item.id,
        label: item.label,
        assetType: item.type,
        url: item.url,
      });
  };
  React.useEffect(() => setSelected(0), [props.items]);
  React.useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.isComposing || event.keyCode === 229) return false;
      if (event.key === 'Enter') {
        select(selected);
        return true;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const length = props.items.length;
        if (length)
          setSelected((index) => (index + (event.key === 'ArrowUp' ? -1 : 1) + length) % length);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={rootRef}
      onKeyDown={isolatePromptMenuKeyboard}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      data-fisherai-mention-menu={'true'}
      className={
        'border rounded-lg z-[100] overflow-x-hidden py-1 animate-in fade-in zoom-in-95 duration-100'
      }
      style={{
        width: '360px',
        minWidth: '280px',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'min(420px, calc(100vh - 24px))',
        overflowY: 'auto',
        background: 'var(--af-surface-raised)',
        borderColor: 'var(--af-border)',
        boxShadow: '0 24px 64px #0000007A',
      }}
    >
      <div
        className={
          'px-3 py-1.5 text-[10px] font-bold text-[var(--af-text-muted)] uppercase tracking-widest border-b border-[var(--af-border)] mb-1'
        }
      >
        {'已连接节点'}
      </div>
      {props.items.length > 0 ? (
        props.items.map((item, index) => (
          <button
            type="button"
            data-selected={index === selected}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(index)}
            onMouseEnter={() => setSelected(index)}
            title={item.title || item.id}
            draggable={!1}
            onDragStart={(event) => event.preventDefault()}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all relative ${index === selected ? 'bg-[var(--af-info-bg)] text-[var(--af-info)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-hover)] hover:text-[var(--af-text)]'}`}
            key={item.id}
          >
            {index === selected && (
              <div
                className={
                  'absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[var(--af-info-bg)] rounded-r-full'
                }
              />
            )}
            <div
              data-fisherai-mention-preview={'true'}
              className={`rounded-lg overflow-hidden border flex items-center justify-center flex-shrink-0 transition-colors ${index === selected ? 'border-[var(--af-info)] bg-[var(--af-info-bg)]' : 'border-[var(--af-border-control)] bg-[var(--af-surface-raised)]'} ${item.type === 'video' ? 'text-[var(--af-success)]' : item.type === 'text' ? 'text-[var(--af-info)]' : item.type === 'audio' ? 'text-[var(--af-info)]' : ''}`}
              style={{ width: '56px', height: '56px', background: 'var(--af-input)' }}
              draggable={!1}
              onDragStart={(event) => event.preventDefault()}
            >
              {item.type === 'video' ? (
                <VideoIcon size={14} />
              ) : item.type === 'text' ? (
                <TextIcon size={14} />
              ) : item.type === 'audio' ? (
                <AudioIcon size={14} />
              ) : (
                <img
                  src={item.url}
                  className={'w-full h-full object-contain'}
                  draggable={!1}
                  onDragStart={(event) => event.preventDefault()}
                />
              )}
            </div>
            <div className={'flex flex-col min-w-0'}>
              <span className={'text-xs font-bold truncate'}>{item.label}</span>
              <span className={'text-[10px] text-[var(--af-text-muted)] truncate'}>
                {item.title && item.title !== item.id ? item.title : '已连接素材'}
              </span>
            </div>
          </button>
        ))
      ) : (
        <div className={'px-3 py-4 text-center text-[10px] text-[var(--af-text-muted)]'}>
          {'未找到相关素材'}
        </div>
      )}
    </div>
  );
}
