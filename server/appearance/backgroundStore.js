import crypto from 'node:crypto';
import path from 'node:path';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { BackgroundError, MAX_BACKGROUND_BYTES, MAX_BACKGROUND_EDGE, normalizeBackgroundImage } from './backgroundImage.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNED_FILE = /^(?:[0-9a-f-]{36}\.webp|active\.[0-9a-f-]{36}\.tmp)$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const imageInfo = record => ({
  id: record.id, width: record.width, height: record.height, bytes: record.bytes,
  url: `/api/appearance/background/${record.id}`,
});
const validRecord = record => record?.schemaVersion === 1 && ID.test(record.id)
  && Number.isInteger(record.width) && record.width > 0 && record.width <= MAX_BACKGROUND_EDGE
  && Number.isInteger(record.height) && record.height > 0 && record.height <= MAX_BACKGROUND_EDGE
  && Number.isInteger(record.bytes) && record.bytes > 0 && record.bytes <= MAX_BACKGROUND_BYTES
  && /^[a-f0-9]{64}$/.test(record.sha256);

// The private root is supplied only by the backend's fixed, authenticated account scope.
// No API parameter can select a directory, source file, account or arbitrary image URL.
export function createBackgroundStore(privateDirectory, { normalizeImage = normalizeBackgroundImage } = {}) {
  const root = path.resolve(privateDirectory);
  const directory = path.join(root, 'appearance');
  const pointer = path.join(directory, 'active.json');
  let queue = Promise.resolve();
  let pending = 0;
  const serialized = action => {
    if (pending >= 3) return Promise.reject(new BackgroundError('背景正在处理中，请稍后重试。', 429, 'BACKGROUND_BUSY'));
    pending += 1;
    const next = queue.catch(() => {}).then(action).finally(() => { pending -= 1; });
    queue = next;
    return next;
  };

  async function checkedDirectory(create = false) {
    if (create) await mkdir(root, { recursive: true });
    for (const target of [root, directory]) {
      if (create && target === directory) await mkdir(target, { recursive: true });
      const stat = await lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BackgroundError('背景保存目录不可用。', 409, 'BACKGROUND_STORAGE_UNAVAILABLE');
    }
  }

  async function regularFile(file, maxBytes) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Invalid background file');
    return readFile(file);
  }

  async function current() {
    try {
      await checkedDirectory();
      const record = JSON.parse((await regularFile(pointer, 2048)).toString('utf8'));
      if (!validRecord(record)) return null;
      const bytes = await regularFile(path.join(directory, `${record.id}.webp`), MAX_BACKGROUND_BYTES);
      if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) return null;
      return { record, bytes };
    } catch {
      // A missing, unreadable or damaged convenience background must never block the canvas.
      return null;
    }
  }

  async function removeOwned(file) {
    try {
      const stat = await lstat(file);
      if (stat.isFile() && !stat.isSymbolicLink()) await unlink(file);
    } catch { /* A stale private derivative can be retried on the next successful mutation. */ }
  }
  async function cleanup(activeId = '') {
    for (const name of await readdir(directory)) {
      if (OWNED_FILE.test(name) && name !== `${activeId}.webp`) await removeOwned(path.join(directory, name));
    }
  }

  return {
    read: () => serialized(async () => {
      const selected = await current();
      return { image: selected ? imageInfo(selected.record) : null };
    }),
    image: id => serialized(async () => {
      if (!ID.test(id)) throw new BackgroundError('背景图片不存在。', 404, 'BACKGROUND_NOT_FOUND');
      const selected = await current();
      if (!selected || selected.record.id !== id) throw new BackgroundError('背景图片不存在。', 404, 'BACKGROUND_NOT_FOUND');
      return selected.bytes;
    }),
    replace: (bytes, mime) => serialized(async () => {
      const prepared = await normalizeImage(bytes, mime);
      await checkedDirectory(true);
      const id = crypto.randomUUID();
      const file = path.join(directory, `${id}.webp`);
      const temporaryPointer = path.join(directory, `active.${id}.tmp`);
      let committed = false;
      try {
        const record = { schemaVersion: 1, id, width: prepared.width, height: prepared.height, bytes: prepared.bytes.length, sha256: digest(prepared.bytes) };
        await writeFile(file, prepared.bytes, { flag: 'wx', mode: 0o600 });
        await writeFile(temporaryPointer, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
        // Existing image remains active until this single atomic pointer replacement succeeds.
        await rename(temporaryPointer, pointer);
        committed = true;
        await cleanup(id).catch(() => {});
        return { image: imageInfo(record) };
      } finally {
        await removeOwned(temporaryPointer);
        if (!committed) await removeOwned(file);
      }
    }),
    remove: () => serialized(async () => {
      await checkedDirectory(true);
      try {
        const stat = await lstat(pointer);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new BackgroundError('背景设置文件不可用。', 409, 'BACKGROUND_STORAGE_UNAVAILABLE');
        await unlink(pointer);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await cleanup().catch(() => {});
      return { image: null };
    }),
  };
}
