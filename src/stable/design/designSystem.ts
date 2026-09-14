import { activateModal } from './modalFocus';
import { preferenceStorage } from '../persistence/preferenceStore';
export const DESIGN_TOKENS = {
  color: {
    canvas: '#050505',
    surface: '#111111',
    surfaceRaised: '#1a1a1a',
    border: '#2a2a2a',
    text: '#f2f2f2',
    textMuted: '#a3a3a3',
    accent: '#f2f2f2',
    focus: '#60a5fa',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#fb7185',
    edgeDanger: '#ff4d5a',
  },
  radius: { small: '6px', medium: '8px', large: '12px', round: '999px' },
  space: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px' },
  motion: { fast: '120ms', normal: '200ms', slow: '300ms' },
} as const;

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';
export type ConfirmationIntent = 'paid' | 'destructive' | 'remote-risk';

export const RUNNINGHUB_PAID_CONFIRMATION_KEY = 'runninghub-paid-execution';
const CONFIRMATION_PREFERENCE_PREFIX = 'fisherai.confirmation.suppressed.v1.';

export interface AnchoredConfirmationOptions {
  anchor?: Element | { x: number; y: number };
  intent: ConfirmationIntent;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  rememberKey?: string;
}

interface LabeledControl<T extends HTMLElement> {
  element: HTMLLabelElement;
  label: HTMLSpanElement;
  input: T;
}

interface SelectControl {
  element: HTMLLabelElement;
  label: HTMLSpanElement;
  select: HTMLSelectElement;
}

interface OverlayControl {
  element: HTMLDivElement;
  trigger: HTMLButtonElement;
  content: HTMLDivElement;
}

interface StableDesignReport {
  shell: 'projects' | 'canvas' | 'unknown';
  labelledButtons: number;
  settingsSections: string[];
}

export interface StableDesignSystemAdapter {
  readonly tokens: typeof DESIGN_TOKENS;
  enhance(root?: ParentNode): StableDesignReport;
  confirm(options: AnchoredConfirmationOptions): Promise<boolean>;
  isConfirmationSuppressed(key: string): boolean;
  resetConfirmationPreference(key: string): void;
  observe(): () => void;
}

declare global {
  interface Window {
    __FISHERAI_DESIGN_SYSTEM__?: StableDesignSystemAdapter;
  }
}

let controlSequence = 0;
let lastActivationPoint: { x: number; y: number } | null = null;
let confirmationPointerTrackingInstalled = false;
let closeActiveConfirmation: ((confirmed: boolean) => void) | null = null;

function nextId(prefix: string): string {
  controlSequence += 1;
  return `fisherai-${prefix}-${controlSequence}`;
}

function setClasses(element: HTMLElement, ...classes: string[]): void {
  element.classList.add('fisherai-ui', ...classes);
}

