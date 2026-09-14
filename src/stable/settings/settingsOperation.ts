import type { SettingsScope } from '../generation/sourceSettingsScope';

/** Cancel waiting and suppress continuations when the owning settings page closes. */
export async function settingsOperation<T>(
  scope: SettingsScope,
  operation: () => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  if (!scope.active()) throw new DOMException('页面已关闭', 'AbortError');
  let cancel!: () => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new DOMException('页面已关闭', 'AbortError'));
    scope.signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => reject(new Error('等待超时，请先核对当前状态。')), timeoutMs);
  });
  try {
    const value = await Promise.race([operation(), cancelled]);
    if (!scope.active()) throw new DOMException('页面已关闭', 'AbortError');
    return value;
  } finally {
    clearTimeout(timer);
    scope.signal.removeEventListener('abort', cancel);
  }
}
