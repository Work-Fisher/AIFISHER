/**
 * promptExpand.ts
 *
 * 给提示词输入框加一个「放大」按钮：点一下，输入框铺满屏幕，
 * 长提示词一眼看全，不用在 90px 高的小窗里滚轮找字。
 *
 * 关键约束：**全屏里必须继续使用原来那个编辑器 DOM 本体，不能新建一个再同步文本**。
 * `图片1` 这类引用在编辑器里是 ProseMirror 的 mention 节点，不是纯文本；
 * 重新建一个编辑器会把它们退化成死字符串，出片时转不出 `<Picture N>`，
 * MiniMax 那条链直接断。复用本体才是同一个编辑器实例、同一份 React state，
 * 数据通路一点没动。
 *
 * 标准图片/视频 Composer 不能整体搬 DOM：编辑态一旦在外部发生 React 重渲染，
 * `@` 建议菜单会被原父子关系回收。这里让真实 Tiptap 保留在原 React 父节点，
 * 整个 Composer 通过 Popover API 原位进入浏览器 Top Layer，保留所有 React 交互。
 *
 * 旧式独立提示词框仍采用“搬本体”降级，但**只能挪到 React 根容器里面**：
 * React 18 把所有委托监听挂在根容器上，元素一旦搬出根容器，
 * 它身上的事件就再也传不到 React——稳定版原生框"点一下进编辑态"的 onClick 随之失效，
 * 中途失焦掉回只读后就再也救不回来，表现是"打字完全没反应"。（2026-08-12 真机定位）
 *
 * 覆盖两种框：MiniMax H3 的（`data-fisherai-minimax-prompt-surface`）
 * 和稳定版原生图片/视频/音频节点的（`.prompt-editor-container`）。
 *
 * 浮层里的尺寸一律用注入样式表的 `!important` 撑开，不去改元素的内联 style：
 * 内联 style 是 React 写的，它一次重渲染就会盖回去；
 * 而 `#id .class > *` 的 `!important` 既压得住内联样式，也压得住稳定版
 * `.prompt-editor-container{max-height:89.6px!important}` 那条同权重但更低特异性的规则。
 */

const BUTTON_ATTRIBUTE = 'data-fisherai-prompt-expand';
/** 打在提示词框上的「已经装过按钮」标记，避免 MutationObserver 每次都重复挂。 */
const TRIGGER_HOST_ATTRIBUTE = 'data-fisherai-prompt-expand-host';
const HOSTED_ATTRIBUTE = 'data-fisherai-prompt-expanded';
const PLACEHOLDER_ATTRIBUTE = 'data-fisherai-prompt-expand-placeholder';
const OVERLAY_ID = 'fisherai-prompt-expand-overlay';
const HOST_CLASS = 'fisherai-prompt-expand-host';
const STYLE_ID = 'fisherai-prompt-expand-style';
const COMPOSER_SELECTOR = '[data-fisherai-generation-composer]';
const COMPOSER_SHELL_ATTRIBUTE = 'data-fisherai-prompt-expand-composer-shell';
const COMPOSER_EDITOR_SLOT_ATTRIBUTE = 'data-fisherai-prompt-expand-editor-slot';
const EDITOR_POPOVER_ATTRIBUTE = 'data-fisherai-prompt-expand-editor-popover';
const SUGGESTION_POPOVER_ATTRIBUTE = 'data-fisherai-prompt-expand-suggestion-popover';

/** 两种提示词框：MiniMax H3 专用节点的，和稳定版原生节点的。 */
export const PROMPT_CONTAINER_SELECTOR =
  '[data-fisherai-minimax-prompt-surface],.prompt-editor-container';
export const PROMPT_EXPAND_TARGET_SELECTOR = `${COMPOSER_SELECTOR},${PROMPT_CONTAINER_SELECTOR}`;