export function createButton(options: {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = options.label;
  button.disabled = options.disabled ?? false;
  setClasses(button, 'fisherai-button', `is-${options.variant ?? 'secondary'}`);
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}

function confirmationPreferenceStorageKey(key: string): string {
  return `${CONFIRMATION_PREFERENCE_PREFIX}${key}`;
}

export function isConfirmationSuppressed(key: string): boolean {
  try {
    return preferenceStorage().getItem(confirmationPreferenceStorageKey(key)) === '1';
  } catch {
    return false;
  }
}

export function resetConfirmationPreference(key: string): void {
  try {
    preferenceStorage().removeItem(confirmationPreferenceStorageKey(key));
  } catch {
    // A disabled storage backend must never block an explicit confirmation.
  }
}

function suppressConfirmation(key: string): void {
  try {
    preferenceStorage().setItem(confirmationPreferenceStorageKey(key), '1');
  } catch {
    // The current action still proceeds; only the optional preference is lost.
  }
}

function installConfirmationPointerTracking(): void {
  if (confirmationPointerTrackingInstalled) return;
  confirmationPointerTrackingInstalled = true;
  document.addEventListener(
    'pointerdown',
    (event) => {
      lastActivationPoint = { x: event.clientX, y: event.clientY };
    },
    true,
  );
}

function confirmationAnchor(options: AnchoredConfirmationOptions): {
  point: { x: number; y: number };
  focusTarget: HTMLElement | null;
} {
  const explicitElement = options.anchor instanceof Element ? options.anchor : null;
  const activeElement =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  const focusTarget = explicitElement instanceof HTMLElement ? explicitElement : activeElement;
  if (explicitElement) {
    const rect = explicitElement.getBoundingClientRect();
    return {
      point: { x: rect.left + rect.width / 2, y: rect.bottom },
      focusTarget,
    };
  }
  if (options.anchor && 'x' in options.anchor) {
    return { point: options.anchor, focusTarget };
  }
  return {
    point: lastActivationPoint ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    focusTarget,
  };
}

const CONFIRMATION_INTENT_LABELS: Record<ConfirmationIntent, string> = {
  paid: 'PAID / 费用确认',
  destructive: 'DELETE / 删除确认',
  'remote-risk': 'REMOTE / 远端状态',
};

export function requestAnchoredConfirmation(
  options: AnchoredConfirmationOptions,
): Promise<boolean> {
  const canRemember = options.intent === 'paid' && Boolean(options.rememberKey);
  if (canRemember && isConfirmationSuppressed(options.rememberKey!)) {
    return Promise.resolve(true);
  }
  installConfirmationPointerTracking();
  closeActiveConfirmation?.(false);

  const { point, focusTarget } = confirmationAnchor(options);
  const confirmation = document.createElement('div');
  const title = document.createElement('h2');
  const description = document.createElement('p');
  const ledger = document.createElement('div');
  const ledgerLabel = document.createElement('span');
  const tick = document.createElement('span');
  const actions = document.createElement('div');
  const cancel = createButton({ label: options.cancelLabel ?? '取消', variant: 'ghost' });
  const confirm = createButton({
    label: options.confirmLabel,
    variant: options.intent === 'destructive' ? 'danger' : 'primary',
  });
  const titleId = nextId('anchored-confirmation-title');
  const descriptionId = nextId('anchored-confirmation-description');
  const confirmationId = nextId('anchored-confirmation');

  confirmation.id = confirmationId;
  confirmation.dataset.fisheraiAnchoredConfirmation = 'true';
  confirmation.dataset.fisheraiConfirmationIntent = options.intent;
  confirmation.setAttribute('role', 'dialog');
  confirmation.setAttribute('aria-modal', 'false');
  confirmation.setAttribute('aria-labelledby', titleId);
  confirmation.setAttribute('aria-describedby', descriptionId);
  confirmation.tabIndex = -1;
  title.id = titleId;
  title.textContent = options.title;
  description.id = descriptionId;
  description.textContent = options.description;
  ledgerLabel.textContent = CONFIRMATION_INTENT_LABELS[options.intent];
  tick.setAttribute('aria-hidden', 'true');
  setClasses(confirmation, 'fisherai-anchored-confirmation');
  setClasses(ledger, 'fisherai-confirmation-ledger');
  setClasses(ledgerLabel, 'fisherai-confirmation-kind');
  setClasses(tick, 'fisherai-confirmation-tick');
  setClasses(title, 'fisherai-confirmation-title');
  setClasses(description, 'fisherai-confirmation-description');
  setClasses(actions, 'fisherai-confirmation-actions');
  confirm.dataset.fisheraiConfirmationConfirm = 'true';
  cancel.dataset.fisheraiConfirmationCancel = 'true';
  ledger.append(ledgerLabel);
  confirmation.append(tick, ledger, title, description);

  let remember: HTMLInputElement | null = null;
  if (canRemember) {
    const rememberControl = document.createElement('label');
    remember = document.createElement('input');
    const rememberCopy = document.createElement('span');
    remember.type = 'checkbox';
    remember.checked = true;
    remember.dataset.fisheraiConfirmationRemember = 'true';
    rememberCopy.textContent = '下次不再提醒';
    setClasses(rememberControl, 'fisherai-confirmation-remember');
    rememberControl.append(remember, rememberCopy);
    confirmation.append(rememberControl);
  }
  actions.append(cancel, confirm);
  confirmation.append(actions);
  document.body.append(confirmation);

  const panelWidth = confirmation.offsetWidth || Math.min(340, window.innerWidth - 24);
  const panelHeight = confirmation.offsetHeight || (canRemember ? 224 : 188);
  const viewportGap = 12;
  const placeAbove = point.y + 12 + panelHeight > window.innerHeight - viewportGap;
  const left = Math.min(
    Math.max(viewportGap, point.x - 28),
    Math.max(viewportGap, window.innerWidth - panelWidth - viewportGap),
  );
  const top = placeAbove
    ? Math.max(viewportGap, point.y - panelHeight - 12)
    : Math.min(point.y + 12, window.innerHeight - panelHeight - viewportGap);
  confirmation.style.left = `${Math.round(left)}px`;
  confirmation.style.top = `${Math.round(top)}px`;
  confirmation.style.setProperty(
    '--fisherai-confirmation-anchor-x',
    `${Math.round(Math.min(Math.max(18, point.x - left), panelWidth - 18))}px`,
  );
  confirmation.dataset.placement = placeAbove ? 'above' : 'below';

  const previousExpanded = focusTarget?.getAttribute('aria-expanded');
  const previousControls = focusTarget?.getAttribute('aria-controls');
  if (focusTarget) {
    focusTarget.setAttribute('aria-expanded', 'true');
    focusTarget.setAttribute('aria-controls', confirmationId);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      if (confirmed && canRemember && remember?.checked) {
        suppressConfirmation(options.rememberKey!);
      }
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      confirmation.remove();
      if (focusTarget) {
        if (previousExpanded == null) focusTarget.removeAttribute('aria-expanded');
        else focusTarget.setAttribute('aria-expanded', previousExpanded);
        if (previousControls == null) focusTarget.removeAttribute('aria-controls');
        else focusTarget.setAttribute('aria-controls', previousControls);
        if (focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
      }
      if (closeActiveConfirmation === finish) closeActiveConfirmation = null;
      resolve(confirmed);
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!confirmation.contains(event.target as Node) && event.target !== focusTarget)
        finish(false);
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish(false);
    };
    confirmation.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [remember, cancel, confirm].filter(
        (control): control is HTMLInputElement | HTMLButtonElement =>
          control !== null && !control.disabled,
      );
      const currentIndex = controls.indexOf(
        document.activeElement as HTMLInputElement | HTMLButtonElement,
      );
      if (!event.shiftKey && currentIndex === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      } else if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      }
    });
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    closeActiveConfirmation = finish;
    queueMicrotask(() => cancel.focus({ preventScroll: true }));
  });
}

