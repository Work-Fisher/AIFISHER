import { observeStableEnhancement } from '../lifecycle/enhancementLifecycle';

export type SettingsSection = 'models' | 'local-service' | 'profile';

/** Open the existing React settings panel, then select its source-owned section. */
export function openSettings(section: SettingsSection = 'models') {
  const subscription: { stop?: () => void } = {};
  let selected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const select = () => {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-fisherai-settings="true"] button[data-fisherai-settings-section="${section}"]`,
    );
    if (!button || selected) return;
    selected = true;
    button.click();
    button.focus();
    subscription.stop?.();
    if (timer) clearTimeout(timer);
  };
  window.dispatchEvent(new CustomEvent('fisherai:open-settings'));
  subscription.stop = observeStableEnhancement(select);
  if (selected) subscription.stop();
  else timer = setTimeout(() => subscription.stop?.(), 5_000);
}
