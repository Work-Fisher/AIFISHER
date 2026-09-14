import type * as React from 'react';
import { preferenceStorage } from '../persistence/preferenceStore';

// The same-device sync profile used this key; keeping it carries names and avatar colours over.
const LOCAL_USER_KEY = 'fisherai-collab-user';

export interface LocalUser {
  id: string;
  no: string;
  name: string;
}

function numberLabel(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return typeof value === 'string' ? (value.trim().match(/(\d+)$/)?.[1] ?? '') : '';
}

/** Display-only profile of the person at this canvas; authentication never reads it. */
export function readLocalUser(storage = preferenceStorage()): LocalUser {
  try {
    const stored = JSON.parse(storage.getItem(LOCAL_USER_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      return {
        id: typeof stored.id === 'string' && stored.id ? stored.id : 'local',
        no: numberLabel(stored.no) || numberLabel(stored.name) || numberLabel(stored.id) || '1',
        name: typeof stored.name === 'string' ? stored.name : '',
      };
    }
  } catch {
    // A malformed preference must not prevent entering the canvas.
  }
  return { id: 'local', no: '1', name: '' };
}

let accountDisplayName: Promise<string> | null = null;

function readAccountDisplayName(fetchImpl: typeof fetch) {
  accountDisplayName ??= fetchImpl('/api/auth/profile', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((profile: { displayName?: unknown } | null) =>
      typeof profile?.displayName === 'string' ? profile.displayName.trim().slice(0, 64) : '',
    )
    .catch(() => '');
  return accountDisplayName;
}

/** Names an unnamed profile after the account, as the retired bootstrap page did. */
export async function adoptAccountDisplayName(
  fetchImpl: typeof fetch = window.fetch.bind(window),
  storage = preferenceStorage(),
): Promise<LocalUser | null> {
  if (readLocalUser(storage).name) return null;
  const name = await readAccountDisplayName(fetchImpl);
  // The person may have typed a name while the profile was loading; theirs wins.
  const current = readLocalUser(storage);
  if (!name || current.name) return null;
  const next = { ...current, name };
  storage.setItem(LOCAL_USER_KEY, JSON.stringify(next));
  return next;
}

export function resetAccountDisplayNameForTests() {
  accountDisplayName = null;
}

export function useLocalUser(R: Pick<typeof React, 'useState' | 'useCallback' | 'useEffect'>) {
  const [user, setUser] = R.useState(() => readLocalUser());
  R.useEffect(() => {
    let active = true;
    void adoptAccountDisplayName().then((next) => {
      if (active && next) setUser((current) => (current.name ? current : next));
    });
    return () => {
      active = false;
    };
  }, []);
  const setName = R.useCallback((value: string) => {
    const next = { ...readLocalUser(), name: String(value ?? '').slice(0, 64) };
    preferenceStorage().setItem(LOCAL_USER_KEY, JSON.stringify(next));
    setUser(next);
  }, []);
  return { ...user, setName };
}
