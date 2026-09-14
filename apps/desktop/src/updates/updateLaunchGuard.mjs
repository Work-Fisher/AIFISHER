import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizedStartup, parseTransaction } from './startupConfirmation.mjs';

// The helper owns the install root while files are swapped and checked (applying) and while the
// swapped-in candidate starts and may still be rolled back (probation). Neither the C# store nor
// updateProbation.mjs has another such state: rollback runs inside these two until rolled-back.
// awaiting-restart is left out on purpose. prepare leaves it behind until the user applies, so
// deferring on it would block every later launch, and during an apply the old app still holds
// the single-instance lock until the helper moves the transaction to applying.
const SWAPPING_STATES = new Set(['applying', 'probation']);
// A helper that died mid-update leaves one of those states behind for good. A live update keeps
// updatedAt moving; its longest single state (copy, integrity check, probe, rollback) is minutes.
const STALE_AFTER_MS = 30 * 60_000;
const GUARD_WINDOW_TITLE = 'AIFISHER 更新';

export function defaultTransactionPath(environment = process.env) {
  const localAppData = environment.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'AIFISHER', 'ControlCenter', 'updates', 'transaction.json');
}

export const DEFAULT_TRANSACTION_PATH = defaultTransactionPath();

function readTransaction(readFile, file) {
  try {
    return parseTransaction(readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// Call before requestSingleInstanceLock(), so a manual launch during probation cannot take the
// lock from the candidate. A normal start costs one small synchronous read.
export function shouldDeferLaunch({
  environment = process.env,
  transactionPath = DEFAULT_TRANSACTION_PATH,
  readFile = readFileSync,
  now = Date.now,
} = {}) {
  const transaction = readTransaction(readFile, transactionPath);
  if (transaction?.schemaVersion !== 1 || !SWAPPING_STATES.has(transaction.state)) return false;
  if (!(Math.abs(now() - Date.parse(transaction.updatedAt)) < STALE_AFTER_MS)) return false;
  const bound = environment.AIFISHER_UPDATE_STARTUP_TRANSACTION
    ? readTransaction(readFile, environment.AIFISHER_UPDATE_STARTUP_TRANSACTION)
    : null;
  return !authorizedStartup(bound, {
    token: environment.AIFISHER_UPDATE_STARTUP_TOKEN,
    version: environment.AIFISHER_UPDATE_STARTUP_VERSION,
  });
}

// Best effort on the deferral path only; resolves whether the window was found and never rejects.
// A guard window the user closed is merely hidden and cannot be brought back this way.
export function activateUpdateWindow({ spawnImpl = spawn, timeoutMs = 5_000 } = {}) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = (activated) => {
      clearTimeout(timer);
      resolve(activated);
    };
    try {
      const child = spawnImpl(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(New-Object -ComObject WScript.Shell).AppActivate('${GUARD_WINDOW_TITLE}')`,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false },
      );
      let output = '';
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Already exited.
        }
        finish(false);
      }, timeoutMs);
      child.stdout?.on('error', () => {});
      child.stdout?.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', () => finish(false));
      child.once('close', () => finish(output.trim() === 'True'));
    } catch {
      finish(false);
    }
  });
}