export const PROMPT_EXPAND_CSS = `
[data-fisherai-generation-composer]:not([${HOSTED_ATTRIBUTE}]) {
  position: relative;
  display: flex !important;
  flex-direction: column;
  width: 760px !important;
  min-height: 220px;
  max-width: none !important;
}
[data-fisherai-generation-composer]:not([${HOSTED_ATTRIBUTE}]) > .prompt-editor-container {
  flex: 1 1 100px;
  min-height: 100px !important;
  max-height: none !important;
}
[data-fisherai-generation-composer="video"]:not([${HOSTED_ATTRIBUTE}]) > .prompt-editor-container {
  flex-basis: 64px;
  min-height: 64px !important;
}
[data-fisherai-generation-composer] .tiptap-editor {
  font-size: 16px;
  line-height: 1.65;
}
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgba(0, 0, 0, 0.72);
}
#${OVERLAY_ID} > [data-fisherai-prompt-expand-panel] {
  width: min(1280px, calc(100vw - 48px));
  height: min(900px, calc(100vh - 48px));
}
#${OVERLAY_ID} .${HOST_CLASS} > * {
  max-height: none !important;
  height: 100% !important;
  width: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  cursor: text;
}
#${OVERLAY_ID} [${COMPOSER_SHELL_ATTRIBUTE}] {
  display: flex !important;
  flex-direction: column;
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
  padding: 18px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
#${OVERLAY_ID} [${COMPOSER_SHELL_ATTRIBUTE}] > .prompt-editor-container {
  flex: 1 1 240px !important;
  min-height: 240px !important;
  max-height: none !important;
  margin-top: 8px !important;
}
#${OVERLAY_ID} [${COMPOSER_EDITOR_SLOT_ATTRIBUTE}] {
  flex: 1 1 240px !important;
  min-height: 240px !important;
  margin-top: 8px !important;
}
[${EDITOR_POPOVER_ATTRIBUTE}]:popover-open {
  position: fixed !important;
  inset: auto !important;
  top: var(--fisherai-prompt-popover-top) !important;
  left: var(--fisherai-prompt-popover-left) !important;
  width: var(--fisherai-prompt-popover-width) !important;
  height: var(--fisherai-prompt-popover-height) !important;
  min-height: 240px !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  border: 0 !important;
  background: var(--af-surface-raised) !important;
  color: var(--af-text) !important;
  box-shadow: none !important;
}
[${EDITOR_POPOVER_ATTRIBUTE}]:popover-open .tiptap-editor,
[${EDITOR_POPOVER_ATTRIBUTE}]:popover-open .tiptap-editor p {
  font-size: 18px !important;
  line-height: 1.7 !important;
}
[${SUGGESTION_POPOVER_ATTRIBUTE}]:popover-open {
  position: fixed !important;
  right: auto !important;
  bottom: auto !important;
  width: max-content !important;
  height: max-content !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  border: 0 !important;
  background: transparent !important;
  color: inherit !important;
}
#${OVERLAY_ID} [${COMPOSER_SHELL_ATTRIBUTE}] .tiptap-editor {
  font-size: 18px !important;
  line-height: 1.7 !important;
}
#${OVERLAY_ID} [${COMPOSER_SHELL_ATTRIBUTE}] > [aria-hidden="true"] {
  pointer-events: none;
  user-select: none;
}
/* 框已经在浮层里了，右上角再摆一个「放大」没有意义，标题栏那个 ✕ 才是出口。 */
#${OVERLAY_ID} [${BUTTON_ATTRIBUTE}] {
  display: none !important;
}
[${BUTTON_ATTRIBUTE}] {
  opacity: 0.32;
  transition: opacity 140ms ease, color 140ms ease;
}
[${BUTTON_ATTRIBUTE}]:hover,
[${BUTTON_ATTRIBUTE}]:focus-visible {
  opacity: 1;
  color: var(--af-text);
}
[data-fisherai-generation-composer] > [${BUTTON_ATTRIBUTE}] {
  top: 10px !important;
  right: 10px !important;
  width: 28px !important;
  height: 28px !important;
}
[data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}]:popover-open {
  display: flex !important;
  flex-direction: column !important;
  padding: 18px 24px !important;
  overflow: hidden !important;
  border-radius: 0 0 14px 14px !important;
}
[data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}] > * {
  flex-shrink: 0;
}
[data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}] > .prompt-editor-container {
  flex: 1 1 0 !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  margin: 12px 0 !important;
  overflow: hidden !important;
}
[data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}] > [${BUTTON_ATTRIBUTE}] {
  display: none !important;
}
[data-fisherai-reference-tabs] { display: none; }
[data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}] [data-fisherai-reference-tabs] {
  display: flex;
  overflow-x: auto;
  white-space: nowrap;
}
@media (max-width: 640px) {
  [data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}] > .h-9 {
    flex-wrap: wrap;
    height: auto !important;
    gap: 8px;
  }
  [data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}] > .h-9 > * {
    flex-wrap: wrap;
    height: auto;
    max-width: 100%;
  }
  #${OVERLAY_ID} { padding: 12px; }
  #${OVERLAY_ID} > [data-fisherai-prompt-expand-panel] {
    width: calc(100vw - 24px);
    height: calc(100dvh - 24px);
  }
  [data-fisherai-generation-composer][${EDITOR_POPOVER_ATTRIBUTE}]:popover-open {
    padding: 12px !important;
  }
}
`.trim();