export function createInput(options: {
  label: string;
  value?: string;
  placeholder?: string;
  type?: HTMLInputElement['type'];
}): LabeledControl<HTMLInputElement> {
  const element = document.createElement('label');
  const label = document.createElement('span');
  const input = document.createElement('input');
  input.id = nextId('input');
  input.type = options.type ?? 'text';
  input.value = options.value ?? '';
  input.placeholder = options.placeholder ?? '';
  input.setAttribute('aria-label', options.label);
  label.id = nextId('label');
  label.textContent = options.label;
  element.htmlFor = input.id;
  element.append(label, input);
  setClasses(element, 'fisherai-field');
  setClasses(input, 'fisherai-input');
  return { element, label, input };
}

export function createSelect(options: {
  label: string;
  value?: string;
  options: Array<{ label: string; value: string }>;
}): SelectControl {
  const element = document.createElement('label');
  const label = document.createElement('span');
  const select = document.createElement('select');
  select.id = nextId('select');
  select.setAttribute('aria-label', options.label);
  label.textContent = options.label;
  for (const option of options.options) {
    const child = document.createElement('option');
    child.value = option.value;
    child.textContent = option.label;
    child.selected = option.value === options.value;
    select.append(child);
  }
  element.htmlFor = select.id;
  element.append(label, select);
  setClasses(element, 'fisherai-field');
  setClasses(select, 'fisherai-select');
  return { element, label, select };
}

function createDisclosure(label: string, kind: string): OverlayControl {
  const element = document.createElement('div');
  const trigger = createButton({ label, variant: 'ghost' });
  const content = document.createElement('div');
  const contentId = nextId(kind);
  content.id = contentId;
  content.hidden = true;
  trigger.setAttribute('aria-controls', contentId);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    const expanded = trigger.getAttribute('aria-expanded') !== 'true';
    trigger.setAttribute('aria-expanded', String(expanded));
    content.hidden = !expanded;
  });
  element.append(trigger, content);
  setClasses(element, `fisherai-${kind}`);
  setClasses(content, `fisherai-${kind}-content`);
  return { element, trigger, content };
}

export function createPopover(options: { label: string }): OverlayControl {
  return createDisclosure(options.label, 'popover');
}

export function createDialog(options: { title: string; description?: string }): {
  element: HTMLDivElement;
  title: HTMLHeadingElement;
  description?: HTMLParagraphElement;
  close(): void;
} {
  const element = document.createElement('div');
  const title = document.createElement('h2');
  const titleId = nextId('dialog-title');
  title.id = titleId;
  title.textContent = options.title;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-labelledby', titleId);
  element.tabIndex = -1;
  element.append(title);
  let description: HTMLParagraphElement | undefined;
  if (options.description) {
    description = document.createElement('p');
    description.id = nextId('dialog-description');
    description.textContent = options.description;
    element.setAttribute('aria-describedby', description.id);
    element.append(description);
  }
  setClasses(element, 'fisherai-dialog');
  const close = () => {
    element.hidden = true;
  };
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  return { element, title, description, close };
}

export function createDangerousConfirmation(options: {
  objectName: string;
  actionLabel?: string;
  onConfirm?: () => void;
}): ReturnType<typeof createDialog> & {
  confirm: HTMLButtonElement;
  cancel: HTMLButtonElement;
} {
  const dialog = createDialog({
    title: '确认危险操作',
    description: `将永久删除“${options.objectName}”，此操作无法撤销。`,
  });
  dialog.element.dataset.fisheraiDanger = 'true';
  const actions = document.createElement('div');
  const cancel = createButton({ label: '取消', onClick: dialog.close });
  const confirm = createButton({
    label: options.actionLabel ?? '确认删除',
    variant: 'danger',
    onClick: () => {
      options.onConfirm?.();
      dialog.close();
    },
  });
  actions.append(cancel, confirm);
  dialog.element.append(actions);
  setClasses(actions, 'fisherai-dialog-actions');
  return { ...dialog, confirm, cancel };
}

export function createToast(options: { message: string; tone?: ToastTone }): HTMLDivElement {
  const toast = document.createElement('div');
  toast.textContent = options.message;
  toast.setAttribute('role', options.tone === 'danger' ? 'alert' : 'status');
  toast.setAttribute('aria-live', options.tone === 'danger' ? 'assertive' : 'polite');
  setClasses(toast, 'fisherai-toast', `is-${options.tone ?? 'neutral'}`);
  return toast;
}

export function createTooltip(options: { text: string; triggerLabel?: string }): OverlayControl {
  const element = document.createElement('div');
  const trigger = createButton({ label: options.triggerLabel ?? '帮助', variant: 'ghost' });
  const content = document.createElement('div');
  content.id = nextId('tooltip');
  content.textContent = options.text;
  content.setAttribute('role', 'tooltip');
  content.hidden = true;
  trigger.setAttribute('aria-describedby', content.id);
  const show = () => {
    content.hidden = false;
  };
  const hide = () => {
    content.hidden = true;
  };
  trigger.addEventListener('focus', show);
  trigger.addEventListener('blur', hide);
  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mouseleave', hide);
  element.append(trigger, content);
  setClasses(element, 'fisherai-tooltip');
  setClasses(content, 'fisherai-tooltip-content');
  return { element, trigger, content };
}

