import type { StableMediaTarget } from './stableMediaDomAdapter';
import type { StableMediaRenderer } from './stableMediaEnhancement';

/**
 * 让缩略图保留在各自节点的 DOM 堆叠上下文中。
 *
 * 单张 fixed Pixi canvas 只能整体位于所有 DOM 节点的上方或下方，无法表达
 * “未选中图片 < 选中文字 < 另一张图片”这类逐节点顺序；它也必须在每次画布
 * 变换后重新测量坐标。原生预览直接继承节点的 transform 与 z-index，因此这里
 * 明确返回空集合，让增强控制器采用 native-preview 模式而不创建共享覆盖层。
 */
export class NativeStableMediaRenderer implements StableMediaRenderer {
  readonly requiresViewportSync = false;

  mount(host: HTMLElement) {
    void host;
  }

  sync(targets: StableMediaTarget[]): HTMLImageElement[] {
    void targets;
    return [];
  }

  destroy() {}
}
