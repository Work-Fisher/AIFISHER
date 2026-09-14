import type { SourceSettingsClient } from './sourceSettingsClient';
import { LEGACY_RUNNINGHUB_FIELDS } from './sourceSettingsRequests';
import type { SettingsScope } from './sourceSettingsScope';

export function createLegacyRunningHubSettings(client: SourceSettingsClient, scope: SettingsScope) {
  const wrapper = document.createElement('div'),
    toggle = document.createElement('button'),
    form = document.createElement('div');
  wrapper.className = 'space-y-3';
  toggle.type = 'button';
  toggle.textContent = '显示旧版工作流字段';
  toggle.dataset.fisheraiSourceLegacy = 'runninghub';
  toggle.className =
    'text-sm text-[var(--af-text-secondary)] hover:text-[var(--af-text)] underline underline-offset-4';
  toggle.setAttribute('aria-expanded', 'false');
  form.hidden = true;
  form.className = 'space-y-3 rounded-lg border border-[var(--af-border)] p-4';
  form.dataset.fisheraiLegacyRunninghub = 'true';
  const message = document.createElement('p'),
    fields = document.createElement('div'),
    retry = document.createElement('button'),
    save = document.createElement('button');
  message.className = 'text-sm text-[var(--af-text-secondary)]';
  message.setAttribute('role', 'status');
  fields.className = 'space-y-3';
  retry.type = 'button';
  retry.textContent = '重新读取旧版字段';
  retry.hidden = true;
  save.type = 'button';
  save.textContent = '保存旧版字段';
  save.className = 'fisherai-button is-primary';
  save.disabled = true;
  const dirty = new Map<string, string>(),
    inputs = new Map<string, HTMLInputElement>();
  let loaded = false,
    busy = false;
  for (const [key, label] of LEGACY_RUNNINGHUB_FIELDS) {
    const row = document.createElement('label'),
      caption = document.createElement('span'),
      input = document.createElement('input');
    row.className = 'block space-y-1';
    caption.textContent = label;
    caption.className = 'text-xs text-[var(--af-text-secondary)]';
    input.type = 'text';
    input.dataset.fisheraiLegacyKey = key;
    input.className =
      'w-full bg-[var(--af-input)] text-[var(--af-text)] border border-[var(--af-border-control)] rounded-md px-3 py-2 text-sm';
    input.disabled = true;
    input.addEventListener('input', () => {
      dirty.set(key, input.value);
      input.dataset.fisheraiDirty = 'true';
    });
    row.append(caption, input);
    fields.append(row);
    inputs.set(key, input);
  }
  const load = async () => {
    if (busy || !scope.active()) return;
    busy = true;
    retry.hidden = true;
    message.textContent = '正在读取旧版工作流字段…';
    try {
      const values = await client.getLegacyRunningHubSettings();
      if (!scope.active()) return;
      for (const [key, input] of inputs) {
        input.value = values[key] || '';
        input.disabled = false;
      }
      loaded = true;
      save.disabled = false;
      message.textContent = '仅用于已有旧版工作流；只保存本次修改的字段。';
    } catch (error) {
      if (scope.active()) {
        message.textContent = error instanceof Error ? error.message : '读取失败，请重试。';
        retry.hidden = false;
      }
    } finally {
      busy = false;
    }
  };
  toggle.addEventListener('click', () => {
    form.hidden = !form.hidden;
    toggle.setAttribute('aria-expanded', String(!form.hidden));
    toggle.textContent = form.hidden ? '显示旧版工作流字段' : '隐藏旧版工作流字段';
    if (!form.hidden && !loaded) void load();
  });
  retry.addEventListener('click', () => {
    void load();
  });
  save.addEventListener('click', () => {
    if (busy || !scope.active()) return;
    if (!dirty.size) {
      message.textContent = '没有修改过的字段。';
      return;
    }
    busy = true;
    save.disabled = true;
    const snapshot = new Map(dirty);
    message.textContent = '保存中…';
    void client
      .saveKeys(Object.fromEntries(snapshot))
      .then(() => {
        if (!scope.active()) return;
        for (const [key, value] of snapshot)
          if (dirty.get(key) === value) {
            dirty.delete(key);
            inputs.get(key)?.removeAttribute('data-fisherai-dirty');
          }
        message.textContent = dirty.size
          ? '已保存提交内容，仍有新修改尚未保存。'
          : '旧版工作流字段已保存。';
        window.dispatchEvent(new CustomEvent('fisherai:model-sources-changed'));
      })
      .catch((error) => {
        if (scope.active())
          message.textContent = error instanceof Error ? error.message : '保存失败，请重试。';
      })
      .finally(() => {
        busy = false;
        if (scope.active()) save.disabled = false;
      });
  });
  form.append(fields, message, retry, save);
  wrapper.append(toggle, form);
  return wrapper;
}