// 箭头指右上 / 左下（沿 `/` 对角）。原来是沿 `\` 的，和按钮所在的右上角是同一条斜线，
// 看着像要把框往左下角收，方向感反了。
const EXPAND_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M20 10V4h-6M4 14v6h6M20 4l-6 6M4 20l6-6" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

type OpenState = {
  container: HTMLElement;
  editorContainer: HTMLElement;
  hostTarget: HTMLElement;
  parent: HTMLElement;
  nextSibling: ChildNode | null;
  placeholder: HTMLElement | null;
  overlay: HTMLElement;
  trigger: HTMLElement;
  cleanupPopover: (() => void) | null;
};

let open: OpenState | null = null;
const expandedScroll = new WeakMap<HTMLElement, number>();

function installStyle(root: Document) {
  if (root.getElementById(STYLE_ID)) return;
  const style = root.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PROMPT_EXPAND_CSS;
  root.head.append(style);
}

/**
 * 浮层挂哪儿。
 *
 * 首选 React 根容器：React 18 的委托监听全挂在那儿，搬进去的框才收得到自己的 onClick。
 * 挂到 `document.body` 上虽然位置也对，但事件出不去，稳定版的编辑态开关就废了。
 * 根容器上面若有 transform/filter/perspective（会让 `position: fixed` 相对它定位），
 * 那就只能退回 body——位置正确优先，至少还能用，只是中途失焦后要重开一次。
 */
function chooseOverlayHost(container: HTMLElement): HTMLElement {
  const document_ = container.ownerDocument;
  const view = document_.defaultView;
  let root: HTMLElement | null = null;
  for (let node: HTMLElement | null = container; node; node = node.parentElement) {
    // React 18 在根容器 DOM 节点上挂一个 `__reactContainer$xxx` 属性，用它认根最稳，
    // 比写死 `#root` 靠谱。
    if (Object.keys(node).some((key) => key.startsWith('__reactContainer$'))) {
      root = node;
      break;
    }
  }
  if (!root || !view) return document_.body;
  // 空串也算"没设"：jsdom 对这几个属性返回空串而不是 none，一刀切会把测试环境全判成有 transform。
  const breaksFixed = (value: string) => value !== '' && value !== 'none';
  for (let node: HTMLElement | null = root; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (
      breaksFixed(style.transform) ||
      breaksFixed(style.perspective) ||
      breaksFixed(style.filter)
    ) {
      return document_.body;
    }
  }
  return root;
}

/** 盯着编辑器保持可用的那个监听，关浮层时要停掉。 */
let stopEditorArming: (() => void) | null = null;
/** 一次「掉回只读」里最多戳几下稳定版，防止它不理我们时空转。 */
const REARM_LIMIT = 12;