export function createTabs(options: {
  label: string;
  items: Array<{ id: string; label: string }>;
}): { element: HTMLDivElement; tabs: HTMLButtonElement[]; panels: HTMLDivElement[] } {
  const element = document.createElement('div');
  const tablist = document.createElement('div');
  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLDivElement[] = [];
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', options.label);
  const activate = (index: number) => {
    tabs.forEach((tab, candidate) => {
      const active = candidate === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[candidate].hidden = !active;
    });
    tabs[index].focus();
  };
  options.items.forEach((item, index) => {
    const tab = createButton({ label: item.label, variant: 'ghost' });
    const panel = document.createElement('div');
    tab.id = nextId(`tab-${item.id}`);
    panel.id = nextId(`panel-${item.id}`);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.setAttribute('aria-selected', String(index === 0));
    tab.tabIndex = index === 0 ? 0 : -1;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.hidden = index !== 0;
    tab.addEventListener('click', () => activate(index));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(next);
    });
    tablist.append(tab);
    element.append(panel);
    tabs.push(tab);
    panels.push(panel);
  });
  element.prepend(tablist);
  setClasses(element, 'fisherai-tabs');
  return { element, tabs, panels };
}

export function createMenu(options: {
  label: string;
  items: Array<{ id: string; label: string; danger?: boolean; onSelect?: () => void }>;
}): { element: HTMLDivElement; trigger: HTMLButtonElement; menu: HTMLDivElement } {
  const { element, trigger, content: menu } = createDisclosure(options.label, 'menu');
  menu.setAttribute('role', 'menu');
  options.items.forEach((item) => {
    const button = createButton({ label: item.label, variant: item.danger ? 'danger' : 'ghost' });
    button.dataset.action = item.id;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      item.onSelect?.();
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      trigger.focus();
    });
    menu.append(button);
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    trigger.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    trigger.focus();
  });
  return { element, trigger, menu };
}

