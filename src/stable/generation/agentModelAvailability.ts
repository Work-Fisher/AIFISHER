import type { SourceSettingsClient } from './sourceSettingsClient';
import { openSettings } from '../navigation/openSettings';

type AgentModelCandidate = { id: string };

export type AgentModelAvailabilityBridge = {
  filter<T extends AgentModelCandidate>(models: readonly T[]): T[];
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
  emptyLabel(): string;
  openConnection(): void;
};

declare global {
  interface Window {
    __FISHERAI_AGENT_MODEL_AVAILABILITY__?: AgentModelAvailabilityBridge;
  }
}

export function installAgentModelAvailability(
  client: SourceSettingsClient,
  target: Window = window,
): AgentModelAvailabilityBridge {
  if (target.__FISHERAI_AGENT_MODEL_AVAILABILITY__) {
    return target.__FISHERAI_AGENT_MODEL_AVAILABILITY__;
  }
  let availableNames = new Set<string>();
  let pending: Promise<void> | null = null;
  let refreshVersion = 0;
  let state: 'loading' | 'ready' | 'error' = 'loading';
  const listeners = new Set<() => void>();
  const bridge: AgentModelAvailabilityBridge = {
    emptyLabel: () => state === 'loading' ? '正在读取模型…' : state === 'error' ? '读取失败，点击重试' : '连接模型服务',
    openConnection() {
      if (state === 'error') void bridge.refresh().catch(() => {});
      else if (state !== 'loading') openSettings('models');
    },
    filter(models) {
      return models.filter((model) => availableNames.has(model.id));
    },
    async refresh() {
      refreshVersion += 1;
      if (pending) return pending;
      state = 'loading';
      pending = (async () => {
        for (;;) {
          const version = refreshVersion;
          try {
            const blocks = await client.getBlocks();
            if (version !== refreshVersion) continue;
            availableNames = new Set(blocks.flatMap((block) => block.media
              .filter((media) => media.kind === 'text')
              .flatMap((media) => media.models
                .filter((model) => model.configured)
                .map((model) => model.name))));
            state = 'ready';
            return;
          } catch (error) {
            if (version !== refreshVersion) continue;
            availableNames.clear(); state = 'error'; throw error;
          }
        }
      })().finally(() => { pending = null; listeners.forEach((listener) => listener()); });
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  target.__FISHERAI_AGENT_MODEL_AVAILABILITY__ = bridge;
  // Provider settings and the account centre use separate UI surfaces. The
  // latter emits `aifisher:relay-binding-changed` after a local Relay key is
  // saved, so listen to both events or Agent would keep the pre-save model
  // snapshot until the settings page is opened again.
  const refreshOnSourceChange = () => {
    void bridge.refresh().catch(() => undefined);
  };
  target.addEventListener('fisherai:model-sources-changed', refreshOnSourceChange);
  target.addEventListener('aifisher:relay-binding-changed', refreshOnSourceChange);
  void bridge.refresh().catch(() => undefined);
  return bridge;
}
