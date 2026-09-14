import { useEffect, useMemo, useSyncExternalStore } from 'react';

export interface AgentWorkspace {
  prompt: string;
  modelId: string;
  effort: string;
  apiSessionId: string;
  codexSessionId: string;
  nodeReferences: string[];
  excludedNodes: string[];
}
const empty = (): AgentWorkspace => ({
  prompt: '',
  modelId: '',
  effort: '',
  apiSessionId: '',
  codexSessionId: '',
  nodeReferences: [],
  excludedNodes: [],
});
export function createAgentWorkspace(project: string, fetcher: typeof fetch = globalThis.fetch) {
  let state = { value: empty(), ready: false, error: '', dirty: false };
  let revision = 0,
    active = false,
    loading = false,
    writing: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loadController: AbortController | undefined;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const url = `/api/agent/workspace?projectId=${encodeURIComponent(project)}`;
  const flush = (): Promise<boolean> => {
    clearTimeout(timer);
    if (writing) return writing;
    if (!state.ready) return Promise.resolve(false);
    writing = (async () => {
      while (state.dirty) {
        const value = state.value;
        const body = JSON.stringify({ revision, value });
        try {
          const response = await fetcher(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: new TextEncoder().encode(body).length < 60000,
            signal: AbortSignal.timeout(10000),
          });
          const receipt = await response.json();
          if (!response.ok) throw new Error(receipt.error || '助手草稿保存失败。');
          if (receipt.projectId !== project || receipt.revision !== revision + 1)
            throw new Error('助手草稿保存未得到确认。');
          revision = receipt.revision;
          emit({ dirty: value !== state.value, error: '' });
        } catch (problem) {
          emit({
            error: problem instanceof Error ? problem.message : '助手草稿尚未保存，请重试。',
          });
          return false;
        }
      }
      return true;
    })().finally(() => {
      writing = undefined;
    });
    return writing;
  };
  const load = async () => {
    if (!active || state.ready || loading) return;
    loading = true;
    const controller = new AbortController();
    loadController = controller;
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      const receipt = await response.json();
      if (!response.ok) throw new Error(receipt.error || '助手草稿读取失败。');
      if (
        receipt.projectId !== project ||
        !Number.isSafeInteger(receipt.revision) ||
        !receipt.value ||
        typeof receipt.value.prompt !== 'string'
      )
        throw new Error('助手草稿格式无效。');
      if (active && !controller.signal.aborted) {
        revision = receipt.revision;
        emit({ value: receipt.value, ready: true, error: '' });
      }
    } catch (problem) {
      if (active && !controller.signal.aborted)
        emit({ error: problem instanceof Error ? problem.message : '助手草稿读取失败。' });
    } finally {
      if (loadController === controller) {
        loading = false;
        loadController = undefined;
      }
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
      void load();
    },
    deactivate() {
      active = false;
      loadController?.abort();
      loadController = undefined;
      loading = false;
      void flush();
    },
    flush,
    retry: () => (state.ready ? flush() : load()),
    patch(value: Partial<AgentWorkspace>) {
      if (!state.ready) return;
      const next = { ...state.value, ...value };
      if (JSON.stringify(next) === JSON.stringify(state.value)) return;
      emit({ value: next, dirty: true });
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flush();
      }, 150);
    },
  };
}
export function useAgentWorkspace(project: string) {
  const controller = useMemo(() => createAgentWorkspace(project), [project]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    const save = () => {
      void controller.flush();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (controller.getSnapshot().dirty) {
        save();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', unload);
      controller.deactivate();
    };
  }, [controller]);
  return { ...state, patch: controller.patch, flush: controller.flush, retry: controller.retry };
}
