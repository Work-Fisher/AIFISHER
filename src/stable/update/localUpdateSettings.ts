import { desktopBridge, type AifisherDesktopBridge } from '../desktop/desktopBridge';

export function mountLocalUpdateSettings(
  host: HTMLElement,
  bridge: AifisherDesktopBridge | null = desktopBridge(),
) {
  const update = bridge?.update;
  if (!update?.source || !update.selectLocalSource || !update.resetSource || !update.check)
    return () => {};
  let disposed = false;
  const buttonClass = 'border border-[var(--af-border-control)] bg-[var(--af-surface)] text-[var(--af-text)] rounded px-3 py-2 text-sm enabled:hover:bg-[var(--af-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)] disabled:opacity-50 disabled:cursor-not-allowed';
  host.innerHTML = `<div class="space-y-3 text-[var(--af-text)]">
    <h3 class="text-base font-bold text-[var(--af-text)]">更新来源</h3>
    <p data-source class="text-sm text-[var(--af-text-secondary)] break-all"></p>
    <div class="flex flex-wrap gap-3">
      <button type="button" data-select class="${buttonClass}">选择本机测试目录</button>
      <button type="button" data-reset class="${buttonClass}">恢复正式更新源</button>
      <button type="button" data-check class="${buttonClass}">检查更新</button>
    </div>
    <p class="text-sm text-[var(--af-text-secondary)]">本机测试仅影响此安装。候选校验通过后，由你点击“立即更新并重启”。</p>
    <p role="status" class="text-sm text-[var(--af-text-secondary)]"></p>
  </div>`;
  const status = host.querySelector<HTMLElement>('[role="status"]')!;
  const source = host.querySelector<HTMLElement>('[data-source]')!;
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
  const refresh = async () => {
    const value = await update.source!();
    if (!disposed) source.textContent = value.enabled ? `本机测试：${value.directory}` : '正式更新源';
  };
  const run = async (work: () => Promise<unknown>) => {
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = '正在处理…';
    try {
      const message = await work();
      await refresh();
      if (!disposed) status.textContent = typeof message === 'string' ? message : '已完成。';
    } catch (error) {
      if (!disposed) status.textContent = error instanceof Error ? error.message : '操作未完成，请重试。';
    } finally {
      if (!disposed) buttons.forEach((button) => { button.disabled = false; });
    }
  };
  buttons[0].onclick = () => void run(() => update.selectLocalSource!());
  buttons[1].onclick = () => void run(() => update.resetSource!());
  buttons[2].onclick = () => void run(async () => {
    const result = await update.check!();
    if (result.status === 'failed') throw new Error(result.message || '更新检查失败。');
    return result.message || '检查完成。';
  });
  void refresh().catch((error) => { if (!disposed) status.textContent = String(error.message); });
  return () => { disposed = true; host.replaceChildren(); };
}