/** 引用菜单关闭后恢复焦点，保留编辑器内的插入位置或选区。 */
function focusEditorPreservingSelection(container: HTMLElement, editor: HTMLElement) {
  const selection = container.ownerDocument.defaultView?.getSelection();
  const savedSelection =
    selection?.anchorNode &&
    selection.focusNode &&
    editor.contains(selection.anchorNode) &&
    editor.contains(selection.focusNode)
      ? {
          anchor: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focus: selection.focusNode,
          focusOffset: selection.focusOffset,
        }
      : null;
  editor.focus({ preventScroll: true });
  if (!selection) return;
  if (savedSelection) {
    selection.setBaseAndExtent(
      savedSelection.anchor,
      savedSelection.anchorOffset,
      savedSelection.focus,
      savedSelection.focusOffset,
    );
    return;
  }
  const range = container.ownerDocument.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 浮层开着的整段时间里，保证编辑器一直是可写的、并且焦点在里面。
 *
 * 稳定版原生的提示词框是「点一下才进编辑态」的（`disableDirectEdit`）：
 * 平时 `contenteditable="false"`，点击容器才由 React 翻成 true，
 * **而编辑器一失焦，它 100ms 后又翻回只读**。这套交互在节点里那个 90px 的小框上说得通，
 * 放到一个专门用来写提示词的全屏浮层里就完全错了——两个坑都由它引出：
 *
 * 1. 刚点开的一瞬间还没翻成 true，同步去聚焦会扑空 → 浮层弹出来就打不了字；
 *    而且**不能拿固定帧数去赌**：我试过重试 12 帧（约 200ms），图片节点过了、
 *    视频节点没过——它挂着并发轮询和模型列表请求，React 刷得更慢。
 * 2. 中途焦点离开一次（点了标题栏、切了窗口、输入法抽了一下），它就掉回只读，
 *    此后怎么敲都没反应。用户报的「输入字母或者中文都没反应」是这一条。
 *
 * 所以不是"聚焦一次"，而是**盯着**：监听 `contenteditable` 这个属性本身，
 * 掉回只读就朝容器补一次 click（稳定版自己的 onClick 就是用来开编辑态的），
 * 翻回来了就把焦点收回编辑器。一次掉线最多补 REARM_LIMIT 下，
 * 它要是压根不理我们，也不至于在这儿空转。
 */
function armEditor(container: HTMLElement) {
  stopEditorArming?.();
  const view = container.ownerDocument.defaultView;
  const findEditor = () => container.querySelector<HTMLElement>('[contenteditable="true"]');
  let rearms = 0;
  let pending: number | undefined;

  const sync = () => {
    if (open?.editorContainer !== container || !container.isConnected) {
      stop();
      return;
    }
    const editor = findEditor();
    if (!editor) {
      if (rearms >= REARM_LIMIT) return;
      rearms += 1;
      // 戳一下容器：这正是稳定版自己进编辑态的入口，我们没有碰它的 state。
      container.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      // 属性监听通常会先一步唤醒 sync，这个定时器只是兜底，防止 React 干脆没反应。
      if (pending != null) view?.clearTimeout(pending);
      pending = view?.setTimeout(sync, 120);
      return;
    }
    rearms = 0;
    const active = container.ownerDocument.activeElement;
    if (container.contains(active)) return;
    // 焦点在浮层自己的标题栏/关闭按钮上时别抢，不然键盘用户按不到关闭。
    if (
      active &&
      active !== container.ownerDocument.body &&
      (open.overlay.contains(active) || open.hostTarget.contains(active))
    )
      return;
    focusEditorPreservingSelection(container, editor);
  };

  const observer = new MutationObserver(sync);
  // 失焦之后稳定版要等 100ms 才翻回只读，属性监听会在那时候叫醒我们；
  // 这里再挂一发是为了焦点丢了但只读状态没变的情况（切窗口回来就是这样）。
  const onFocusOut = () => {
    if (pending != null) view?.clearTimeout(pending);
    pending = view?.setTimeout(sync, 150);
  };

  function stop() {
    observer.disconnect();
    container.removeEventListener('focusout', onFocusOut);
    if (pending != null) view?.clearTimeout(pending);
    if (stopEditorArming === stop) stopEditorArming = null;
  }

  stopEditorArming = stop;
  observer.observe(container, {
    attributes: true,
    attributeFilter: ['contenteditable'],
    subtree: true,
    childList: true,
  });
  container.addEventListener('focusout', onFocusOut);
  sync();
}

/**
 * 原地留一个同尺寸的占位块。
 *
 * 一是不让节点卡片在浮层打开时塌掉半截，二是关闭时靠它找回**精确的原位置**：
 * 只记 parent 会在有条件兄弟节点（错误提示之类）时插错位。
 */
function createPlaceholder(container: HTMLElement): HTMLElement {
  const placeholder = container.ownerDocument.createElement('div');
  placeholder.setAttribute(PLACEHOLDER_ATTRIBUTE, 'true');
  // 用 offsetHeight 而不是 getBoundingClientRect：画布整体挂着 transform: scale()，
  // getBoundingClientRect 给的是缩放后的屏幕像素，缩到 50% 时占位块只有一半高，
  // 节点会当场塌一截。offsetHeight 是布局像素，不受祖先 transform 影响。
  const height = container.offsetHeight;
  Object.assign(placeholder.style, {
    height: height ? `${height}px` : '',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '1 1 auto',
    minHeight: '0',
    borderRadius: '8px',
    border: '1px dashed var(--af-info)',
    color: 'var(--af-info)',
    fontSize: '12px',
  });
  placeholder.textContent = '提示词已在放大窗口中编辑';
  return placeholder;
}

function buildOverlay(document_: Document, onClose: () => void) {
  const overlay = document_.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '放大编辑提示词');

  const panel = document_.createElement('div');
  panel.setAttribute('data-fisherai-prompt-expand-panel', 'true');
  Object.assign(panel.style, {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--af-input)',
    border: '1px solid var(--af-border)',
    borderRadius: '14px',
    boxShadow: '0 40px 120px rgba(0, 0, 0, 0.62)',
    overflow: 'hidden',
  });

  const header = document_.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px 12px 18px',
    borderBottom: '1px solid var(--af-border)',
    color: 'var(--af-text)',
    fontSize: '13px',
    fontWeight: '600',
  });
  const title = document_.createElement('span');
  title.textContent = '提示词';
  const hint = document_.createElement('span');
  hint.textContent = '按 Esc 关闭 · 内容与画布同步';
  Object.assign(hint.style, {
    marginLeft: 'auto',
    fontSize: '11px',
    fontWeight: '400',
    color: 'var(--af-text-muted)',
  });
  const close = document_.createElement('button');
  close.type = 'button';
  close.setAttribute('data-fisherai-prompt-expand-close', 'true');
  close.setAttribute('aria-label', '关闭放大编辑');
  close.textContent = '✕';
  Object.assign(close.style, {
    width: '28px',
    height: '28px',
    border: '1px solid var(--af-border)',
    borderRadius: '8px',
    background: 'var(--af-input)',
    color: 'var(--af-text-secondary)',
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: '1',
  });
  close.addEventListener('click', onClose);
  header.append(title, hint, close);

  const host = document_.createElement('div');
  host.className = HOST_CLASS;
  Object.assign(host.style, {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: '0',
    padding: '16px 18px 18px',
  });

  panel.append(header, host);
  overlay.append(panel);
  // 点空白处关闭，但只认打在遮罩本体上的那一下，
  // 不然在编辑器里划选文字、鼠标抬在遮罩上就会误关，选中的字还没来得及用。
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) onClose();
  });
  return { overlay, host };
}

