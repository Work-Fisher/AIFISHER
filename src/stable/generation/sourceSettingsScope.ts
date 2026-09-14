export function createSettingsScope(host: HTMLElement, parent?: AbortSignal) {
  const controller = new AbortController(),
    cleanups = new Set<() => void>();
  const dispose = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    parent?.removeEventListener('abort', dispose);
  };
  parent?.addEventListener('abort', dispose, { once: true });
  if (parent?.aborted) dispose();
  return {
    signal: controller.signal,
    active: () => !controller.signal.aborted && host.isConnected,
    dispose,
    onDispose(cleanup: () => void) {
      if (controller.signal.aborted) cleanup();
      else cleanups.add(cleanup);
    },
  };
}
export type SettingsScope = ReturnType<typeof createSettingsScope>;
