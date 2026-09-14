/**
 * Interface preferences live in the account's backend document (ADR-0035), not in the browser
 * storage of whichever shell hosts the canvas. The store hydrates once before the canvas starts,
 * answers reads synchronously from memory and writes changes through in small batches.
 */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type BrowserStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;

const ENDPOINT = '/api/preferences';
const KEEPALIVE_BODY_LIMIT = 60_000;
// Every browser-storage preference the canvas has shipped; imported once per account.
const BROWSER_KEYS = new Set([
  'fisherai-local-avatar',
  'fisherai.model-picker.premium',
  'fisherai.firstRunCheck.dismissed',
  'fisherai-workflow-example-bundles-v1',
  'aifisher:video-volume',
  'fisherai-collab-user',
]);
const BROWSER_KEY_PREFIXES = ['fisherai.node-dimensions.v1:', 'fisherai.confirmation.suppressed.v1.'];

class PreferenceWriteError extends Error {
  constructor(readonly status: number) {
    super(`Preference write failed with HTTP ${status}`);
  }
}

export interface PreferenceStoreOptions {
  fetchImpl: typeof fetch;
  browserStorage?: BrowserStorage | null;
  flushDelayMs?: number;
  retryDelayMs?: number;
  hydrateTimeoutMs?: number;
}

export function createPreferenceStore({
  fetchImpl,
  browserStorage = null,
  flushDelayMs = 300,
  retryDelayMs = 5_000,
  hydrateTimeoutMs = 3_000,
}: PreferenceStoreOptions) {
  const values = new Map<string, string>();
  const pendingSet = new Map<string, string>();
  const pendingRemove = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;

  function browserCopy() {
    const found: Record<string, string> = {};
    try {
      for (let index = 0; browserStorage && index < browserStorage.length; index += 1) {
        const key = browserStorage.key(index);
        if (!key || !(BROWSER_KEYS.has(key) || BROWSER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))))
          continue;
        const value = browserStorage.getItem(key);
        if (value !== null) found[key] = value;
      }
    } catch {
      // Blocked browser storage only means there is nothing to import.
    }
    return found;
  }

  async function patch(body: Record<string, unknown>, keepalive = false) {
    const text = JSON.stringify(body);
    const response = await fetchImpl(ENDPOINT, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: text,
      keepalive: keepalive && text.length < KEEPALIVE_BODY_LIMIT,
    });
    if (!response.ok) throw new PreferenceWriteError(response.status);
  }

  function schedule(delayMs: number) {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  async function flush(keepalive = false): Promise<void> {
    if (flushing) await flushing;
    if (!pendingSet.size && !pendingRemove.size) return;
    const set = Object.fromEntries(pendingSet);
    const remove = [...pendingRemove];
    pendingSet.clear();
    pendingRemove.clear();
    flushing = patch({ set, remove }, keepalive)
      .catch((error: unknown) => {
        // A rejected shape never succeeds on retry; everything else (offline, a restarting backend) can.
        const status = error instanceof PreferenceWriteError ? error.status : 0;
        if (status === 400 || status === 413) {
          console.warn('界面偏好未能保存。', error);
          return;
        }
        for (const [key, value] of Object.entries(set))
          if (!pendingSet.has(key) && !pendingRemove.has(key)) pendingSet.set(key, value);
        for (const key of remove) if (!pendingSet.has(key)) pendingRemove.add(key);
        schedule(retryDelayMs);
      })
      .finally(() => {
        flushing = null;
      });
    await flushing;
  }

  async function hydrate() {
    let document: { browserImported?: unknown; values?: Record<string, unknown> };
    try {
      const response = await fetchImpl(ENDPOINT, {
        cache: 'no-store',
        signal: AbortSignal.timeout(hydrateTimeoutMs),
      });
      if (!response.ok) return;
      document = await response.json();
    } catch {
      // Without the backend the canvas starts on defaults.
      return;
    }
    const account = Object.entries(document.values ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (document.browserImported !== true) {
      const imported = browserCopy();
      for (const [key] of account) delete imported[key];
      for (const [key, value] of Object.entries(imported)) values.set(key, value);
      // A failed import simply runs again on the next start.
      await patch({ set: imported, browserImported: true }).catch(() => {});
    }
    for (const [key, value] of account) values.set(key, value);
  }

  const storage: PreferenceStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      const text = String(value);
      if (values.get(key) === text) return;
      values.set(key, text);
      pendingRemove.delete(key);
      pendingSet.set(key, text);
      schedule(flushDelayMs);
    },
    removeItem(key) {
      values.delete(key);
      pendingSet.delete(key);
      pendingRemove.add(key);
      schedule(flushDelayMs);
    },
  };

  return { storage, hydrate, flush };
}

let installed: ReturnType<typeof createPreferenceStore> | null = null;
const detached = new Map<string, string>();
const detachedStorage: PreferenceStorage = {
  getItem: (key) => detached.get(key) ?? null,
  setItem: (key, value) => void detached.set(key, String(value)),
  removeItem: (key) => void detached.delete(key),
};

/** Hydrates account preferences before the canvas enhancements read them. */
export async function installPreferenceStore(fetchImpl: typeof fetch): Promise<PreferenceStorage> {
  if (installed) return installed.storage;
  let browserStorage: BrowserStorage | null;
  try {
    browserStorage = window.localStorage;
  } catch {
    browserStorage = null;
  }
  const store = createPreferenceStore({ fetchImpl, browserStorage });
  installed = store;
  window.addEventListener('pagehide', () => void store.flush(true));
  await store.hydrate();
  return store.storage;
}

/**
 * The installed account store. Isolated modules and unit tests that run without the canvas
 * bootstrap keep using the browser's own storage.
 */
export function preferenceStorage(): PreferenceStorage {
  if (installed) return installed.storage;
  try {
    return typeof localStorage === 'undefined' ? detachedStorage : localStorage;
  } catch {
    return detachedStorage;
  }
}

export function uninstallPreferenceStoreForTests() {
  installed = null;
}
