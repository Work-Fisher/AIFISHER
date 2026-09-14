import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { writeFileAtomically } from './atomicFile.mjs';
import { isCanonicalUuid, isUrlSafeToken } from './identityValidation.mjs';

// AFDSKT01 + safeStorage(JSON record). The Tauri file is AFRTDP01 + CryptProtectData(current
// user, no entropy) of the bare refresh token; it is read until the first successful save.
const STORE_MAGIC = Buffer.from('AFDSKT01', 'ascii');
const LEGACY_MAGIC = Buffer.from('AFRTDP01', 'ascii');
export const MAXIMUM_TOKEN_FILE_BYTES = 16 * 1024;
const REFRESH_TOKEN_LENGTH = 43;
const SCHEMA_VERSION = 1;
const RECORD_FIELDS = ['schemaVersion', 'refreshToken', 'userId'];
const POWERSHELL_TIMEOUT_MS = 15_000;
const MAXIMUM_POWERSHELL_OUTPUT_BYTES = 32 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

async function readRecordFile(filePath, magic) {
  let contents;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Identity session file could not be read', { cause: error });
  }
  if (
    contents.length <= magic.length
    || contents.length > MAXIMUM_TOKEN_FILE_BYTES
    || !contents.subarray(0, magic.length).equals(magic)
  ) {
    throw new Error('Identity session file is invalid');
  }
  return contents.subarray(magic.length);
}

function isStoredRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === RECORD_FIELDS.length
    && RECORD_FIELDS.every((field) => Object.hasOwn(value, field))
    && value.schemaVersion === SCHEMA_VERSION
    && isUrlSafeToken(value.refreshToken, REFRESH_TOKEN_LENGTH)
    && isCanonicalUuid(value.userId);
}

export function createTokenStore({
  filePath,
  legacyTauriPath = null,
  encryptString,
  decryptString,
  unprotectLegacy = null,
} = {}) {
  if (!filePath) throw new Error('Identity session file path is required');
  if (typeof encryptString !== 'function' || typeof decryptString !== 'function') {
    throw new Error('Identity session encryption is not configured');
  }
  let queue = Promise.resolve();
  const serialized = (action) => {
    const next = queue.catch(() => {}).then(action);
    queue = next;
    return next;
  };

  async function readCurrent(ciphertext) {
    let plaintext;
    try {
      plaintext = await decryptString(Buffer.from(ciphertext));
      if (typeof plaintext !== 'string') plaintext = utf8.decode(plaintext);
    } catch {
      throw new Error('Identity session could not be decrypted');
    }
    let record;
    try {
      record = JSON.parse(plaintext);
    } catch {
      record = null;
    }
    if (!isStoredRecord(record)) throw new Error('Identity session record is invalid');
    return { refreshToken: record.refreshToken, userId: record.userId };
  }

  async function readLegacy(ciphertext) {
    if (typeof unprotectLegacy !== 'function') {
      throw new Error('The Tauri identity session cannot be decrypted here');
    }
    let plaintext;
    try {
      plaintext = await unprotectLegacy(Buffer.from(ciphertext));
    } catch {
      throw new Error('The Tauri identity session could not be decrypted');
    }
    if (!(plaintext instanceof Uint8Array)) throw new Error('The Tauri identity session is invalid');
    let refreshToken;
    try {
      refreshToken = utf8.decode(plaintext);
    } catch {
      refreshToken = null;
    } finally {
      plaintext.fill(0);
    }
    if (!isUrlSafeToken(refreshToken, REFRESH_TOKEN_LENGTH)) {
      throw new Error('The Tauri identity session is invalid');
    }
    return { refreshToken, userId: null };
  }

  function load() {
    return serialized(async () => {
      const current = await readRecordFile(filePath, STORE_MAGIC);
      if (current) return readCurrent(current);
      const legacy = legacyTauriPath ? await readRecordFile(legacyTauriPath, LEGACY_MAGIC) : null;
      return legacy ? readLegacy(legacy) : null;
    });
  }

  function save({ refreshToken, userId } = {}) {
    if (!isUrlSafeToken(refreshToken, REFRESH_TOKEN_LENGTH) || !isCanonicalUuid(userId)) {
      return Promise.reject(new Error('Identity session record is invalid'));
    }
    return serialized(async () => {
      const encrypted = await encryptString(
        JSON.stringify({ schemaVersion: SCHEMA_VERSION, refreshToken, userId }),
      );
      if (!(encrypted instanceof Uint8Array) || encrypted.length === 0) {
        throw new Error('Identity session encryption failed');
      }
      const contents = Buffer.concat([STORE_MAGIC, encrypted]);
      if (contents.length > MAXIMUM_TOKEN_FILE_BYTES) {
        throw new Error('Identity session record is oversized');
      }
      await writeFileAtomically(filePath, contents);
      // Load prefers the new file, so a legacy file that cannot be removed now is only retried.
      if (legacyTauriPath) await rm(legacyTauriPath, { force: true }).catch(() => {});
    });
  }

  function clear() {
    return serialized(async () => {
      const results = await Promise.allSettled(
        [filePath, legacyTauriPath].filter(Boolean).map((target) => rm(target, { force: true })),
      );
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Identity session could not be removed');
      }
    });
  }

  return Object.freeze({ load, save, clear });
}

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
  '$plain = [Security.Cryptography.ProtectedData]::Unprotect($data, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
  '[Array]::Clear($plain, 0, $plain.Length)',
].join('; ');

function windowsPowerShellPath() {
  const windowsRoot = String(process.env.SystemRoot || process.env.WINDIR || '').trim();
  if (!windowsRoot) throw new Error('Windows system directory is unavailable');
  return path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// CurrentUser DPAPI without entropy via Windows PowerShell 5.1; bytes travel only over stdin/stdout.
export function unprotectLegacyWithPowerShell(bytes, {
  powershellPath,
  spawnProcess = spawn,
  timeoutMs = POWERSHELL_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(
        powershellPath ?? windowsPowerShellPath(),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', UNPROTECT_SCRIPT],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
      );
    } catch {
      reject(new Error('Windows PowerShell could not start'));
      return;
    }
    const chunks = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Windows DPAPI timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAXIMUM_POWERSHELL_OUTPUT_BYTES) chunks.push(Buffer.from(chunk));
    });
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('Windows PowerShell could not start')));
    child.on('close', (code) => {
      const output = Buffer.concat(chunks);
      const encoded = output.toString('ascii').trim();
      output.fill(0);
      if (code !== 0 || outputBytes > MAXIMUM_POWERSHELL_OUTPUT_BYTES || !BASE64.test(encoded)) {
        finish(new Error('Windows DPAPI could not decrypt the Tauri identity session'));
        return;
      }
      finish(null, Buffer.from(encoded, 'base64'));
    });
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}
