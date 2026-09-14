import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
// One delay per tolerated crash inside the window; one more crash means the backend is broken.
const RESTART_DELAYS_MS = [300, 1_000, 2_000, 4_000, 8_000];
const RESTART_WINDOW_MS = 120_000;

// The backend lives in a utilityProcess owned by the main process and listens only on a fresh
// named pipe. Crashes restart it with backoff, and every state change reaches the window.
export function createBackendSupervisor({
  fork,
  entry,
  cwd,
  createEnvironment,
  logsDirectory,
  getAccessToken,
  serviceName = 'AIFISHER Backend',
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  readyTimeoutMs = READY_TIMEOUT_MS,
  stopTimeoutMs = STOP_TIMEOUT_MS,
}) {
  let state = 'stopped';
  let userId = null;
  let child = null;
  let pipe = null;
  let restartTimer = null;
  let crashes = [];
  let launchGeneration = 0;
  const listeners = new Set();

  function publish(next) {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  }

  function waitForReady() {
    if (state === 'ready') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const unsubscribe = onState((next) => {
        if (next === 'ready') {
          unsubscribe();
          resolve();
        } else if (next === 'failed' || next === 'stopped') {
          unsubscribe();
          reject(new Error(next === 'failed' ? 'BACKEND_FAILED' : 'BACKEND_STOPPED'));
        }
      });
    });
  }

  function openLogs(current) {
    const streams = [
      [current.stdout, createWriteStream(path.join(logsDirectory, 'backend.stdout.log'), { flags: 'a' })],
      [current.stderr, createWriteStream(path.join(logsDirectory, 'backend.stderr.log'), { flags: 'a' })],
    ];
    for (const [source, target] of streams) source?.pipe(target);
    return () => {
      for (const [source, target] of streams) {
        source?.unpipe(target);
        target.end();
      }
    };
  }

  function answerToken(current, id) {
    Promise.resolve()
      .then(() => getAccessToken())
      .catch(() => null)
      .then((token) => {
        if (child !== current) return;
        try {
          current.postMessage({ type: 'access-token', id, token: token ?? null });
        } catch {
          // The backend exited while the token was being fetched.
        }
      });
  }

  function handleExit(current) {
    if (child !== current) return;
    child = null;
    pipe = null;
    if (state === 'stopping' || state === 'stopped') {
      publish('stopped');
      return;
    }
    crashes = [...crashes.filter((time) => now() - time < RESTART_WINDOW_MS), now()];
    if (crashes.length > RESTART_DELAYS_MS.length) {
      publish('failed');
      return;
    }
    publish('reconnecting');
    restartTimer = setTimer(() => {
      restartTimer = null;
      void launch();
    }, RESTART_DELAYS_MS[crashes.length - 1]);
  }

  async function launch() {
    const expectedGeneration = launchGeneration;
    const launchPipe = `\\\\.\\pipe\\aifisher-backend-${randomUUID()}`;
    let environment;
    try {
      environment = await createEnvironment({ userId, pipe: launchPipe });
      await mkdir(logsDirectory, { recursive: true });
    } catch {
      if (expectedGeneration === launchGeneration) publish('failed');
      return;
    }
    if (expectedGeneration !== launchGeneration || state === 'stopping' || state === 'stopped') return;
    let current;
    try {
      current = fork(entry, [], { serviceName, cwd, env: environment, stdio: 'pipe' });
    } catch {
      publish('failed');
      return;
    }
    child = current;
    pipe = launchPipe;
    const closeLogs = openLogs(current);
    const timer = setTimer(() => current.kill(), readyTimeoutMs);
    current.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimer(timer);
        if (child === current) publish('ready');
      } else if (message?.type === 'access-token-request') {
        answerToken(current, message.id);
      }
    });
    current.once('exit', () => {
      clearTimer(timer);
      closeLogs();
      handleExit(current);
    });
  }

  async function stop() {
    launchGeneration += 1;
    if (restartTimer) {
      clearTimer(restartTimer);
      restartTimer = null;
    }
    const current = child;
    if (!current) {
      publish('stopped');
      return;
    }
    publish('stopping');
    const exited = new Promise((resolve) => current.once('exit', resolve));
    const killer = setTimer(() => current.kill(), stopTimeoutMs);
    try {
      // The backend flushes SQLite and stops the ComfyUI it owns before exiting.
      current.postMessage({ type: 'stop' });
    } catch {
      current.kill();
    }
    await exited;
    clearTimer(killer);
    publish('stopped');
  }

  async function start(nextUserId) {
    if (userId === nextUserId && ['starting', 'ready', 'reconnecting'].includes(state)) {
      return waitForReady();
    }
    if (child || restartTimer) await stop();
    launchGeneration += 1;
    userId = nextUserId;
    crashes = [];
    publish('starting');
    const ready = waitForReady();
    void launch();
    return ready;
  }

  function onState(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    start,
    stop,
    onState,
    state: () => state,
    pipePath: () => (state === 'ready' ? pipe : null),
    userId: () => userId,
  };
}
