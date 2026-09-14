import { useLayoutEffect, type RefObject } from 'react';

type Bounds = Pick<DOMRect, 'left' | 'right' | 'top'> & { bottom?: number };
/** Libraries remain on the right; the hook makes room for the original composer. */
export function nodeSidePanelPosition(rect: Bounds, width: number, height: number) {
  const margin = 12, gap = 16;
  const panelWidth = Math.min(520, Math.max(0, width - margin * 2));
  const panelHeight = Math.max(0, Math.min(720, height - margin * 2));
  const rightSpace = Math.max(0, width - rect.right - gap - margin);
  const actualWidth = rightSpace >= 300 ? Math.min(panelWidth, rightSpace) : panelWidth;
  return {
    left: Math.max(margin, Math.min(rect.right + gap, width - actualWidth - margin)),
    top: Math.max(margin, Math.min(rect.top, height - panelHeight - margin)),
    width: actualWidth, height: panelHeight,
  };
}

/** Non-modal libraries keep the original prompt editable. */
export function activateSidePanel(surface: HTMLElement, dismiss: () => void) {
  const previous = document.activeElement as HTMLElement | null;
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); dismiss();
  };
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    if (surface.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true });
  };
}

export function useNodeSidePanel(panel: RefObject<HTMLDivElement | null>, anchor?: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const surface = panel.current, trigger = anchor?.current;
    if (!surface || !trigger) return;
    const node = trigger.closest<HTMLElement>('[data-node-id]') || trigger;
    const composer = trigger.closest<HTMLElement>('[data-fisherai-generation-composer]');
    // Share the expanded editor's viewport instead of laying a library over its text.
    const expandedLayout = document.createElement('style');
    expandedLayout.textContent = `
      #fisherai-prompt-expand-overlay:has([data-fisherai-prompt-expand-panel]) {
        justify-content: flex-start; padding: 24px;
      }
      #fisherai-prompt-expand-overlay > [data-fisherai-prompt-expand-panel] {
        width: calc(100vw - min(520px, 40vw) - 64px);
      }
    `;
    const originalTranslate = node.style.translate;
    let shiftedPixels = 0;
    let frame = 0, previous = '';
    const update = () => {
      const expanded = !!composer?.hasAttribute('data-fisherai-prompt-expanded');
      if (expanded && !expandedLayout.isConnected) document.head.append(expandedLayout);
      if (!expanded && expandedLayout.isConnected) expandedLayout.remove();
      const rect = node.getBoundingClientRect(), input = composer?.getBoundingClientRect();
      const bounds = expanded && input ? input : input ? { left: Math.min(rect.left, input.left), right: Math.max(rect.right, input.right),
        top: Math.min(rect.top, input.top), bottom: Math.max(rect.bottom, input.bottom) } : rect;
      // Recover the unshifted bounds so animation frames do not oscillate between sides.
      const baseline = { top: bounds.top, bottom: bounds.bottom, left: bounds.left + shiftedPixels, right: bounds.right + shiftedPixels };
      const position = nodeSidePanelPosition(expanded ? bounds : baseline, window.innerWidth, window.innerHeight);
      if (!expanded) {
        const shift = Math.max(0, baseline.right + 16 - position.left);
        const scale = node.offsetWidth > 0 ? rect.width / node.offsetWidth : 1;
        if (scale > 0 && shift !== shiftedPixels) {
          node.style.translate = shift ? `${-shift / scale}px 0` : originalTranslate;
          shiftedPixels = shift;
        }
      } else if (shiftedPixels) {
        node.style.translate = originalTranslate;
        shiftedPixels = 0;
      }
      const signature = JSON.stringify(position);
      if (signature !== previous) {
        Object.assign(surface.style, Object.fromEntries(Object.entries(position).map(([key, value]) => [key, `${value}px`])));
        previous = signature;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => { cancelAnimationFrame(frame); expandedLayout.remove(); node.style.translate = originalTranslate; };
  }, [panel, anchor]);
}
