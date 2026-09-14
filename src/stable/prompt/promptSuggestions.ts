export interface SuggestionProps {
  editor: unknown;
  clientRect?: null | (() => DOMRect | null);
  query?: string;
  items?: unknown[];
  [key: string]: unknown;
}
interface Renderer {
  element: HTMLElement;
  ref?: { onKeyDown(props: { event: KeyboardEvent }): boolean };
  updateProps(props: Record<string, unknown>): void;
  destroy(): void;
}
interface Popup {
  setProps(props: Record<string, unknown>): void;
  hide(): void;
  destroy(): void;
  state?: { isShown: boolean };
}
export interface SuggestionUI {
  createRenderer(component: unknown, props: SuggestionProps): Renderer;
  createPopup(options: Record<string, unknown>): Popup;
}
export function createPromptSuggestions(options: {
  component: unknown;
  ui: SuggestionUI;
  alive(): boolean;
  placement: 'top-start' | 'auto-start';
  extraProps?(): Record<string, unknown>;
}) {
  let renderer: Renderer | undefined,
    popup: Popup | undefined,
    frame: number | null = null,
    rect: SuggestionProps['clientRect'];
  let current: SuggestionProps | undefined;
  const stopFrame = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const exit = () => {
    stopFrame();
    const oldPopup = popup,
      oldRenderer = renderer;
    popup = undefined;
    renderer = undefined;
    current = undefined;
    rect = undefined;
    oldPopup?.destroy();
    oldRenderer?.destroy();
  };
  const follow = () => {
    frame = null;
    if (!options.alive()) {
      exit();
      return;
    }
    if (!popup || !rect) return;
    popup.setProps({ getReferenceClientRect: rect });
    frame = requestAnimationFrame(follow);
  };
  const updatePopup = (props: SuggestionProps) => {
    if (!props.clientRect) return;
    rect = props.clientRect;
    if (!popup && renderer)
      popup = options.ui.createPopup({
        getReferenceClientRect: rect,
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: options.placement,
        popperOptions: {
          modifiers: [
            { name: 'flip', options: { fallbackPlacements: ['top-start', 'bottom-start'] } },
          ],
        },
        hideOnClick: false,
      });
    else popup?.setProps({ getReferenceClientRect: rect });
    if (popup && frame === null) frame = requestAnimationFrame(follow);
  };
  const handlers = {
    onStart(props: SuggestionProps) {
      exit();
      if (!options.alive()) return;
      current = props;
      renderer = options.ui.createRenderer(options.component, {
        ...props,
        ...options.extraProps?.(),
      });
      updatePopup(props);
    },
    onUpdate(props: SuggestionProps) {
      if (!options.alive() || !renderer) return;
      current = props;
      renderer.updateProps({ ...props, ...options.extraProps?.() });
      updatePopup(props);
    },
    onKeyDown(props: { event: KeyboardEvent }) {
      if (props.event.isComposing || props.event.keyCode === 229) return false;
      if (props.event.key === 'Escape') {
        popup?.hide();
        stopFrame();
        return true;
      }
      return renderer?.ref?.onKeyDown(props) ?? false;
    },
    onExit: exit,
  };
  return {
    handlers,
    exit,
    isShown: () => Boolean(popup?.state?.isShown),
    updateItems: (items: unknown[]) => {
      if (options.alive() && renderer && current) {
        current = { ...current, items };
        renderer.updateProps({ ...current, ...options.extraProps?.() });
      }
    },
  };
}
