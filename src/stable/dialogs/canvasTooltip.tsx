import type * as ReactTypes from 'react';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'cloneElement' | 'isValidElement' | 'useState' | 'useRef' | 'useEffect'
>;
interface Props {
  text: string;
  children: ReactTypes.ReactNode;
  delay?: number;
  position?: 'top' | 'bottom' | 'left' | 'right';
}
export function CanvasTooltip(
  React: Runtime,
  { text, children, delay = 10, position = 'top' }: Props,
) {
  const [mounted, setMounted] = React.useState(false),
    [visible, setVisible] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = React.useRef<number | undefined>(undefined);
  const clear = () => {
    clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
  };
  React.useEffect(() => clear, []);
  const show = () => {
    clear();
    timer.current = setTimeout(() => {
      setMounted(true);
      frame.current = requestAnimationFrame(() => setVisible(true));
    }, delay);
  };
  const hide = () => {
    clear();
    setVisible(false);
    timer.current = setTimeout(() => setMounted(false), 150);
  };
  const hasText = (node: ReactTypes.ReactNode): boolean => {
    if (typeof node === 'string') return Boolean(node.trim());
    if (typeof node === 'number') return true;
    if (Array.isArray(node)) return node.some(hasText);
    return (
      React.isValidElement<{ children?: ReactTypes.ReactNode }>(node) &&
      hasText(node.props.children)
    );
  };
  const content =
    React.isValidElement<ReactTypes.ButtonHTMLAttributes<HTMLButtonElement>>(children) &&
    children.type === 'button' &&
    !children.props['aria-label'] &&
    !children.props['aria-labelledby'] &&
    !hasText(children.props.children)
      ? React.cloneElement(children, { 'aria-label': text })
      : children;
  const placement =
    position === 'top'
      ? 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2'
      : position === 'bottom'
        ? 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2'
        : position === 'left'
          ? 'right-[calc(100%+8px)] top-1/2 -translate-y-1/2'
          : 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2';
  const arrow =
    position === 'top'
      ? 'left-1/2 -translate-x-1/2 -bottom-[4px]'
      : position === 'bottom'
        ? 'left-1/2 -translate-x-1/2 -top-[4px] -rotate-[135deg]'
        : position === 'left'
          ? 'top-1/2 -translate-y-1/2 -right-[4px] -rotate-[45deg]'
          : 'top-1/2 -translate-y-1/2 -left-[4px] rotate-[135deg]';
  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hide();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {content}
      {mounted && (
        <div
          role="tooltip"
          className={`absolute z-[100] px-3 py-1.5 text-[13px] font-medium text-[var(--af-text)] bg-[var(--af-surface-raised)] border border-[var(--af-border-control)] rounded-lg shadow-xl whitespace-nowrap pointer-events-none transition-all duration-150 ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} ${placement}`}
        >
          {text}
          <div
            className={`absolute w-1.5 h-1.5 bg-[var(--af-surface-raised)] border-r border-b border-[var(--af-border-control)] rotate-45 ${arrow}`}
          />
        </div>
      )}
    </div>
  );
}