const DESIGN_CSS = `
:root {
  color-scheme: inherit;
  --fisherai-canvas: var(--af-canvas);
  --fisherai-surface: var(--af-surface);
  --fisherai-surface-raised: var(--af-surface-raised);
  --fisherai-border: var(--af-border);
  --fisherai-text: var(--af-text);
  --fisherai-text-muted: var(--af-text-muted);
  --fisherai-focus: var(--af-focus);
  --fisherai-success: var(--af-success);
  --fisherai-warning: var(--af-warning);
  --fisherai-danger: var(--af-danger);
  --fisherai-edge-danger: var(--af-danger);
  --fisherai-radius-sm: ${DESIGN_TOKENS.radius.small};
  --fisherai-radius-md: ${DESIGN_TOKENS.radius.medium};
  --fisherai-radius-lg: ${DESIGN_TOKENS.radius.large};
  --fisherai-motion-fast: ${DESIGN_TOKENS.motion.fast};
  --fisherai-motion-normal: ${DESIGN_TOKENS.motion.normal};
}
.fisherai-ui { font: inherit; }
.fisherai-button, .fisherai-input, .fisherai-select {
  border: 1px solid var(--fisherai-border); border-radius: var(--fisherai-radius-md);
  color: var(--fisherai-text); background: var(--fisherai-surface-raised);
}
.fisherai-button { min-height: 36px; padding: 8px 14px; cursor: pointer; }
.fisherai-button.is-primary { color: var(--af-on-primary); background: var(--af-primary); }
.fisherai-key-link { display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; text-decoration: none; font: inherit; transition: background .15s, box-shadow .15s; }
.fisherai-key-link:hover { color: var(--af-on-primary); background: color-mix(in srgb, var(--af-primary) 88%, var(--af-on-primary)); }
.fisherai-key-link:focus-visible { outline: 2px solid var(--af-focus); outline-offset: 3px; }
input.fisherai-key-input { border: 1px solid var(--af-info); background: var(--af-info-bg); color: var(--af-text); outline: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--af-focus) 10%, transparent); transition: border-color .15s, background .15s, box-shadow .15s; }
input.fisherai-key-input::placeholder { color: var(--af-text-secondary); opacity: 1; }
input.fisherai-key-input:hover { border-color: var(--af-focus); }
input.fisherai-key-input:focus { border-color: var(--af-focus); background: var(--af-input); box-shadow: 0 0 0 3px color-mix(in srgb, var(--af-focus) 24%, transparent); }
.fisherai-button.is-danger, .fisherai-toast.is-danger { border-color: var(--fisherai-danger); }
.fisherai-button:disabled, [aria-disabled="true"] { cursor: not-allowed; opacity: .42; }
.fisherai-field { display: grid; gap: 6px; color: var(--fisherai-text-muted); }
.fisherai-input, .fisherai-select { min-height: 38px; padding: 8px 10px; }
.fisherai-dialog, .fisherai-popover-content, .fisherai-menu-content, .fisherai-toast {
  border: 1px solid var(--fisherai-border); border-radius: var(--fisherai-radius-lg);
  color: var(--fisherai-text); background: var(--fisherai-surface); box-shadow: 0 24px 64px rgb(0 0 0 / .48);
}
.fisherai-dialog { max-width: min(560px, calc(100vw - 32px)); padding: 24px; }
.fisherai-toast { padding: 12px 16px; }
.fisherai-toast.is-success { border-color: var(--fisherai-success); }
.fisherai-toast.is-warning { border-color: var(--fisherai-warning); }
.fisherai-anchored-confirmation {
  position: fixed; z-index: 2147483000; box-sizing: border-box;
  width: min(340px, calc(100vw - 24px)); padding: 14px;
  border: 1px solid var(--af-border); border-radius: var(--fisherai-radius-lg);
  color: var(--fisherai-text); background: var(--af-input);
  box-shadow: 0 24px 64px rgb(0 0 0 / .64), inset 0 1px rgb(255 255 255 / .035);
  animation: fisherai-confirmation-in var(--fisherai-motion-fast) ease-out;
}
.fisherai-anchored-confirmation[data-fisherai-confirmation-intent="destructive"] {
  border-color: color-mix(in srgb, var(--fisherai-danger) 52%, var(--af-border));
}
.fisherai-confirmation-ledger {
  display: flex; align-items: center; gap: 8px; margin-bottom: 9px;
  color: var(--af-text-muted); font: 600 10px/1.3 'Cascadia Code', Consolas, monospace;
  letter-spacing: .09em;
}
.fisherai-confirmation-ledger::after { content: ''; height: 1px; flex: 1; background: var(--af-hover); }
.fisherai-confirmation-title { margin: 0; color: var(--fisherai-text); font-size: 14px; line-height: 1.4; font-weight: 700; }
.fisherai-confirmation-description { margin: 6px 0 0; color: var(--fisherai-text-muted); font-size: 12px; line-height: 1.6; }
.fisherai-confirmation-remember {
  display: flex; align-items: center; gap: 8px; margin-top: 12px;
  color: var(--af-text-secondary); font-size: 11px; cursor: pointer;
}
.fisherai-confirmation-remember input { width: 14px; height: 14px; margin: 0; accent-color: var(--af-primary); }
.fisherai-confirmation-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.fisherai-confirmation-actions .fisherai-button { min-height: 32px; padding: 6px 11px; font-size: 11px; }
.fisherai-confirmation-actions .fisherai-button.is-ghost { color: var(--af-text-secondary); background: transparent; border-color: transparent; }
.fisherai-confirmation-actions .fisherai-button.is-danger { color: var(--af-danger); background: var(--af-danger-bg); border-color: var(--af-danger); }
.fisherai-confirmation-tick {
  position: absolute; left: calc(var(--fisherai-confirmation-anchor-x) - 5px);
  width: 10px; height: 10px; border: 1px solid var(--af-border); background: var(--af-input);
  transform: rotate(45deg);
}
.fisherai-anchored-confirmation[data-placement="below"] .fisherai-confirmation-tick { top: -6px; border-right: 0; border-bottom: 0; }
.fisherai-anchored-confirmation[data-placement="above"] .fisherai-confirmation-tick { bottom: -6px; border-left: 0; border-top: 0; }
@keyframes fisherai-confirmation-in {
  from { opacity: 0; transform: translateY(3px) scale(.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.fisherai-regeneration-overlay {
  position: absolute; inset: 0; z-index: 20; display: grid; place-items: center;
  overflow: hidden; isolation: isolate; border-radius: inherit;
  container-type: inline-size; contain: paint;
  transform: translateZ(0);
  color: var(--fisherai-text); background-color: var(--af-surface);
}
.fisherai-regeneration-overlay::before {
  content: ''; position: absolute; inset: 0; z-index: 0;
  background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--af-focus) 12%, transparent), transparent 40%),
    linear-gradient(180deg, var(--af-surface-raised) 0, var(--af-canvas) 72%);
  opacity: .9;
}
.fisherai-regeneration-exposure { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.fisherai-regeneration-exposure-band {
  position: absolute; top: -30%; bottom: -30%; left: -44%; width: 34%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--af-focus) 32%, transparent) 48%, transparent);
  opacity: .34; transform: translate3d(-20%, 0, 0) rotate(10deg);
  will-change: transform, opacity;
  animation: fisherai-exposure-sweep 4.8s cubic-bezier(.25, 1, .5, 1) infinite;
}
.fisherai-regeneration-exposure-orbit {
  position: absolute; left: 50%; top: 50%; width: clamp(190px, 32cqw, 360px);
  aspect-ratio: 1; border: 1px solid var(--af-border-control); border-radius: 999px;
  opacity: .36; transform: translate3d(-50%, -50%, 0) scale(.86);
  will-change: transform, opacity;
  animation: fisherai-exposure-breathe 3.2s cubic-bezier(.45, 0, .55, 1) infinite;
}
.fisherai-regeneration-exposure-orbit::before,
.fisherai-regeneration-exposure-orbit::after {
  content: ''; position: absolute; border-radius: inherit; border: 1px solid var(--af-border);
}
.fisherai-regeneration-exposure-orbit::before { inset: 16%; }
.fisherai-regeneration-exposure-orbit::after { inset: 34%; background: rgb(255 255 255 / .025); }
.fisherai-regeneration-copy {
  position: relative; z-index: 2; display: grid; grid-template-columns: auto minmax(0, 1fr);
  align-items: center; gap: 15px; min-width: clamp(300px, 32cqw, 420px);
  max-width: calc(100% - 48px); padding: 17px 20px;
  border: 1px solid var(--af-border-control); border-radius: 10px;
  color: var(--af-text); background: var(--af-surface-raised);
  box-shadow: 0 18px 50px rgb(0 0 0 / .55), inset 0 1px rgb(255 255 255 / .035);
}
.fisherai-regeneration-copy-text { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
.fisherai-regeneration-copy strong {
  color: var(--af-text); font-size: clamp(18px, 1.85cqw, 24px); line-height: 1.25;
  font-weight: 700; letter-spacing: -.01em;
}
.fisherai-regeneration-copy small {
  color: var(--af-text-secondary); font-size: clamp(12px, 1.15cqw, 14px); line-height: 1.4; font-weight: 500;
}
.fisherai-regeneration-meter { display: flex; align-items: center; gap: 4px; height: 22px; }
.fisherai-regeneration-meter i {
  display: block; width: 3px; height: 20px; border-radius: 999px; background: var(--af-text-secondary);
  opacity: .34; transform: scaleY(.4); transform-origin: center;
  will-change: transform, opacity;
  animation: fisherai-exposure-meter 1.2s linear infinite;
}
.fisherai-regeneration-meter i:nth-child(2) { animation-delay: .16s; }
.fisherai-regeneration-meter i:nth-child(3) { animation-delay: .32s; }
.fisherai-regeneration-overlay[data-fisherai-motion="paused"] .fisherai-regeneration-exposure-band,
.fisherai-regeneration-overlay[data-fisherai-motion="paused"] .fisherai-regeneration-exposure-orbit,
.fisherai-regeneration-overlay[data-fisherai-motion="paused"] .fisherai-regeneration-meter i {
  animation-play-state: paused;
}
@keyframes fisherai-exposure-sweep {
  0% { opacity: 0; transform: translate3d(-20%, 0, 0) rotate(10deg); }
  14% { opacity: .48; }
  72% { opacity: .3; }
  100% { opacity: 0; transform: translate3d(430%, 0, 0) rotate(10deg); }
}
@keyframes fisherai-exposure-breathe {
  0%, 100% { opacity: .3; transform: translate3d(-50%, -50%, 0) scale(.86); }
  50% { opacity: .6; transform: translate3d(-50%, -50%, 0) scale(1.05); }
}
@keyframes fisherai-exposure-meter {
  0%, 100% { opacity: .3; transform: scaleY(.38); }
  44% { opacity: .95; transform: scaleY(1); }
}
/*
 * 富文本编辑器要排除掉，别看它也匹配 [tabindex]。
 *
 * 提示词编辑器（Tiptap/ProseMirror）自己会挂 tabindex="0"，于是这条焦点环套在了
 * 编辑器那个只有一行高的内容盒上，而它外面就是滚动容器：环的上边和左右边被裁掉，
 * 只剩下边留在可视区——用户看到的就是"输入框里凭空多出一条蓝线"，
 * 字一多、内容盒长过视口，下边滚出去，又变成右边一条竖线。（2026-08-12 真机确认）
 *
 * 文本编辑区的焦点指示本来就是光标，环在这里只添乱，不是可访问性损失。
 */
:where(button, a, input, select, textarea, [tabindex]):not([contenteditable="true"]):focus-visible {
  outline: 2px solid var(--fisherai-focus) !important; outline-offset: 3px !important;
}
[data-fisherai-state="loading"] { cursor: progress; }
[data-fisherai-state="empty"] { color: var(--fisherai-text-muted); }
[data-fisherai-state="error"] { border-color: var(--fisherai-danger); }
[data-fisherai-danger="true"] { color: var(--fisherai-danger); }
[data-fisherai-canvas-version] {
  margin: 0 20px 20px; padding-top: 14px; border-top: 1px solid var(--af-border);
  color: var(--af-text-secondary); font-size: 12px; line-height: 1.4; letter-spacing: .02em;
}
.fisherai-canvas-edge {
  transition: opacity var(--fisherai-motion-fast) ease;
}
.fisherai-canvas-edge .fisherai-edge-visible,
.fisherai-canvas-edge .edge-flow-segments,
.fisherai-canvas-edge .fisherai-edge-scissors {
  transition: opacity var(--fisherai-motion-fast) ease, stroke var(--fisherai-motion-fast) ease;
}
.fisherai-canvas-edge .fisherai-edge-scissors {
  opacity: 0;
}
.fisherai-canvas-edge:hover {
  opacity: 1 !important;
}
.fisherai-canvas-edge:hover .fisherai-edge-visible {
  stroke: var(--af-danger) !important;
  stroke-opacity: .82 !important;
}
.fisherai-canvas-edge:hover .edge-flow-segments {
  opacity: 1;
}
.fisherai-canvas-edge:hover .edge-flow-segments path {
  filter: drop-shadow(0 0 4px rgba(255, 77, 90, .62));
  will-change: d, opacity;
}
.fisherai-canvas-edge:hover .fisherai-edge-scissors {
  opacity: 1;
}
@media (max-width: 1279px) {
  [data-fisherai-shell="projects"] main { padding-inline: 24px !important; }
}
@media (min-width: 2560px) {
  [data-fisherai-shell="projects"] main { max-width: 1600px !important; }
  [data-fisherai-settings="true"] { max-width: 1280px !important; }
}

/* The existing settings page uses one measured navigation/content layout. */
[data-fisherai-settings="true"] { width: min(1080px, calc(100vw - 48px)) !important; height: min(760px, calc(100dvh - 64px)) !important; max-height: calc(100dvh - 32px); background: var(--af-input) !important; border: 1px solid var(--af-border) !important; border-radius: 12px !important; overflow: hidden; font-size: 14px; }
[data-fisherai-settings-sidebar] { width: 200px !important; flex: 0 0 200px !important; padding: 24px 12px !important; background: var(--af-input) !important; }
[data-fisherai-settings-sidebar] > div:first-child { padding: 0 12px 20px !important; color: var(--af-text) !important; font-size: 18px !important; }
[data-fisherai-settings-sidebar] nav { gap: 6px !important; }
[data-fisherai-settings-sidebar] nav button { min-height: 42px; padding: 10px 12px !important; border-radius: 6px !important; font-size: 14px !important; font-weight: 500 !important; color: var(--af-text-secondary); white-space: nowrap; }
[data-fisherai-settings-content] { padding: 20px 24px 24px !important; min-width: 0; overflow-y: auto; overscroll-behavior: contain; }
[data-fisherai-settings-content] > div { padding-left: 0 !important; padding-right: 0 !important; }
[data-fisherai-settings-content] > div:first-child { padding-top: 0 !important; padding-bottom: 16px; }
[data-fisherai-settings-content] > div:first-child > button { padding: 8px !important; }
[data-fisherai-settings-sidebar] nav { padding: 0 !important; }
[data-fisherai-settings-sidebar] nav button[class*="text-blue"] { background: var(--af-surface-raised) !important; color: var(--af-text) !important; }
[data-fisherai-settings-sidebar] nav[data-fisherai-storage-active] button:not([data-fisherai-download-storage-button]) { background: transparent !important; color: var(--af-text-secondary) !important; }
[data-fisherai-download-storage-button][aria-selected="true"] { background: var(--af-selected) !important; color: var(--af-on-selected) !important; }
[data-fisherai-settings-content] p { color: var(--af-text-secondary); }
[data-fisherai-settings-content] > button:first-child { top: 16px !important; right: 16px !important; width: 32px; height: 32px; }
[data-fisherai-settings-content] h3 { font-size: 18px !important; line-height: 1.4; }
[data-fisherai-settings-content] p { font-size: 13px; line-height: 1.65; }
[data-fisherai-settings-content] input:not([type="checkbox"]), [data-fisherai-settings-content] select { min-height: 40px; font-size: 14px; }
[data-fisherai-source-body] { padding: 20px !important; }
[data-fisherai-source-toggle] { padding: 18px 20px !important; gap: 16px !important; }
[data-fisherai-source-save], a.fisherai-key-link { min-height: 40px; padding: 10px 18px; border: 0; border-radius: 8px; background: var(--af-primary); color: var(--af-on-primary); font-size: 14px; font-weight: 600; line-height: 1.5; }
@media (max-width: 760px) {
  [data-fisherai-settings="true"] { width: calc(100vw - 24px) !important; height: calc(100dvh - 24px) !important; }
  [data-fisherai-settings-sidebar] { width: 148px !important; flex-basis: 148px !important; padding: 20px 8px !important; }
  [data-fisherai-settings-sidebar] nav button { white-space: normal; text-align: left; }
  [data-fisherai-settings-content] { padding: 48px 20px 24px !important; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important; animation-duration: .01ms !important;
    animation-iteration-count: 1 !important; transition-duration: .01ms !important;
  }
}
`;

