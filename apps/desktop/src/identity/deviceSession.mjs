import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { writeFileAtomically } from './atomicFile.mjs';
import { isCanonicalUuid, isUrlSafeToken } from './identityValidation.mjs';
import { IdentityFailure } from './identityClient.mjs';

const MAGIC = Buffer.from('AFDEVICE1');

export function createDeviceStore({ filePath, encryptString, decryptString }) {
  return {
    async load() {
      let bytes;
      try { bytes = await readFile(filePath); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (bytes.length > 16_384 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('本机设备记录损坏');
      const record = JSON.parse(await decryptString(bytes.subarray(MAGIC.length)));
      if (record.version !== 1 || !isCanonicalUuid(record.deviceId) || !isCanonicalUuid(record.localUserId)
        || !isUrlSafeToken(record.secret, 43)
        || (record.refreshToken != null && !isUrlSafeToken(record.refreshToken, 43))
        || (record.cloudUserId != null && !isCanonicalUuid(record.cloudUserId))) throw new Error('本机设备记录无效');
      return record;
    },
    async save(record) {
      const encrypted = await encryptString(JSON.stringify(record));
      if (!(encrypted instanceof Uint8Array) || !encrypted.length) throw new Error('无法保护本机设备记录');
      await writeFileAtomically(filePath, Buffer.concat([MAGIC, encrypted]));
    },
  };
}

// Local workspace ownership never changes when a cloud session expires or is unavailable.
export async function chooseLocalWorkspace({ usersDirectory, choose, forceChoice = false }) {
  let entries;
  try { entries = await readdir(usersDirectory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return randomUUID(); throw error; }
  const ids = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && isCanonicalUuid(entry.name))
    .map(entry => entry.name).sort();
  if (!ids.length) return randomUUID();
  if (ids.length === 1 && !forceChoice) return ids[0];
  const selected = await choose(ids);
  if (selected === 'new') return randomUUID();
  if (!ids.includes(selected)) throw new Error('尚未选择本机工作区；原项目仍保留。');
  return selected;
}

export function createDeviceSession({ store, legacyTokenStore, client, resolveLocalUser = async () => randomUUID(), now = Date.now }) {
  let record;
  let ready;
  let refreshing;
  let access;
  let retryAt = 0;
  let rejected = false;
  let saving = Promise.resolve();
  function updateRecord(update) {
    const operation = saving.then(async () => {
      const next = update(record);
      await store.save(next);
      record = next;
    });
    saving = operation.catch(() => {});
    return operation;
  }
  async function initialize() {
    record = await store.load();
    if (record) return;
    const legacy = await legacyTokenStore?.load();
    const initialRecord = { version: 1, deviceId: randomUUID(), secret: randomBytes(32).toString('base64url'),
      localUserId: legacy?.userId ?? await resolveLocalUser(), refreshToken: null, cloudUserId: null };
    await store.save(initialRecord);
    record = initialRecord;
  }
  const ensureReady = () => (ready ??= initialize().catch(error => { ready = null; throw error; }));
  const view = () => ({ state: 'authenticated', authenticated: true, rememberedEmail: null,
    message: '工作区已就绪，无需登录。' });
  async function refresh() {
    await ensureReady();
    if (!client || rejected) return null;
    if (now() < retryAt) return access?.expiresAt > now() ? access.token : null;
    if (access?.expiresAt > now() + 120_000) return access.token;
    retryAt = now() + 60_000;
    try {
      let tokens;
      if (record.refreshToken) {
        try { tokens = await client.rotate(record.refreshToken); }
        catch (error) {
          // Never replay an ambiguous refresh; a later device proof can open a new session.
          await updateRecord(current => ({ ...current, refreshToken: null }));
          if (error.failure !== IdentityFailure.InvalidSession) return access?.expiresAt > now() ? access.token : null;
        }
      }
      tokens ??= await client.deviceSession(record);
      if (record.cloudUserId && tokens.userId !== record.cloudUserId) throw new Error('Device subject changed');
      await updateRecord(current => ({ ...current, cloudUserId: tokens.userId, refreshToken: tokens.refreshToken }));
      access = { token: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt };
      retryAt = 0;
      return access.token;
    } catch (error) {
      if (error.failure === IdentityFailure.InvalidSession) rejected = true;
      return null;
    }
  }
  const getAccessToken = () => {
    refreshing ??= refresh().catch(() => null).finally(() => { refreshing = null; });
    // Renewal must not stall cloud requests while the previous token is still valid.
    if (!rejected && access?.expiresAt > now()) return Promise.resolve(access.token);
    return refreshing;
  };
  const restore = async () => { await ensureReady(); void getAccessToken(); return view(); };
  return { restore, status: restore, userId: () => record?.localUserId ?? null, getAccessToken,
    async selectLocalUser(localUserId) {
      await ensureReady();
      if (!isCanonicalUuid(localUserId)) throw new Error('工作区标识无效');
      await updateRecord(current => ({ ...current, localUserId }));
    },
    onChange: () => () => {}, signOut: restore };
}
