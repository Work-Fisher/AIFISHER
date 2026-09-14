import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// Port of apps/tauri-shell/src-tauri/src/update.rs and the update_* commands in lib.rs. The first
// Electron release still drives app/tools/AIFISHER.UpdateBridge.exe (JSON lines on stdout).
const MAXIMUM_EVENT_BYTES = 64 * 1024;
const CURRENT_REUSE_MS = 5 * 60_000;
const STRING_FIELDS = ['status', 'stage', 'version', 'title', 'summary', 'message'];
const INTEGER_FIELDS = ['completedBytes', 'totalBytes', 'overallPercent'];

function blankEvent(fields) {
  return {
    revision: 0,
    event: '',
    status: null,
    stage: null,
    completedBytes: null,
    totalBytes: null,
    overallPercent: null,
    version: null,
    title: null,
    summary: null,
    changes: [],
    message: null,
    ...fields,
  };
}

function complete(status, message) {
  return blankEvent({ event: 'complete', status, message });
}

function copyEvent(event) {
  return { ...event, changes: [...event.changes] };
}

// Accepts what serde accepted for DesktopUpdateEvent: unknown fields drop, a wrong type skips the line.
function parseEvent(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.event !== 'string'
  ) {
    return null;
  }
  const event = blankEvent({ event: value.event });
  for (const key of STRING_FIELDS) {
    if (value[key] == null) continue;
    if (typeof value[key] !== 'string') return null;
    event[key] = value[key];
  }
  for (const key of INTEGER_FIELDS) {
    if (value[key] == null) continue;
    if (!Number.isSafeInteger(value[key])) return null;
    event[key] = value[key];
  }
  if (value.revision !== undefined) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) return null;
    event.revision = value.revision;
  }
  if (value.changes !== undefined) {
    if (!Array.isArray(value.changes) || value.changes.some((item) => typeof item !== 'string')) {
      return null;
    }
    event.changes = [...value.changes];
  }
  return event;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export function createUpdateCoordinator({
  bridgePath,
  installRoot,
  ownerPid = process.pid,
  spawnImpl = spawn,
  now = () => performance.now(),
  sourceSettingsPath,
}) {
  let latest = blankEvent({
    event: 'progress',
    status: 'checking',
    stage: 'ComparingInstalled',
    completedBytes: 0,
    totalBytes: 0,
    overallPercent: 0,
    message: '正在检查签名更新…',
  });
  let preparing = null;
  let completedAt = null;
  let applying = false;
  let sourceChanging = false;
  let sourceInvalidated = false;
  let sourceLoaded = false;
  let localSource = null;
  const listeners = new Set();

  async function source() {
    if (!sourceLoaded) {
      if (sourceSettingsPath) {
        try {
          const value = JSON.parse(await readFile(sourceSettingsPath, 'utf8'));
          if (value.schemaVersion !== 1 || (value.directory !== null &&
              (typeof value.directory !== 'string' || !path.isAbsolute(value.directory)))) {
            throw new Error('本机更新测试设置无效，请重新选择目录或恢复正式更新源。');
          }
          localSource = value.directory;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      sourceLoaded = true;
    }
    return { directory: localSource, enabled: Boolean(localSource) };
  }

  async function setSource(directory) {
    if (preparing || applying || sourceChanging) throw new Error('更新正在准备或执行，请完成后再切换更新源。');
    if (!installRoot || !sourceSettingsPath) throw new Error('请在安装版中使用本机更新测试。');
    sourceChanging = true;
    try {
      if (directory !== null && (typeof directory !== 'string' || !path.isAbsolute(directory) ||
          directory.startsWith('\\\\') || !(await stat(directory)).isDirectory())) {
        throw new Error('请选择本机磁盘上的更新测试目录。');
      }
      await mkdir(path.dirname(sourceSettingsPath), { recursive: true });
      const temporary = `${sourceSettingsPath}.tmp`;
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, directory }) + '\n');
      await rename(temporary, sourceSettingsPath);
      localSource = directory;
      sourceLoaded = true;
      sourceInvalidated = true;
      completedAt = null;
      record(complete('current', directory ? '已选择本机测试源，点击检查更新。' : '已恢复正式更新源。'));
      return source();
    } finally {
      sourceChanging = false;
    }
  }

  function emit(event) {
    for (const listener of [...listeners]) {
      try {
        listener(copyEvent(event));
      } catch {
        // One broken page listener must not stop the others or the bridge.
      }
    }
    return event;
  }

  function record(event) {
    latest = { ...event, revision: latest.revision + 1 };
    return emit(latest);
  }

  function readBridge(child, command, publish) {
    return new Promise((resolve) => {
      let pending = Buffer.alloc(0);
      let finalEvent = null;
      let settled = false;
      const finish = (event) => {
        settled = true;
        resolve(event);
      };
      const detach = () => {
        child.stdout.destroy();
        child.unref?.();
      };
      const tooLarge = () => {
        try {
          child.kill();
        } catch {
          // Already exited.
        }
        detach();
        finish(publish(complete('failed', 'AIFISHER 更新桥返回内容过大。')));
      };
      const accept = (bytes) => {
        const line = bytes.at(-1) === 0x0d ? bytes.subarray(0, -1) : bytes;
        if (line.length > MAXIMUM_EVENT_BYTES) return tooLarge();
        const parsed = parseEvent(line.toString('utf8'));
        if (!parsed) return;
        const event = publish(parsed);
        if (command === 'apply' && event.event === 'complete' && event.status === 'applying') {
          // The helper inherits this pipe and holds it open for the whole update.
          detach();
          return finish(event);
        }
        if (event.event === 'complete') finalEvent = event;
      };
      child.stdout.on('error', () => {});
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        pending = Buffer.concat([pending, chunk]);
        let newline = pending.indexOf(0x0a);
        while (newline !== -1 && !settled) {
          accept(pending.subarray(0, newline));
          pending = pending.subarray(newline + 1);
          newline = pending.indexOf(0x0a);
        }
        if (!settled && pending.length > MAXIMUM_EVENT_BYTES + 1) tooLarge();
      });
      child.on('error', () => {
        if (!settled) finish(publish(complete('failed', '无法启动 AIFISHER 更新桥。')));
      });
      child.once('close', (code) => {
        if (settled) return;
        if (pending.length > 0) accept(pending);
        if (settled) return;
        finish(
          finalEvent ??
            publish(
              complete(
                'failed',
                code === 0 ? 'AIFISHER 更新桥未返回完成状态。' : 'AIFISHER 更新桥执行失败。',
              ),
            ),
        );
      });
    });
  }

  async function runBridge(command, extraArguments, publish) {
    if (!installRoot) {
      return publish(complete('disabled', '当前不是完整安装目录，不检查更新。'));
    }
    if (!bridgePath || !(await isFile(bridgePath))) {
      return publish(complete('disabled', '当前安装未包含更新桥。'));
    }
    let child;
    try {
      if (command === 'prepare') {
        const selected = await source();
        if (selected.directory) extraArguments = [...extraArguments, `--local-source=${selected.directory}`];
      }
      child = spawnImpl(bridgePath, [command, `--install-root=${installRoot}`, ...extraArguments], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        shell: false,
      });
    } catch {
      return publish(complete('failed', '无法启动 AIFISHER 更新桥。'));
    }
    if (!child?.stdout) {
      try {
        child?.kill();
      } catch {
        // Nothing to stop.
      }
      return publish(complete('failed', 'AIFISHER 更新桥没有返回状态。'));
    }
    return readBridge(child, command, publish);
  }

  // One bridge at a time. "current" is reused for five minutes and "failed" may be retried; every
  // other result (ready, disabled) stands until the app restarts, as in Tauri.
  function prepare({ force = false } = {}) {
    if (sourceChanging) return Promise.reject(new Error('正在切换更新源。'));
    if (!preparing) {
      if (completedAt !== null) {
        const expired = now() - completedAt >= CURRENT_REUSE_MS;
        const refreshable = latest.status === 'failed' || (latest.status === 'current' && (expired || force));
        if (!refreshable) return Promise.resolve(copyEvent(latest));
        completedAt = null;
      }
      preparing = runBridge('prepare', [`--owner-pid=${ownerPid}`], record)
        .catch(() => record(complete('failed', 'AIFISHER 更新桥执行失败。')))
        .then((result) => {
          latest = result;
          if (result.status === 'ready') sourceInvalidated = false;
          preparing = null;
          completedAt = now();
          return result;
        });
    }
    return preparing.then(copyEvent);
  }

  // Contract: `beforeHandoff` saves and stops the backend (Tauri's prepare_for_update) and resolves
  // true; it runs inside the single-apply guard. apply() resolves once the bridge reports "applying"
  // and the caller must then quit at once: the helper waits about 2 s for ownerPid, then terminates
  // it and starts swapping files. On rejection the app keeps running and `afterFailedHandoff`
  // restarts the backend. Apply events are emitted but not recorded, so status() keeps the prepare
  // result, exactly as update.rs did.
  async function apply({ beforeHandoff, afterFailedHandoff } = {}) {
    if (sourceChanging || sourceInvalidated || preparing) throw new Error('请先完成当前更新源的候选校验。');
    if (applying) return complete('applying', '更新正在进行，完成后会自动打开。');
    applying = true;
    if (
      beforeHandoff &&
      !(await Promise.resolve()
        .then(beforeHandoff)
        .catch(() => false))
    ) {
      applying = false;
      throw new Error('本机服务未能在更新前安全停止。');
    }
    const event = await runBridge('apply', [`--wait-pid=${ownerPid}`], emit).catch(() =>
      emit(complete('failed', 'AIFISHER 更新桥执行失败。')),
    );
    if (event.status === 'applying') return copyEvent(event);
    try {
      await afterFailedHandoff?.();
    } catch {
      // The failure below is what the page needs to see.
    }
    applying = false;
    throw new Error(event.message || '更新 helper 未能启动。');
  }

  return {
    status: () => copyEvent(latest),
    prepare,
    apply,
    source,
    setSource,
    onProgress(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