function inferShell(root: ParentNode): StableDesignReport['shell'] {
  const bodyText =
    root instanceof Document ? (root.body?.textContent ?? '') : (root.textContent ?? '');
  if (bodyText.includes('新建项目') && bodyText.includes('项目')) return 'projects';
  if (bodyText.includes('快捷键说明') || bodyText.includes('Saved ')) return 'canvas';
  return 'unknown';
}

function labelIconButtons(root: ParentNode): number {
  let labelled = 0;
  root.querySelectorAll<HTMLButtonElement>('button[title]').forEach((button) => {
    if (
      button.getAttribute('aria-label') ||
      button.getAttribute('aria-labelledby') ||
      button.textContent?.trim()
    )
      return;
    const label = button.title.trim();
    if (!label) return;
    button.setAttribute('aria-label', label);
    labelled += 1;
  });
  return labelled;
}
const settingsFocus = new WeakMap<HTMLElement, () => void>();

function enhanceSettings(root: ParentNode): string[] {
  const owned = root.querySelector<HTMLElement>('[data-fisherai-settings-owned="true"]');
  if (owned)
    return [...owned.querySelectorAll<HTMLElement>('[data-fisherai-settings-section]')].map(
      (element) => element.dataset.fisheraiSettingsSection!,
    );
  const settingsTitle = Array.from(root.querySelectorAll<HTMLElement>('*')).find(
    (element) =>
      element.children.length === 0 &&
      element.textContent?.trim() === '设置' &&
      !element.closest('button'),
  );
  const candidate = settingsTitle?.parentElement?.parentElement;
  const panel = candidate?.querySelector('nav')?.parentElement?.parentElement ?? null;
  if (panel) {
    panel.dataset.fisheraiSettings = 'true';
    panel.setAttribute('role', panel.getAttribute('role') ?? 'dialog');
    panel.setAttribute('aria-label', 'AIFISHER 画布设置');
    panel.setAttribute('aria-modal', 'true');
    const sidebar = panel.querySelector('nav')?.parentElement;
    if (sidebar) sidebar.dataset.fisheraiSettingsSidebar = 'true';
    const content = sidebar?.nextElementSibling;
    if (content instanceof HTMLElement) content.dataset.fisheraiSettingsContent = 'true';
    const close = content?.querySelector<HTMLButtonElement>(
      ':scope > button, :scope > div:first-child > button',
    );
    if (close) {
      close.setAttribute('aria-label', '关闭设置');
      close.title = '关闭设置';
      if (!close.querySelector('[data-fisherai-settings-return]')) {
        const label = document.createElement('span');
        label.dataset.fisheraiSettingsReturn = 'true';
        label.textContent = '返回工作台';
        close.append(label);
        Object.assign(close.style, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
        });
        close.querySelector('svg')?.setAttribute('width', '18');
        close.querySelector('svg')?.setAttribute('height', '18');
      }
      if (!settingsFocus.has(panel))
        settingsFocus.set(
          panel,
          activateModal(panel, () => close.click()),
        );
    }
  }
  const mapping: Record<string, string> = {
    个人设置: 'profile',
    密钥配置: 'models',
    闭源服务: 'models',
    本机服务: 'local-service',
    开源配置: 'local-service',
    开源服务: 'local-service',
    '关于 AIFISHER 画布': 'diagnostics',
  };
  const found: string[] = [];
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const currentLabel = button.textContent?.trim() ?? '';
    const section = mapping[currentLabel];
    if (!section) return;
    if (currentLabel === '密钥配置') button.textContent = '闭源服务';
    button.dataset.fisheraiSettingsSection = section;
    button.setAttribute('aria-label', button.textContent?.trim() ?? section);
    found.push(section);
  });
  const documentRoot = root instanceof Document ? root : (root.ownerDocument ?? document);
  const build = documentRoot.documentElement.dataset.fisheraiBuild?.trim();
  const aboutButton = root.querySelector<HTMLButtonElement>(
    'button[data-fisherai-settings-section="diagnostics"]',
  );
  const settingsSidebar = aboutButton?.closest('nav')?.parentElement;
  if (build && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(build) && settingsSidebar) {
    const productVersion = build.slice(1);
    let version = settingsSidebar.querySelector<HTMLElement>('[data-fisherai-canvas-version]');
    if (!version) {
      version = documentRoot.createElement('div');
      settingsSidebar.append(version);
    }
    version.dataset.fisheraiCanvasVersion = productVersion;
    const versionLabel = `AIFISHER 画布 · ${build}`;
    if (version.textContent !== versionLabel) version.textContent = versionLabel;
  }
  const contentDomains = new Map<string, string>([
    ['本机服务', 'local-service'],
    ['火山 TOS 存储', 'storage'],
    ['HTTPS 代理', 'network'],
    ['系统诊断', 'diagnostics'],
  ]);
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, a').forEach((element) => {
    const domain = contentDomains.get(element.textContent?.trim() ?? '');
    if (!domain) return;
    element.dataset.fisheraiSettingsDomain = domain;
    found.push(domain);
  });
  if (panel) {
    panel.dataset.fisheraiSettingsDomains = 'models storage local-service network diagnostics';
  }
  return [...new Set(found)];
}

