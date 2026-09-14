import type * as React from 'react';
type Runtime = Pick<typeof React, 'useEffect' | 'useRef' | 'useState'>;
const editor = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('input,textarea,select,[contenteditable],[role="dialog"]');

export function useCanvasDeferredFrame(hooks: Runtime, enabled: boolean, getEpoch: () => number) {
  const frames = hooks.useRef(new Set<number>()),
    live = hooks.useRef({ enabled, getEpoch });
  live.current = { enabled, getEpoch };
  hooks.useEffect(() => {
    const pending = frames.current;
    return () => {
      for (const frame of pending) cancelAnimationFrame(frame);
      pending.clear();
    };
  }, [enabled]);
  return (action: () => void) => {
    const epoch = live.current.getEpoch();
    const frame = requestAnimationFrame(() => {
      frames.current.delete(frame);
      if (live.current.enabled && live.current.getEpoch() === epoch) action();
    });
    frames.current.add(frame);
  };
}

export function useCanvasSurfaceSize(
  hooks: Runtime,
  canvasRef: React.RefObject<HTMLElement | null>,
  view: string,
  epoch: number,
) {
  const [size, setSize] = hooks.useState({ width: window.innerWidth, height: window.innerHeight });
  hooks.useEffect(() => {
    const surface = canvasRef.current;
    if (!surface || view !== 'canvas') return;
    const update = () => {
      const { width, height } = surface.getBoundingClientRect();
      if (width > 0 && height > 0)
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [canvasRef, view, epoch]);
  return size;
}

export function useCanvasPageEvents(
  hooks: Runtime,
  options: {
    enabled: boolean;
    canvasRef: React.RefObject<HTMLElement | null>;
    pointer: React.RefObject<{ x: number; y: number } | null>;
    hasCopiedNodes(): boolean;
    paste(): void;
    upload(files: File[], point: { x: number; y: number }): unknown;
  },
) {
  const live = hooks.useRef(options);
  live.current = options;
  hooks.useEffect(() => {
    if (!options.enabled) return;
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || editor(event.target) || editor(document.activeElement)) return;
      const current = live.current;
      if (current.hasCopiedNodes()) {
        event.preventDefault();
        current.paste();
        return;
      }
      const files = [...(event.clipboardData?.items || [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .flatMap((item, index) => {
          const file = item.getAsFile();
          return file
            ? [
                new File(
                  [file],
                  `screenshot-${Date.now()}-${index}.${file.type.split('/')[1] || 'png'}`,
                  { type: file.type },
                ),
              ]
            : [];
        });
      if (!files.length) {
        event.preventDefault();
        current.paste();
        return;
      }
      const bounds = current.canvasRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const pointer = current.pointer.current;
      const inside =
        pointer &&
        pointer.x >= bounds.left &&
        pointer.x <= bounds.right &&
        pointer.y >= bounds.top &&
        pointer.y <= bounds.bottom;
      event.preventDefault();
      void current.upload(
        files,
        inside
          ? { x: pointer.x - bounds.left, y: pointer.y - bounds.top }
          : { x: bounds.width / 2, y: bounds.height / 2 },
      );
    };
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        return;
      }
      let target = event.target instanceof Element ? event.target : null;
      while (target && target !== document.body) {
        // The canvas itself never scrolls. Avoid forcing style/layout for its wheel animation.
        if (target === options.canvasRef.current || target.id === 'canvas-viewport-content' || target.hasAttribute('data-canvas-nodes-layer')) {
          event.preventDefault();
          return;
        }
        const overflow = getComputedStyle(target).overflowY;
        if (
          ['auto', 'scroll', 'overlay'].includes(overflow) &&
          target.scrollHeight > target.clientHeight &&
          (event.deltaY < 0
            ? target.scrollTop > 0
            : target.scrollTop + target.clientHeight < target.scrollHeight - 1)
        )
          return;
        target = target.parentElement;
      }
      event.preventDefault();
    };
    window.addEventListener('paste', paste);
    document.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('paste', paste);
      document.removeEventListener('wheel', wheel);
    };
  }, [options.enabled]);
}
