/**
 * minimaxPromptScroll.ts
 *
 * 干掉 MiniMax H3 提示词框里那条"蓝线"——它其实是滚动条。
 *
 * 现象：字少时是一条横线贴在文字下面，字多时变成一条竖线贴在右边。
 * 实测（2026-08-12）：
 *   - 提示词编辑器的滚动容器 clientHeight 90 / scrollHeight 183 → 纵向真的超高，
 *     竖条是正常的滚动条；
 *   - 它外面那层 clientWidth 836 / scrollWidth 846 → **横向多出 10px**。
 *     这 10px 是布局误差而不是真内容，但 CSS 规范规定：一个轴不是 visible 时，
 *     另一个轴的 visible 会被强制算成 auto。滚动容器只写了 overflow-y-auto，
 *     于是 overflow-x 被算成 auto，10px 的溢出就把横向滚动条逼了出来。
 *
 * 所以要做两件事：把横向滚动关死（那 10px 不该滚），把竖向滚动条压细压暗
 * （稳定版原生的图片提示框就不会横亘一条高对比度的条）。
 *
 * 用注入样式表而不是改冻结产物：这些滚动容器都是 w1 编辑器自己的 DOM。
 * 作用域只包含 MiniMax、原生生成提示词、通用工作流提示词和文本节点，
 * 不污染设置页或模型菜单。
 */

const STYLE_ID = 'fisherai-minimax-prompt-scroll';
const SURFACE = '[data-fisherai-minimax-prompt-surface]';
const NATIVE_PROMPT_SURFACE = '.prompt-editor-container';
const WORKFLOW_SURFACE = '[data-fisherai-workflow-prompt-editor]';
const TEXT_SURFACE = '.text-node-content';
const SCOPED_SURFACES = `:is(${SURFACE}, ${NATIVE_PROMPT_SURFACE}, ${WORKFLOW_SURFACE}, ${TEXT_SURFACE})`;
const SURFACE_SELECTOR = `${SURFACE}, ${NATIVE_PROMPT_SURFACE}, ${WORKFLOW_SURFACE}, ${TEXT_SURFACE}`;

interface ScrollInstallation {
  style: HTMLStyleElement;
  observer: MutationObserver;
  surfaces: Set<Element>;
  cleanup: () => void;
}

const installations = new WeakMap<Document, ScrollInstallation>();

export const MINIMAX_PROMPT_SCROLL_CSS = `
${SURFACE} { overflow: visible; }
${SCOPED_SURFACES} [class*="overflow-y-auto"] {
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--af-scrollbar) transparent;
}
${SCOPED_SURFACES} [class*="overflow-y-auto"]::-webkit-scrollbar { width: 6px; height: 0; }
${SCOPED_SURFACES} [class*="overflow-y-auto"]::-webkit-scrollbar-track { background: transparent; }
${SCOPED_SURFACES} [class*="overflow-y-auto"]::-webkit-scrollbar-thumb {
  background: var(--af-scrollbar);
  border-radius: 3px;
}
`.trim();

export function installMiniMaxPromptScroll(root: Document = document): () => void {
  const installed = installations.get(root);
  if (installed && root.getElementById(STYLE_ID)) return () => {};
  installed?.cleanup();

  const style = root.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MINIMAX_PROMPT_SCROLL_CSS;
  root.head.append(style);

  const surfaces = new Set<Element>();
  const keepWheelInsideEditor = (event: Event) => event.stopPropagation();
  const connectSurface = (surface: Element) => {
    if (surfaces.has(surface)) return;
    surfaces.add(surface);
    surface.addEventListener('wheel', keepWheelInsideEditor, { passive: true });
  };
  const scan = (scope: ParentNode) => {
    if (scope instanceof Element && scope.matches(SURFACE_SELECTOR)) connectSurface(scope);
    scope.querySelectorAll(SURFACE_SELECTOR).forEach(connectSurface);
  };
  scan(root);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
    }
  });
  observer.observe(root.documentElement, { childList: true, subtree: true });

  const cleanup = () => {
    observer.disconnect();
    surfaces.forEach((surface) => surface.removeEventListener('wheel', keepWheelInsideEditor));
    surfaces.clear();
    style.remove();
    if (installations.get(root)?.cleanup === cleanup) installations.delete(root);
  };
  installations.set(root, { style, observer, surfaces, cleanup });
  return cleanup;
}