function enhanceStableShell(root: ParentNode = document): StableDesignReport {
  const shell = inferShell(root);
  const documentRoot = root instanceof Document ? root : (root.ownerDocument ?? document);
  if (documentRoot.body) documentRoot.body.dataset.fisheraiShell = shell;
  const main = root.querySelector('main');
  if (main && shell === 'projects') main.setAttribute('aria-label', 'AIFISHER 项目');
  const settingsSections = enhanceSettings(root);
  return { shell, labelledButtons: labelIconButtons(root), settingsSections };
}

function regenerationOverlays(root: ParentNode): HTMLElement[] {
  const overlays = Array.from(
    root.querySelectorAll<HTMLElement>('[data-fisherai-regeneration-overlay="true"]'),
  );
  if (root instanceof HTMLElement && root.matches('[data-fisherai-regeneration-overlay="true"]')) {
    overlays.unshift(root);
  }
  return overlays;
}

export function installStableDesignSystem(): StableDesignSystemAdapter {
  if (window.__FISHERAI_DESIGN_SYSTEM__) return window.__FISHERAI_DESIGN_SYSTEM__;
  installConfirmationPointerTracking();
  if (!document.querySelector('#fisherai-design-system')) {
    const style = document.createElement('style');
    style.id = 'fisherai-design-system';
    style.textContent = DESIGN_CSS;
    document.head.append(style);
  }
  document.documentElement.dataset.fisheraiDesign = 'stable-v1';
  const adapter: StableDesignSystemAdapter = {
    tokens: DESIGN_TOKENS,
    enhance: enhanceStableShell,
    confirm: requestAnchoredConfirmation,
    isConfirmationSuppressed,
    resetConfirmationPreference,
    observe() {
      let queued = false;
      const observedOverlays = new WeakSet<HTMLElement>();
      const motionObserver =
        typeof IntersectionObserver === 'undefined'
          ? null
          : new IntersectionObserver((entries) => {
              entries.forEach((entry) => {
                if (!(entry.target instanceof HTMLElement)) return;
                entry.target.dataset.fisheraiMotion = entry.isIntersecting ? 'running' : 'paused';
              });
            });
      const observeMotion = (root: ParentNode) => {
        regenerationOverlays(root).forEach((overlay) => {
          if (observedOverlays.has(overlay)) return;
          observedOverlays.add(overlay);
          overlay.dataset.fisheraiMotion = 'running';
          motionObserver?.observe(overlay);
        });
      };
      const stopObservingMotion = (root: ParentNode) => {
        regenerationOverlays(root).forEach((overlay) => {
          observedOverlays.delete(overlay);
          motionObserver?.unobserve(overlay);
        });
      };
      const observer = new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) observeMotion(node);
          });
          record.removedNodes.forEach((node) => {
            if (node instanceof HTMLElement) stopObservingMotion(node);
          });
        });
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          enhanceStableShell(document);
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      enhanceStableShell(document);
      observeMotion(document);
      return () => {
        observer.disconnect();
        motionObserver?.disconnect();
      };
    },
  };
  window.__FISHERAI_DESIGN_SYSTEM__ = adapter;
  adapter.enhance(document);
  return adapter;
}