/**
 * 全屏里需要看得到附件栏和模型参数，但不能把整个 React Composer 搬走：
 * 它一旦在画布外发生编辑态重渲染，React 会按原父子关系回收建议菜单。
 * 因此 Tiptap 继续留在原父节点，只通过 Popover API 进入浏览器 Top Layer；
 * 其余视觉结构克隆为 inert（不可交互）镜像。
 */
function buildComposerShell(
  composer: HTMLElement,
  editorContainer: HTMLElement,
  trigger: HTMLElement,
): { shell: HTMLElement; editorSlot: HTMLElement } {
  const document_ = composer.ownerDocument;
  const shell = document_.createElement('div');
  shell.setAttribute(COMPOSER_SHELL_ATTRIBUTE, 'true');
  let editorSlot: HTMLElement | null = null;

  const clonePart = (node: Node): Node => {
    if (node === editorContainer) {
      editorSlot = document_.createElement('div');
      editorSlot.setAttribute(COMPOSER_EDITOR_SLOT_ATTRIBUTE, 'true');
      return editorSlot;
    }
    const containsEditor =
      node.nodeType === document_.ELEMENT_NODE && (node as Element).contains(editorContainer);
    if (containsEditor) {
      const branch = node.cloneNode(false);
      for (const child of Array.from(node.childNodes)) branch.appendChild(clonePart(child));
      return branch;
    }
    const clone = node.cloneNode(true);
    if (clone.nodeType === document_.ELEMENT_NODE) {
      const element = clone as HTMLElement;
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    }
    return clone;
  };

  for (const child of Array.from(composer.childNodes)) {
    if (child === trigger) continue;
    shell.appendChild(clonePart(child));
  }
  if (!editorSlot) {
    editorSlot = document_.createElement('div');
    editorSlot.setAttribute(COMPOSER_EDITOR_SLOT_ATTRIBUTE, 'true');
    shell.append(editorSlot);
  }
  return { shell, editorSlot };
}

