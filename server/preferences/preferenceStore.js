import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import express from 'express';

// Interface preferences the canvas used to keep in its shell's browser storage (ADR-0035).
// One document per account; values stay opaque strings owned by the canvas.
const MAX_KEY_LENGTH = 256;
const MAX_KEYS = 10_000;
const MAX_VALUE_LENGTH = 4 * 1024 * 1024;
const MAX_DOCUMENT_LENGTH = 16 * 1024 * 1024;

class PreferenceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isKey = key => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH && !/\p{Cc}/u.test(key);
const emptyDocument = () => ({ browserImported: false, values: {} });

function parseDocument(text) {
  const parsed = JSON.parse(text);
  if (parsed?.schemaVersion !== 1 || typeof parsed.browserImported !== 'boolean'
    || !parsed.values || typeof parsed.values !== 'object' || Array.isArray(parsed.values)) {
    throw new Error('Invalid preference document');
  }
  const values = Object.fromEntries(Object.entries(parsed.values).filter(([key, value]) => isKey(key) && typeof value === 'string'));
  return { browserImported: parsed.browserImported, values };
}

function validChanges(body) {
  const set = body?.set ?? {};
  const remove = body?.remove ?? [];
  if (!set || typeof set !== 'object' || Array.isArray(set) || !Array.isArray(remove)
    || (body?.browserImported !== undefined && body.browserImported !== true)) {
    throw new PreferenceError('偏好内容无效。');
  }
  for (const [key, value] of Object.entries(set)) {
    if (!isKey(key) || typeof value !== 'string') throw new PreferenceError('偏好内容无效。');
    if (value.length > MAX_VALUE_LENGTH) throw new PreferenceError('单项偏好过大。', 413);
  }
  if (!remove.every(isKey)) throw new PreferenceError('偏好内容无效。');
  return { set, remove, browserImported: body?.browserImported === true };
}

export function createPreferenceStore(privateDirectory) {
  const file = path.join(privateDirectory, 'preferences.json');
  let cached = null;
  let queue = Promise.resolve();
  const serialized = action => {
    const next = queue.catch(() => {}).then(action);
    queue = next;
    return next;
  };

  async function load() {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return emptyDocument();
      throw error;
    }
    try {
      return parseDocument(text);
    } catch {
      // Preferences are conveniences: keep the unreadable file for inspection and start clean,
      // so the canvas imports its browser copy again instead of failing every later write.
      await rename(file, path.join(privateDirectory, `preferences.corrupt-${Date.now()}.json`));
      return emptyDocument();
    }
  }
  const current = async () => (cached ??= await load());
  const copy = document => ({ browserImported: document.browserImported, values: { ...document.values } });

  return {
    read: () => serialized(async () => copy(await current())),
    async update(changes) {
      const { set, remove, browserImported } = validChanges(changes);
      return serialized(async () => {
        const previous = await current();
        const values = { ...previous.values, ...set };
        for (const key of remove) delete values[key];
        if (Object.keys(values).length > MAX_KEYS) throw new PreferenceError('偏好项目过多。', 413);
        const next = { browserImported: previous.browserImported || browserImported, values };
        const text = JSON.stringify({ schemaVersion: 1, ...next });
        if (text.length > MAX_DOCUMENT_LENGTH) throw new PreferenceError('偏好总量过大。', 413);
        await mkdir(privateDirectory, { recursive: true });
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, file);
        cached = next;
        return copy(next);
      });
    },
  };
}

export function createPreferenceRouter(store) {
  const router = express.Router();
  const handle = action => async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response.json(await action(request));
    } catch (error) {
      const known = error instanceof PreferenceError;
      response.status(known ? error.status : 500).json({ error: known ? error.message : '偏好读取或保存失败。' });
    }
  };
  router.get('/', handle(() => store.read()));
  router.patch('/', handle(async request => {
    const { browserImported } = await store.update(request.body);
    return { ok: true, browserImported };
  }));
  return router;
}
