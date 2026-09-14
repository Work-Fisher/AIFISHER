import {
  applyStableMediaMode,
  isStableMediaManagedSource,
  scanStableMediaTargets,
  type StableMediaTarget,
} from './stableMediaDomAdapter';

export interface StableMediaRenderer {
  /** 原生 DOM 媒体会自动跟随父级 transform；共享画布渲染器才需要视口事件重同步。 */
  requiresViewportSync?: boolean;
  mount(host: HTMLElement): void | Promise<void>;
  /**
   * 返回真正画上去的图片。没画上的必须留在原生预览——
   * 把 `<img>` 置成透明却没有 Pixi 替身，等于让图直接从画布上消失。
   */
  sync(
    targets: StableMediaTarget[],
  ): void | HTMLImageElement[] | Promise<void | HTMLImageElement[]>;
  /** 纹理尚在异步加载时，允许已绘制精灵独立跟随画布位置。 */
  syncGeometry?(targets: StableMediaTarget[]): void;
  destroy(): void;
}

interface StableMediaEnhancementOptions {
  renderer: StableMediaRenderer;
  document?: Document;
  window?: Window & typeof globalThis;
}

export interface StableMediaEnhancement {
  destroy(): void;
}

export function startStableMediaEnhancement({
  renderer,
  document: targetDocument = document,
  window: targetWindow = window,
}: StableMediaEnhancementOptions): StableMediaEnhancement {
  let destroyed = false;
  let frame = 0;
  let mountedHost: HTMLElement | null = null;
  let syncActive = false;
  let syncPending = false;
  const previewNodes = new WeakSet<HTMLElement>();
  let gesture: { node: HTMLElement; id: number; x: number; y: number; moved: boolean } | null = null;
  const wantsOriginal = (target: StableMediaTarget) =>
    target.selected && !previewNodes.has(target.node);


  const syncOnce = async () => {
    if (destroyed) return;
    const host = targetDocument.querySelector<HTMLElement>('#canvas-background');
    if (!host) {
      await renderer.sync([]);
      return;
    }
    if (host !== mountedHost) {
      mountedHost = host;
      void renderer.mount(host);
    }

    const targets = scanStableMediaTargets(targetDocument);
    const pixiTargets = targets.filter((target) => !wantsOriginal(target));
    for (const target of targets) {
      if (wantsOriginal(target)) {
        applyStableMediaMode(target, 'native-original');
      } else if (target.image.dataset.fisheraiPreviewMode !== 'pixi') {
        // 首次交给 Pixi 之前保留原生预览；已经成功绘制的图片在坐标同步期间
        // 继续由 Pixi 显示，不能每帧先恢复 DOM 再隐藏。
        applyStableMediaMode(target, 'native-preview');
      }
    }
    let drawn: Set<HTMLImageElement>;
    try {
      drawn = new Set((await renderer.sync(pixiTargets)) ?? []);
    } catch (reason) {
      console.error('[AIFISHER Stable Media] Pixi preview failed; using native previews.', reason);
      return;
    }
    if (destroyed) return;
    for (const target of scanStableMediaTargets(targetDocument)) {
      if (wantsOriginal(target)) {
        applyStableMediaMode(target, 'native-original');
        continue;
      }
      const mode = drawn.has(target.image) ? 'pixi' : 'native-preview';
      applyStableMediaMode(target, mode);
    }
    if (targetDocument.documentElement.dataset.fisheraiStableEnhancements !== 'ready') {
      targetDocument.documentElement.dataset.fisheraiStableEnhancements = 'ready';
    }
  };

  const sync = async () => {
    if (syncActive) {
      syncPending = true;
      renderer.syncGeometry?.(
        scanStableMediaTargets(targetDocument).filter((target) => !wantsOriginal(target)),
      );
      return;
    }
    syncActive = true;
    try {
      do {
        syncPending = false;
        await syncOnce();
      } while (!destroyed && syncPending);
    } finally {
      syncActive = false;
    }
  };

  const schedule = () => {
    if (destroyed || frame) return;
    frame = targetWindow.requestAnimationFrame(() => {
      frame = 0;
      void sync();
    });
  };

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof targetWindow.Element)) return;
    if (event.target.closest('button, input, textarea, select, [contenteditable="true"], [role="button"]')) return;
    const node = event.target.closest<HTMLElement>('[data-canvas-nodes-layer] [data-node-id]');
    if (!node) return;
    gesture = { node, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    // Selection happens on pointerdown; wait until release before promoting an image.
    previewNodes.add(node);
    schedule();
  };
  const pointerMove = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId || gesture.moved) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return;
    gesture.moved = true;
    for (const node of targetDocument.querySelectorAll<HTMLElement>('[data-node-selected="true"]')) {
      previewNodes.add(node);
    }
    schedule();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (event.type === 'pointerup' && !gesture.moved &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) {
      previewNodes.delete(gesture.node);
    }
    gesture = null;
    schedule();
  };
  targetDocument.addEventListener('pointerdown', pointerDown, true);
  targetDocument.addEventListener('pointermove', pointerMove, true);
  targetDocument.addEventListener('pointerup', pointerEnd, true);
  targetDocument.addEventListener('pointercancel', pointerEnd, true);

  const observer = new targetWindow.MutationObserver((records) => {
    const shouldSync = records.some((record) => {
      if (record.type !== 'attributes' || record.attributeName !== 'src') return true;
      return (
        record.target instanceof targetWindow.HTMLImageElement &&
        !isStableMediaManagedSource(record.target)
      );
    });
    if (shouldSync) schedule();
  });
  observer.observe(targetDocument.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-node-selected', 'src'],
  });

  targetWindow.addEventListener('resize', schedule);
  if (renderer.requiresViewportSync !== false) {
    targetWindow.addEventListener('wheel', schedule, { passive: true });
    targetWindow.addEventListener('pointermove', schedule, { passive: true });
    targetWindow.addEventListener('pointerup', schedule, { passive: true });
  }
  targetDocument.addEventListener('load', schedule, true);
  schedule();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      targetDocument.removeEventListener('pointerdown', pointerDown, true);
      targetDocument.removeEventListener('pointermove', pointerMove, true);
      targetDocument.removeEventListener('pointerup', pointerEnd, true);
      targetDocument.removeEventListener('pointercancel', pointerEnd, true);
      gesture = null;
      if (frame) targetWindow.cancelAnimationFrame(frame);
      targetWindow.removeEventListener('resize', schedule);
      if (renderer.requiresViewportSync !== false) {
        targetWindow.removeEventListener('wheel', schedule);
        targetWindow.removeEventListener('pointermove', schedule);
        targetWindow.removeEventListener('pointerup', schedule);
      }
      targetDocument.removeEventListener('load', schedule, true);
      for (const target of scanStableMediaTargets(targetDocument)) {
        applyStableMediaMode(target, 'native-original');
      }
      delete targetDocument.documentElement.dataset.fisheraiStableEnhancements;
      renderer.destroy();
    },
  };
}
