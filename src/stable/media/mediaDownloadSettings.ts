import type { MediaDownloadFileNameAdapter, MediaDownloadSettings } from './mediaDownloadFileName';
import { createStableTextElement as element } from '../design/dom';
import { createSettingsScope } from '../generation/sourceSettingsScope';
import { settingsOperation } from '../settings/settingsOperation';

const SETTINGS_ATTRIBUTE = 'data-fisherai-download-settings';

function action(label: string) {
  const button = element(
    'button',
    label,
    'px-3 py-2 rounded-lg border border-[var(--af-border-control)] text-sm text-[var(--af-text)] hover:bg-[var(--af-surface-raised)] disabled:opacity-50',
  ) as HTMLButtonElement;
  button.type = 'button';
  return button;
}

export function mountMediaDownloadSettings(
  host: HTMLElement,
  client: MediaDownloadFileNameAdapter,
) {
  const panel = element('section', '', 'space-y-6 animate-in fade-in duration-200');
  panel.setAttribute(SETTINGS_ATTRIBUTE, 'true');
  host.append(panel);
  const scope = createSettingsScope(panel);
  let inFlight = false;

  const card = element(
    'div',
    '',
    'p-8 bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg space-y-6',
  );
  const heading = element('div');
  heading.append(
    element('h3', '下载设置', 'text-xl font-bold text-[var(--af-text)] mb-2'),
    element(
      'p',
      '图片、视频和音频结果统一保存到本机目录，不修改画布素材库。',
      'text-sm text-[var(--af-text-secondary)]',
    ),
  );

  const directoryBlock = element(
    'div',
    '',
    'rounded-lg border border-[var(--af-border)] bg-[var(--af-surface)] p-4',
  );
  directoryBlock.append(
    element('p', '当前下载目录', 'text-xs font-medium text-[var(--af-text-secondary)]'),
  );
  const pathValue = element(
    'p',
    '正在读取…',
    'mt-2 break-all font-mono text-sm text-[var(--af-text)]',
  );
  pathValue.setAttribute('data-fisherai-download-directory', 'true');
  directoryBlock.append(pathValue);

  const actions = element('div', '', 'flex flex-wrap gap-2');
  const choose = action('选择文件夹');
  const open = action('打开目录');
  const reset = action('恢复默认目录');
  actions.append(choose, open, reset);

  const askLabel = element(
    'label',
    '',
    'flex items-center justify-between gap-4 rounded-lg border border-[var(--af-border)] bg-[var(--af-surface)] px-4 py-3 cursor-pointer',
  ) as HTMLLabelElement;
  const askCopy = element('span');
  askCopy.append(
    element('strong', '每次下载时询问保存位置', 'block text-sm font-medium text-[var(--af-text)]'),
    element(
      'small',
      '开启后显示 Windows 保存对话框；取消不会报错。',
      'mt-1 block text-xs text-[var(--af-text-muted)]',
    ),
  );
  const ask = document.createElement('input');
  ask.type = 'checkbox';
  ask.className = 'h-4 w-4 accent-[var(--af-primary)]';
  ask.setAttribute('data-fisherai-download-ask-each-time', 'true');
  askLabel.append(askCopy, ask);

  const message = element('p', '', 'min-h-5 text-xs text-[var(--af-text-secondary)]');
  message.setAttribute('aria-live', 'polite');
  card.append(heading, directoryBlock, actions, askLabel, message);
  panel.append(card);

  let currentSettings: MediaDownloadSettings | null = null;
  const busy = (active: boolean) => {
    inFlight = active;
    choose.disabled = active;
    open.disabled = active;
    ask.disabled = active;
    reset.disabled = active || !currentSettings?.customDirectory;
  };
  const render = (settings: MediaDownloadSettings) => {
    if (!scope.active()) return;
    currentSettings = settings;
    pathValue.textContent = settings.directory;
    pathValue.style.color = settings.directoryAvailable ? 'var(--af-text)' : 'var(--af-warning)';
    ask.checked = settings.askEachTime;
    reset.disabled = !settings.customDirectory;
    message.style.color = 'var(--af-text-secondary)';
    message.textContent = settings.directoryAvailable
      ? settings.customDirectory
        ? '使用已选择的固定目录。'
        : '使用 Windows 默认下载目录。'
      : '当前目录不可用，请重新选择。';
  };
  const run = async (operation: () => Promise<MediaDownloadSettings | { status: 'cancelled' }>) => {
    if (inFlight || !scope.active()) return;
    busy(true);
    message.textContent = '正在打开系统目录选择器…';
    try {
      const result = await settingsOperation(scope, operation, 120_000);
      if ('status' in result && result.status === 'cancelled') {
        message.textContent = '已取消选择。';
        return;
      }
      render(result as MediaDownloadSettings);
    } catch (error) {
      if (!scope.active()) return;
      message.textContent = error instanceof Error ? error.message : '下载设置操作失败。';
      message.style.color = 'var(--af-danger)';
    } finally {
      if (scope.active()) busy(false);
    }
  };

  choose.addEventListener('click', () => {
    void run(() => client.chooseDirectory());
  });
  reset.addEventListener('click', () => {
    void run(() => client.resetDirectory());
  });
  open.addEventListener('click', () => {
    if (inFlight || !scope.active()) return;
    void (async () => {
      busy(true);
      message.style.color = 'var(--af-text-secondary)';
      message.textContent = '正在打开下载目录…';
      try {
        const result = await settingsOperation(scope, () => client.openDirectory());
        message.textContent = result.foreground
          ? result.fileName
            ? `已打开并定位：${result.fileName}`
            : '已打开下载目录。'
          : '下载目录已打开，如未显示请检查任务栏。';
      } catch (error) {
        if (!scope.active()) return;
        message.textContent = error instanceof Error ? error.message : '无法打开下载目录。';
        message.style.color = 'var(--af-danger)';
      } finally {
        if (scope.active()) busy(false);
      }
    })();
  });
  ask.addEventListener('change', () => {
    if (inFlight || !scope.active()) return;
    const requested = ask.checked;
    void (async () => {
      busy(true);
      try {
        render(await settingsOperation(scope, () => client.setAskEachTime(requested)));
      } catch (error) {
        if (!scope.active()) return;
        ask.checked = !requested;
        message.textContent = error instanceof Error ? error.message : '保存下载设置失败。';
        message.style.color = 'var(--af-danger)';
      } finally {
        if (scope.active()) busy(false);
      }
    })();
  });

  const retry = action('重新读取下载设置');
  retry.hidden = true;
  card.append(retry);
  const load = async () => {
    if (inFlight || !scope.active()) return;
    busy(true);
    retry.hidden = true;
    try {
      render(await settingsOperation(scope, () => client.getSettings()));
    } catch (error) {
      if (!scope.active()) return;
      message.textContent = error instanceof Error ? error.message : '读取下载设置失败。';
      message.style.color = 'var(--af-danger)';
      retry.hidden = false;
    } finally {
      if (scope.active()) busy(false);
    }
  };
  retry.addEventListener('click', () => {
    void load();
  });
  void load();
  return () => {
    scope.dispose();
    panel.remove();
  };
}
