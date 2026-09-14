import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  readFile as readFileAsync,
  rename as renameAsync,
  rm,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import path from 'node:path';

// Replaces UpdateStartupConfirmation.cs. The helper that swapped this version in
// (scripts/release/runStagedUpdate.mjs) polls updateProbation.mjs#waitForStartupConfirmation for up
// to 15 s after launching us and rolls back unless the marker's schemaVersion, transactionId,
// targetVersion, token and processId (the PID it launched, i.e. this main process) all match.
export const STARTUP_VARIABLES = Object.freeze([
  'AIFISHER_UPDATE_STARTUP_TRANSACTION',
  'AIFISHER_UPDATE_STARTUP_TOKEN',
  'AIFISHER_UPDATE_STARTUP_VERSION',
]);
export const UPDATE_HANDOFF_VARIABLES = Object.freeze([
  ...STARTUP_VARIABLES,
  'AIFISHER_UPDATE_GUARD_CODE',
  'AIFISHER_UPDATE_GUARD_OWNER_PID',
]);
const CONFIRMATION_FILE_NAME = 'startup-confirmation.json';
const TOKEN = /^[0-9a-fA-F]{64}$/u;
const TRANSACTION_ID = /^[a-f0-9]{32}$/u;

export function parseTransaction(text) {
  try {
    const source = String(text);
    const value = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function tokensEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

// authorized_startup from update_guard.rs, with a constant-time token comparison.
export function authorizedStartup(transaction, { token, version }) {
  return (
    typeof token === 'string' &&
    TOKEN.test(token) &&
    transaction?.schemaVersion === 1 &&
    transaction.state === 'probation' &&
    tokensEqual(transaction.confirmationToken, token) &&
    typeof version === 'string' &&
    transaction.targetVersion === version
  );
}

// DateTimeOffset.UtcNow as System.Text.Json writes it: round-trip format, fraction zeros trimmed.
function dotnetUtcTimestamp(milliseconds) {
  const [whole, fraction] = new Date(milliseconds).toISOString().slice(0, -1).split('.');
  const digits = fraction.replace(/0+$/u, '');
  return `${whole}${digits ? `.${digits}` : ''}+00:00`;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  );
}

const present = (value) => (typeof value === 'string' && value.trim() ? value : null);

// Call once, from the main process the helper launched, after the first page has loaded and
// within 15 s of launch. The five handoff variables are always removed from `environment`.
export async function confirmUpdateStartup({
  environment = process.env,
  productVersion,
  processId = process.pid,
  installRoot = null,
  readFile = readFileAsync,
  writeFile = writeFileAsync,
  rename = renameAsync,
  removeFile = (file) => rm(file, { force: true }),
  now = Date.now,
} = {}) {
  const outcome = (confirmed, reason) => ({ confirmed, reason });
  const [transactionValue, token, version] = STARTUP_VARIABLES.map((name) =>
    present(environment[name]),
  );
  try {
    if (!transactionValue && !token && !version) return outcome(false, 'not-requested');
    if (!transactionValue || !token || !version) return outcome(false, 'incomplete-environment');
    if (!Number.isSafeInteger(processId) || processId <= 0)
      return outcome(false, 'invalid-process');
    if (!TOKEN.test(token)) return outcome(false, 'invalid-token');
    if (version !== productVersion) return outcome(false, 'version-mismatch');
    const transactionPath = path.resolve(transactionValue);
    let transaction = null;
    try {
      transaction = parseTransaction(await readFile(transactionPath, 'utf8'));
    } catch {
      transaction = null;
    }
    if (!transaction) return outcome(false, 'transaction-unreadable');
    if (!TRANSACTION_ID.test(String(transaction.transactionId))) {
      return outcome(false, 'transaction-invalid');
    }
    if (!authorizedStartup(transaction, { token, version })) {
      return outcome(false, 'transaction-mismatch');
    }
    const directory = path.dirname(transactionPath);
    if (installRoot && isInside(installRoot, directory))
      return outcome(false, 'inside-install-root');

    const markerPath = path.join(directory, CONFIRMATION_FILE_NAME);
    const temporaryPath = path.join(
      directory,
      `.${CONFIRMATION_FILE_NAME}.${randomUUID().replaceAll('-', '')}.tmp`,
    );
    const marker = {
      schemaVersion: 1,
      transactionId: transaction.transactionId,
      confirmationToken: token,
      targetVersion: version,
      processId,
      confirmedAt: dotnetUtcTimestamp(now()),
    };
    try {
      await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryPath, markerPath);
      return outcome(true, 'confirmed');
    } catch {
      return outcome(false, 'write-failed');
    } finally {
      try {
        await removeFile(temporaryPath);
      } catch {
        // Only a leftover temporary file; the outcome above stands.
      }
    }
  } finally {
    for (const name of UPDATE_HANDOFF_VARIABLES) delete environment[name];
  }
}
