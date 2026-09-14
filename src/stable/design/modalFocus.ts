const modalStateKey = Symbol.for('fisherai.modalFocus.state');
interface ModalState {
  stack: HTMLElement[];
  inertBaseline: Map<Element, string | null>;
}
// Stable source modules are compiled separately; all copies still coordinate one document.
function stateFor(doc: Document): ModalState {
  const current = Reflect.get(doc, modalStateKey) as ModalState | undefined;
  if (current) return current;
  const state: ModalState = { stack: [], inertBaseline: new Map() };
  Object.defineProperty(doc, modalStateKey, { value: state });
  return state;
}

function updateInert(doc: Document) {
  const state = stateFor(doc),
    baseline = state.inertBaseline;
  baseline.forEach((value, node) => {
    if (value === null) node.removeAttribute('inert');
    else node.setAttribute('inert', value);
  });
  baseline.clear();
  const top = state.stack.filter((node) => node.isConnected).at(-1);
  if (!top) return;
  let branch: Element = top;
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || ['STYLE', 'SCRIPT', 'LINK'].includes(sibling.tagName)) continue;
      baseline.set(sibling, sibling.getAttribute('inert'));
      sibling.setAttribute('inert', '');
    }
    if (branch.parentElement === doc.body) break;
    branch = branch.parentElement;
  }
}

/** One focus and background-interaction contract for nested product dialogs. */
export function activateModal(
  surface: HTMLElement,
  onDismiss: () => void,
  { dismissible = true, initialFocus }: { dismissible?: boolean; initialFocus?: HTMLElement } = {},
) {
  const doc = surface.ownerDocument;
  doc.dispatchEvent(new Event('fisherai:modal-opening'));
  const previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const stack = stateFor(doc).stack;
  stack.push(surface);
  updateInert(doc);
  surface.tabIndex = -1;
  const focusable = () =>
    [
      ...surface.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], audio[controls], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (node) =>
        !node.closest('[hidden], [inert]') &&
        node.getAttribute('aria-hidden') !== 'true' &&
        getComputedStyle(node).display !== 'none' &&
        getComputedStyle(node).visibility !== 'hidden',
    );
  const onKey = (event: KeyboardEvent) => {
    if (!surface.isConnected || stack.at(-1) !== surface) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (dismissible) onDismiss();
    } else if (event.key === 'Tab') {
      const items = focusable();
      const index = items.indexOf(doc.activeElement as HTMLElement);
      if (
        !items.length ||
        (event.shiftKey ? index <= 0 : index < 0 || index === items.length - 1)
      ) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0])?.focus();
        if (!items.length) surface.focus();
      }
    }
  };
  const onFocus = (event: FocusEvent) => {
    if (
      surface.isConnected &&
      stack.at(-1) === surface &&
      !surface.contains(event.target as Node)
    ) {
      (focusable()[0] ?? surface).focus({ preventScroll: true });
    }
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus, true);
  (initialFocus ?? focusable()[0] ?? surface).focus({ preventScroll: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    observer.disconnect();
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus, true);
    const wasTop = stack.at(-1) === surface;
    const index = stack.indexOf(surface);
    if (index >= 0) stack.splice(index, 1);
    updateInert(doc);
    if (wasTop && previousFocus?.isConnected && !previousFocus.closest('[inert]'))
      previousFocus.focus({ preventScroll: true });
  };
  const observer = new MutationObserver(() => {
    if (!surface.isConnected) release();
    else if (stack.at(-1) === surface) updateInert(doc);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return release;
}
