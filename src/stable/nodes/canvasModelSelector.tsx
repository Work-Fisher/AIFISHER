import type * as ReactTypes from 'react';
import { modelDisplayName } from '../../config/modelDisplayName';
import { mountModelPicker } from '../generation/modelPicker';
import { createSourceSettingsClient } from '../generation/sourceSettingsClient';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useEffect' | 'useLayoutEffect' | 'useRef'
>;
interface Model {
  name: string;
  selectable?: boolean;
  [key: string]: unknown;
}
interface Props {
  currentModel?: Model;
  availableModels: Model[];
  onModelChange(name: string): void;
  disabled?: boolean;
}
interface Components {
  ModelIcon: ReactTypes.ComponentType<{ model?: Model; size: number }>;
}
export function CanvasModelSelector(React: Runtime, props: Props, { ModelIcon }: Components) {
  const [open, setOpen] = React.useState(false),
    [attempt, setAttempt] = React.useState(0);
  const root = React.useRef<HTMLDivElement>(null),
    overlay = React.useRef<HTMLDivElement>(null),
    panel = React.useRef<HTMLDivElement>(null),
    latest = React.useRef(props);
  latest.current = props;
  const name = props.currentModel?.name || '选择模型',
    modelNames = JSON.stringify(
      props.availableModels
        .filter((model) => model.selectable !== false)
        .map((model) => model.name),
    );
  React.useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);
  React.useLayoutEffect(() => {
    const layer = overlay.current;
    if (!open || !layer || typeof layer.showPopover !== 'function') return;
    // A transformed canvas is a stacking context. The browser top layer lets all
    // three columns stay above fixed canvas tools without lifting the whole canvas.
    const position = () => {
      const anchor = root.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const scale = anchor.offsetWidth ? rect.width / anchor.offsetWidth : 1;
      Object.assign(layer.style, {
        position: 'fixed',
        inset: 'auto',
        margin: '0',
        padding: '0',
        border: '0',
        width: '0',
        height: '0',
        overflow: 'visible',
        background: 'transparent',
        left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 288 * scale - 8))}px`,
        top: `${Math.min(rect.top, window.innerHeight - 8)}px`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      });
    };
    layer.setAttribute('popover', 'manual');
    position();
    layer.showPopover();
    window.addEventListener('resize', position);
    const wheel = (event: WheelEvent) => {
      if (!layer.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('wheel', wheel);
      if (layer.matches(':popover-open')) layer.hidePopover();
    };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const sourcesChanged = () => setAttempt((value) => value + 1);
    document.addEventListener('mousedown', outside);
    window.addEventListener('fisherai:model-sources-changed', sourcesChanged);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('fisherai:model-sources-changed', sourcesChanged);
    };
  }, [open]);
  React.useEffect(() => {
    if (!open || props.disabled || !panel.current) return;
    // Each opening reads current availability; closed menus do not retain stale key configuration.
    return mountModelPicker(panel.current, createSourceSettingsClient(), {
      names: JSON.parse(modelNames) as string[],
      currentName: name,
      onSelect(selected) {
        if (latest.current.disabled) return;
        latest.current.onModelChange(selected);
        setOpen(false);
      },
    });
  }, [open, attempt, modelNames, name, props.disabled]);
  return (
    <div
      className="relative"
      ref={root}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          root.current?.querySelector('button')?.focus();
        }
      }}
    >
      <button
        onClick={() => {
          if (!props.disabled) setOpen(!open);
        }}
        disabled={props.disabled}
        aria-expanded={open}
        className={`inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring h-8 gap-1.5 px-2 py-1 text-sm rounded-lg ${props.disabled ? 'text-[var(--af-text-muted)] opacity-50' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] active:bg-[var(--af-hover)]'}`}
      >
        <ModelIcon model={props.currentModel} size={18} />
        <span className="whitespace-nowrap capitalize">{modelDisplayName(name)}</span>
      </button>
      {open && (
        <div ref={overlay} onWheel={(event) => event.stopPropagation()}>
          <div
            ref={panel}
            className="absolute bottom-full mb-2 left-0 w-72 bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 py-1.5 max-h-80 overflow-y-auto"
            onWheel={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