function showEditorPopover(
  editorContainer: HTMLElement,
  editorSlot: HTMLElement,
): (() => void) | null {
  const popover = editorContainer as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  if (typeof popover.showPopover !== 'function' || typeof popover.hidePopover !== 'function') {
    return null;
  }

  const previousStyle = editorContainer.getAttribute('style');
  const previousPopover = editorContainer.getAttribute('popover');
  const view = editorContainer.ownerDocument.defaultView;
  let frame: number | null = null;

  const position = () => {
    const rect = editorSlot.getBoundingClientRect();
    editorContainer.style.setProperty('--fisherai-prompt-popover-top', `${rect.top}px`);
    editorContainer.style.setProperty('--fisherai-prompt-popover-left', `${rect.left}px`);
    editorContainer.style.setProperty('--fisherai-prompt-popover-width', `${rect.width}px`);
    editorContainer.style.setProperty('--fisherai-prompt-popover-height', `${rect.height}px`);
  };
  const schedulePosition = () => {
    if (!view) return;
    if (frame != null) view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(position);
  };

  editorContainer.setAttribute('popover', 'manual');
  editorContainer.setAttribute(EDITOR_POPOVER_ATTRIBUTE, 'true');
  try {
    popover.showPopover();
  } catch {
    editorContainer.removeAttribute(EDITOR_POPOVER_ATTRIBUTE);
    if (previousPopover == null) editorContainer.removeAttribute('popover');
    else editorContainer.setAttribute('popover', previousPopover);
    return null;
  }
  position();
  schedulePosition();

  const ResizeObserver_ = view?.ResizeObserver;
  const resizeObserver = ResizeObserver_ ? new ResizeObserver_(schedulePosition) : null;
  resizeObserver?.observe(editorSlot);
  view?.addEventListener('resize', schedulePosition);

  return () => {
    resizeObserver?.disconnect();
    view?.removeEventListener('resize', schedulePosition);
    if (frame != null) view?.cancelAnimationFrame(frame);
    try {
      popover.hidePopover?.();
    } catch {
      // 已由浏览器关闭时直接恢复属性即可。
    }
    editorContainer.removeAttribute(EDITOR_POPOVER_ATTRIBUTE);
    if (previousPopover == null) editorContainer.removeAttribute('popover');
    else editorContainer.setAttribute('popover', previousPopover);
    if (previousStyle == null) editorContainer.removeAttribute('style');
    else editorContainer.setAttribute('style', previousStyle);
  };
}

/**
 * `@` 建议框由稳定版 Tippy 直接 append 到 document.body。全屏编辑器已经通过
 * Popover API 进入 Top Layer 后，普通 body 子树无论 z-index 多大都会被压在下面，
 * 表现就是“输入 @ 没反应”。建议框出现得比编辑器晚，把它也提升为 manual popover，
 * 浏览器会按打开顺序把它放在编辑器上面；Tippy 原有的定位和键盘交互继续负责。
 */
function keepMentionMenusAboveEditor(editorContainer: HTMLElement): () => void {
  const document_ = editorContainer.ownerDocument;
  const promoted = new Map<HTMLElement, string | null>();

  const promote = () => {
    if (open?.editorContainer !== editorContainer) return;
    for (const menu of document_.querySelectorAll<HTMLElement>('[data-fisherai-mention-menu]')) {
      const root = menu.closest<HTMLElement>('[data-tippy-root]');
      if (!root || promoted.has(root)) continue;
      const popover = root as HTMLElement & {
        showPopover?: () => void;
        hidePopover?: () => void;
      };
      if (typeof popover.showPopover !== 'function') continue;

      const previousPopover = root.getAttribute('popover');
      root.setAttribute('popover', 'manual');
      root.setAttribute(SUGGESTION_POPOVER_ATTRIBUTE, 'true');
      try {
        popover.showPopover();
        promoted.set(root, previousPopover);
      } catch {
        root.removeAttribute(SUGGESTION_POPOVER_ATTRIBUTE);
        if (previousPopover == null) root.removeAttribute('popover');
        else root.setAttribute('popover', previousPopover);
      }
    }
  };

  const observer = new MutationObserver(promote);
  observer.observe(document_.body, { childList: true, subtree: true });
  promote();

  return () => {
    observer.disconnect();
    for (const [root, previousPopover] of promoted) {
      const popover = root as HTMLElement & { hidePopover?: () => void };
      try {
        popover.hidePopover?.();
      } catch {
        // Tippy 可能已经在选中引用后销毁了根节点，属性恢复仍然要做。
      }
      root.removeAttribute(SUGGESTION_POPOVER_ATTRIBUTE);
      if (previousPopover == null) root.removeAttribute('popover');
      else root.setAttribute('popover', previousPopover);
    }
    promoted.clear();
  };
}

export function closePromptExpand() {
  if (!open) return;
  const {
    container,
    editorContainer,
    hostTarget,
    parent,
    nextSibling,
    placeholder,
    overlay,
    trigger,
    cleanupPopover,
  } = open;
  open = null;
  stopEditorArming?.();
  const viewport = editorContainer.querySelector<HTMLElement>('[data-fisherai-prompt-scroll]');
  if (viewport) expandedScroll.set(editorContainer, viewport.scrollTop);
  cleanupPopover?.();

  hostTarget.removeAttribute(HOSTED_ATTRIBUTE);
  editorContainer.removeAttribute(HOSTED_ATTRIBUTE);
  if (placeholder?.parentNode) {
    placeholder.parentNode.insertBefore(container, placeholder);
    placeholder.remove();
  } else if (placeholder && parent.isConnected) {
    // 占位块被 React 的重渲染顺手清掉了。退而求其次按原来的下一个兄弟还原，
    // 它也不在了就补到末尾——位置可能不完美，但绝不能把编辑器连同浮层一起丢掉。
    if (nextSibling && nextSibling.parentNode === parent)
      parent.insertBefore(container, nextSibling);
    else parent.append(container);
  }
  overlay.remove();
  if (hostTarget.matches(COMPOSER_SELECTOR)) {
    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]');
    if (editor) focusEditorPreservingSelection(container, editor);
  } else if (trigger.isConnected) {
    trigger.focus();
  }
}

function openPromptExpand(hostTarget: HTMLElement, trigger: HTMLElement) {
  if (open) closePromptExpand();
  const document_ = hostTarget.ownerDocument;
  const editorContainer = hostTarget.matches(PROMPT_CONTAINER_SELECTOR)
    ? hostTarget
    : hostTarget.querySelector<HTMLElement>(PROMPT_CONTAINER_SELECTOR);
  if (!editorContainer) return;
  const container = editorContainer;
  const parent = container.parentElement;
  if (!parent) return;

  const placeholder = createPlaceholder(container);
  const { overlay, host } = buildOverlay(document_, closePromptExpand);
  // 挂载点必须在搬动之前算：搬走之后 container 的祖先链就换成浮层了。
  const overlayHost = chooseOverlayHost(hostTarget);
  const originalNextSibling = container.nextSibling;
  // Composer 仍留在画布里时，搬出去的内层提示词框会暂时失去 closest(COMPOSER_SELECTOR)。
  // 先标记为 hosted，避免全局 observer 把它误判成独立输入框再挂第二个放大按钮。
  hostTarget.setAttribute(HOSTED_ATTRIBUTE, 'true');
  editorContainer.setAttribute(HOSTED_ATTRIBUTE, 'true');

  const isComposer = hostTarget.matches(COMPOSER_SELECTOR);
  const liveComposer = isComposer && typeof hostTarget.showPopover === 'function';
  const scroll = editorContainer.querySelector<HTMLElement>('[data-fisherai-prompt-scroll]');
  const savedScroll = expandedScroll.get(editorContainer) ?? scroll?.scrollTop ?? 0;
  let editorSlot: HTMLElement | null = null;
  if (liveComposer) {
    editorSlot = document_.createElement('div');
    editorSlot.style.cssText = 'width:100%;height:100%;min-height:0';
    host.append(editorSlot);
  } else if (isComposer) {
    const composerShell = buildComposerShell(hostTarget, editorContainer, trigger);
    editorSlot = composerShell.editorSlot;
    host.append(composerShell.shell);
  } else {
    parent.insertBefore(placeholder, container);
    host.append(container);
  }
  overlayHost.append(overlay);

  open = {
    container,
    editorContainer,
    hostTarget,
    parent,
    nextSibling: originalNextSibling,
    placeholder: isComposer ? null : placeholder,
    overlay,
    trigger,
    cleanupPopover: null,
  };

  if (isComposer && editorSlot) {
    const cleanupPopover = showEditorPopover(
      liveComposer ? hostTarget : editorContainer,
      editorSlot,
    );
    if (cleanupPopover) {
      const cleanupMentionMenus = keepMentionMenusAboveEditor(editorContainer);
      open.cleanupPopover = () => {
        cleanupMentionMenus();
        const currentScroll = scroll?.scrollTop ?? 0;
        cleanupPopover();
        if (scroll) scroll.scrollTop = currentScroll;
      };
    } else {
      // 旧 Chromium 没有 Popover API 时保留原来的安全降级：只搬编辑器本体。
      parent.insertBefore(placeholder, originalNextSibling);
      editorSlot.replaceWith(container);
      open.placeholder = placeholder;
    }
  }

  armEditor(editorContainer);
  if (scroll) {
    scroll.scrollTop = savedScroll;
    document_.defaultView?.requestAnimationFrame(() => {
      document_.defaultView?.requestAnimationFrame(() => {
        if (open?.editorContainer === editorContainer) scroll.scrollTop = savedScroll;
      });
    });
  }
}

function createTrigger(document_: Document): HTMLElement {
  const button = document_.createElement('button');
  button.type = 'button';
  button.setAttribute(BUTTON_ATTRIBUTE, 'true');
  button.setAttribute('aria-label', '放大编辑提示词');
  button.title = '放大编辑（看全部内容）';
  button.innerHTML = EXPAND_ICON;
  Object.assign(button.style, {
    position: 'absolute',
    top: '4px',
    right: '4px',
    zIndex: '6',
    width: '22px',
    height: '22px',
    display: 'grid',
    placeItems: 'center',
    padding: '0',
    border: '1px solid var(--af-border)',
    borderRadius: '6px',
    background: 'var(--af-surface-raised)',
    color: 'var(--af-text-secondary)',
    cursor: 'pointer',
  });
  return button;
}

function attachTrigger(container: HTMLElement) {
  container.setAttribute(TRIGGER_HOST_ATTRIBUTE, 'true');
  const document_ = container.ownerDocument;
  const view = document_.defaultView;
  if (view && view.getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const button = createTrigger(document_);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    // 不拦冒泡：稳定版原生框要靠这一下点击把自己切到编辑态
    // （`disableDirectEdit` 为真时 ProseMirror 是只读的），拦了浮层里就打不了字。
    openPromptExpand(container, button);
  });
  container.append(button);

  // 提示词框自己就是滚动容器，绝对定位的按钮会跟着内容一起滚上去。
  // 用 scrollTop 把它钉回可视区顶部。
  const pin = () => {
    button.style.top = `${container.scrollTop + 4}px`;
  };
  container.addEventListener('scroll', pin);
}

export function installPromptExpand(root: ParentNode = document): () => void {
  const document_ = (root instanceof Document ? root : root.ownerDocument) ?? document;
  installStyle(document_);

  const enhance = () => {
    // React 把节点卡片整块换掉时，占位块会跟着消失；这时浮层里那个容器已经没有家了，
    // 留着只会让用户对着一个再也回不去的框打字。直接收摊。
    if (open && !open.parent.isConnected && !open.placeholder?.isConnected) closePromptExpand();
    for (const container of root.querySelectorAll<HTMLElement>(PROMPT_EXPAND_TARGET_SELECTOR)) {
      if (container.hasAttribute(TRIGGER_HOST_ATTRIBUTE)) continue;
      if (container.hasAttribute(HOSTED_ATTRIBUTE)) continue;
      // 标准生成节点把整个 Composer 搬进浮层；它内部的提示词框不再单独挂第二个按钮。
      if (container.matches(PROMPT_CONTAINER_SELECTOR) && container.closest(COMPOSER_SELECTOR)) {
        continue;
      }
      // 两个选择器可能套在一起（MiniMax 那个框内层曾经也挂着 prompt-editor-container），
      // 套住时只认最外层：一个输入框配两个放大按钮是明摆着的错，
      // 而搬内层等于把外层的内边距和定位留在原地，浮层里会缺一圈。
      if (container.parentElement?.closest(PROMPT_CONTAINER_SELECTOR)) continue;
      attachTrigger(container);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open && !open.overlay.closest('[inert]')) {
      event.preventDefault();
      event.stopPropagation();
      closePromptExpand();
    }
  };

  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(document_.body, { childList: true, subtree: true });
  document_.addEventListener('keydown', onKeyDown, true);
  return () => {
    observer.disconnect();
    document_.removeEventListener('keydown', onKeyDown, true);
    closePromptExpand();
  };
}
