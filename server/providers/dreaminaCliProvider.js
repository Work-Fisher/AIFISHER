import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { remoteTaskReference, matchesRemoteTask } from '../generation/generationTaskRecovery.js';
import { materializeInputs } from './cliMediaInputs.js';

const TASK_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const SUBMIT_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mpeg', '.mpg']);

class DreaminaCliProviderError extends Error {
  constructor(code, message, { status = 500, retryable = false } = {}) {
    super(message);
    this.name = 'DreaminaCliProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.expose = true;
  }
}

function valuesOf(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string' && item);
}


function parseCliState(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  let parsed = null;
  // Current official CLI prints pretty JSON; retain the legacy JSONL/key=value fallback.
  try { parsed = JSON.parse(result?.stdout || ''); } catch { /* Legacy output below. */ }
  for (const line of output.split(/\r?\n/u)) {
    try {
      const candidate = JSON.parse(line.trim());
      if (candidate && typeof candidate === 'object') parsed = { ...(parsed || {}), ...candidate };
    } catch {
      // CLI 同时支持 key=value 文本输出；不是 JSON 的行由下面的正则读取。
    }
  }
  const read = (key) => {
    if (parsed?.[key] != null) return String(parsed[key]);
    return output.match(new RegExp(`(?:^|\\s)${key}\\s*[:=]\\s*["']?([^\\s"']+)`, 'imu'))?.[1] || '';
  };
  const failReason = parsed?.fail_reason != null
    ? String(parsed.fail_reason)
    : output.match(/(?:^|\s)fail_reason\s*[:=]\s*(.+)$/imu)?.[1]?.trim() || '';
  return {
    output,
    submitId: read('submit_id'),
    status: read('gen_status').toLowerCase(),
    failReason,
  };
}

function sanitizedFailure(output) {
  if (/AigcComplianceConfirmationRequired/iu.test(output)) {
    return '该模型首次使用前，需要先在即梦网页完成一次合规确认，然后再回到画布重试。';
  }
  if (/(?:未登录|请先登录|login required|unauthenticated|authorization)/iu.test(output)) {
    return '即梦 CLI 登录已失效，请到“设置 → 闭源服务”重新登录。';
  }
  return '即梦 CLI 未能提交任务，请检查模型参数、账号权限和网络后重试。';
}

async function executeChecked(runtime, args, signal) {
  const result = await runtime.execute(args, { signal, timeoutMs: 30_000 });
  if (result.code === 0) return result;
  throw new DreaminaCliProviderError(
    'DREAMINA_CLI_COMMAND_FAILED',
    sanitizedFailure(`${result.stdout || ''}\n${result.stderr || ''}`),
    { status: 502, retryable: true },
  );
}

function waitForPoll(signal) {
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error('Generation cancelled'), { name: 'AbortError' }));
  }
  return new Promise((resolve, reject) => {
    let timer;
    const finish = () => {
      signal?.removeEventListener?.('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      reject(Object.assign(new Error('Generation cancelled'), { name: 'AbortError' }));
    };
    timer = setTimeout(finish, POLL_INTERVAL_MS);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function mediaFiles(directory, extensions) {
  const found = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && !entry.isSymbolicLink() && extensions.has(path.extname(entry.name).toLowerCase())) {
        found.push(candidate);
      }
    }
  }
  await visit(directory);
  return found.sort();
}

const CLI_ENDPOINT = 'https://jimeng.jianying.com/cli';
const cliIdentity = (kind, params, account) => ({
  providerName: kind === 'image' ? 'DreaminaCliImageProvider' : 'DreaminaCliVideoProvider',
  modelId: kind === 'image' ? params.imageModel : params.videoModel,
  submitUrl: CLI_ENDPOINT, apiKey: account?.uid,
});
function taskFailed(state) {
  return Object.assign(new DreaminaCliProviderError('DREAMINA_TASK_FAILED',
    sanitizedFailure(state.failReason || state.output), { status: 502 }), { providerTaskFailed: true });
}
async function queryTask(runtime, taskId, kind, outputDirectory, signal) {
  const state = parseCliState(await executeChecked(runtime, [
    'query_result', `--submit_id=${taskId}`, `--download_dir=${outputDirectory}`,
  ], signal));
  if (state.submitId && state.submitId !== taskId) return { status: 'unknown', reason: 'task_mismatch' };
  if (state.status === 'fail') return { status: 'failed', error: taskFailed(state) };
  if (state.status !== 'success') return { status: state.status === 'querying' ? 'pending' : 'unknown' };
  const files = await mediaFiles(outputDirectory, kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS);
  if (!files.length) return { status: 'unknown' };
  const results = await Promise.all(files.map(async (file) => ({
    buffer: await readFile(file), format: path.extname(file).slice(1).replace('jpeg', 'jpg'),
  })));
  if (results.some((result) => !result.buffer.length)) return { status: 'unknown' };
  return kind === 'image' ? { status: 'success', results } : { status: 'success', ...results[0] };
}
async function canRecover(kind, reference, params, config) {
  const account = await config?.DREAMINA_CLI?.getAccount?.({ fresh: true });
  return Boolean(account && matchesRemoteTask(reference, cliIdentity(kind, params, account)));
}
async function recoverCli(kind, task, params, config, signal) {
  const runtime = config?.DREAMINA_CLI;
  const references = kind === 'image' ? task.remoteTasks : [task];
  if (!references?.length || references.length !== 1 || !runtime?.acquireAccount) return { status: 'unknown' };
  const lease = await runtime.acquireAccount();
  let directory;
  try {
    if (!matchesRemoteTask(references[0], cliIdentity(kind, params, lease.account))) return { status: 'unknown', reason: 'settings_changed' };
    directory = await runtime.createTaskDirectory();
    const result = await queryTask(runtime, references[0].taskId, kind, directory, signal);
    if (!(await canRecover(kind, references[0], params, config))) return { status: 'unknown', reason: 'settings_changed' };
    if (kind === 'image' && result.status === 'success' && result.results.length < task.requestedCount) result.status = 'partial';
    return result;
  } finally {
    if (directory) await runtime.cleanupTaskDirectory(directory).catch(() => {});
    lease.release();
  }
}
async function runTask(runtime, submitArgs, kind, params, config) {
  if (!runtime?.acquireAccount) throw new DreaminaCliProviderError('DREAMINA_CLI_UNAVAILABLE', '即梦 CLI 运行组件不可用，请更新 AIFISHER。', { status: 503, retryable: true });
  const lease = await runtime.acquireAccount();
  let taskDirectory;
  const signal = params.signal;
  try {
    taskDirectory = await runtime.createTaskDirectory();
    const identity = cliIdentity(kind, params, lease.account);
    config.generationTaskSubmitting?.();
    let submitted;
    try {
      submitted = parseCliState(await executeChecked(runtime, submitArgs, signal));
      if (submitted.status === 'fail') throw taskFailed(submitted);
      if (!SUBMIT_ID_PATTERN.test(submitted.submitId)) throw new Error('Missing submission receipt');
    } catch (error) {
      const notSubmitted = error.submissionNotStarted === true
        || ['DREAMINA_RUNTIME_ARGUMENT_INVALID', 'DREAMINA_CLI_NOT_INSTALLED'].includes(error.code);
      if (!error.providerTaskFailed && !notSubmitted) error.submissionUncertain = true;
      throw error;
    }
    const reference = remoteTaskReference({ ...identity, taskId: submitted.submitId });
    config.generationTaskSubmitted?.(reference);
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await queryTask(runtime, submitted.submitId, kind, taskDirectory, signal);
      if (result.status === 'failed') throw result.error;
      if (result.status === 'success') {
        if (!(await canRecover(kind, reference, params, config))) throw new Error('Account changed during observation');
        return kind === 'video' ? { buffer: result.buffer, format: result.format }
          : result.results.length === 1 ? result.results[0] : result.results;
      }
      if (result.status === 'unknown') throw new Error('Original task result is not yet confirmed');
      await waitForPoll(signal);
    }
    throw new DreaminaCliProviderError('DREAMINA_TASK_TIMEOUT', '原即梦任务仍待核对，请勿重复生成。', { status: 504 });
  } finally {
    if (taskDirectory) await runtime.cleanupTaskDirectory(taskDirectory).catch(() => {});
    lease.release();
  }
}

function imageResolution(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === '4k') return '4k';
  if (normalized === '2k') return '2k';
  return '1.5k';
}

function videoResolution(model, value) {
  const normalized = String(value || '720p').toLowerCase();
  if (model === 'seedance2.5' && ['480p', '720p', '1080p'].includes(normalized)) return normalized;
  if (model !== 'seedance2.5' && normalized === '720p') return normalized;
  throw new DreaminaCliProviderError(
    'DREAMINA_VIDEO_RESOLUTION_UNSUPPORTED',
    `${model === 'seedance2.5' ? 'Seedance 2.5' : '当前即梦 CLI 模型'}不支持 ${value || '当前'} 分辨率，请切换后重试。`,
    { status: 400 },
  );
}

function commonVideoArgs(params) {
  const model = String(params.videoModel || 'seedance2.0fast');
  const duration = params.duration == null ? 5 : Number(params.duration);
  if (!Number.isInteger(duration) || duration < 4 || duration > (model === 'seedance2.5' ? 30 : 15)) {
    throw new DreaminaCliProviderError('DREAMINA_DURATION_INVALID', '即梦视频时长需为支持范围内的整数秒。', { status: 400 });
  }
  return [
    `--prompt=${String(params.prompt || '')}`,
    `--duration=${duration}`,
    `--video_resolution=${videoResolution(model, params.resolution)}`,
    `--model_version=${model}`,
    '--poll=0',
  ];
}

export const DreaminaCliImageProvider = {
  canRecoverImage: (reference, params, config) => canRecover('image', reference, params, config),
  recoverImage: (task, params, config, signal) => recoverCli('image', task, params, config, signal),
  async generateImage(params, config) {
    const runtime = config?.DREAMINA_CLI;
    const inputs = valuesOf(params.images || params.imageBase64);
    const taskDirectory = inputs.length ? await runtime?.createTaskDirectory?.() : null;
    try {
      const inputDirectory = taskDirectory ? path.join(taskDirectory, 'input') : null;
      if (inputDirectory) await mkdir(inputDirectory, { recursive: true });
      const images = inputDirectory ? await materializeInputs(inputs.slice(0, 10), 'image', inputDirectory) : [];
      const mode = params.imageMode === 'image-to-image' || images.length ? 'image2image' : 'text2image';
      if (mode === 'image2image' && !images.length) {
        throw new DreaminaCliProviderError(
          'DREAMINA_IMAGE_REQUIRED',
          '即梦 CLI 图生图需要至少一张输入图片。',
          { status: 400 },
        );
      }
      const args = [
        mode,
        ...images.map((file) => `--images=${file}`),
        `--prompt=${String(params.prompt || '')}`,
        `--ratio=${String(params.aspectRatio || '16:9')}`,
        `--resolution_type=${imageResolution(params.resolution)}`,
        `--model_version=${String(params.imageModel || '5.0Pro')}`,
        `--generate_num=${Math.max(1, Math.min(10, Number(params.generateCount) || 1))}`,
        '--poll=0',
      ];
      return await runTask(runtime, args, 'image', params, config);
    } finally {
      if (taskDirectory) await runtime.cleanupTaskDirectory(taskDirectory).catch(() => {});
    }
  },
};

export const DreaminaCliVideoProvider = {
  canRecoverVideo: (reference, params, config) => canRecover('video', reference, params, config),
  recoverVideo: (reference, params, config, signal) => recoverCli('video', reference, params, config, signal),
  async generateVideo(params, config) {
    const runtime = config?.DREAMINA_CLI;
    const taskDirectory = await runtime?.createTaskDirectory?.();
    if (!taskDirectory) {
      throw new DreaminaCliProviderError(
        'DREAMINA_CLI_UNAVAILABLE',
        '即梦 CLI 运行组件不可用。',
        { status: 503, retryable: true },
      );
    }
    try {
      const inputDirectory = path.join(taskDirectory, 'input');
      await mkdir(inputDirectory, { recursive: true });
      const [images, videos, audios] = await Promise.all([
        materializeInputs(valuesOf(params.images || params.imageBase64), 'image', inputDirectory),
        materializeInputs(valuesOf(params.videos || params.videoUrl), 'video', inputDirectory),
        materializeInputs(valuesOf(params.audios || params.audioBase64), 'audio', inputDirectory),
      ]);
      const mode = String(params.videoMode || 'text-to-video');
      const common = commonVideoArgs(params);
      let args;
      if (mode === 'text-to-video') {
        args = ['text2video', ...common.slice(0, 2), `--ratio=${String(params.aspectRatio || '16:9')}`, ...common.slice(2)];
      } else if (mode === 'i2v-first-last-frame') {
        if (images.length < 2) {
          throw new DreaminaCliProviderError('DREAMINA_FRAMES_REQUIRED', '即梦 CLI 首尾帧模式需要两张图片。', { status: 400 });
        }
        args = ['frames2video', `--first=${images[0]}`, `--last=${images[1]}`, ...common];
      } else if (mode === 'multimodal') {
        if (params.videoModel !== 'seedance2.5' && !images.length && !videos.length) {
          throw new DreaminaCliProviderError('DREAMINA_VISUAL_REFERENCE_REQUIRED', 'Seedance 2.0 系列全能参考需要至少一张图片或一段视频，不能只提供音频。', { status: 400 });
        }
        if (!images.length && !videos.length && !audios.length) {
          throw new DreaminaCliProviderError('DREAMINA_REFERENCE_REQUIRED', '即梦 CLI 全能参考至少需要一个参考素材。', { status: 400 });
        }
        args = [
          'multimodal2video',
          ...images.flatMap((file) => [`--image=${file}`]),
          ...videos.flatMap((file) => [`--video=${file}`]),
          ...audios.flatMap((file) => [`--audio=${file}`]),
          ...common.slice(0, 2),
          `--ratio=${String(params.aspectRatio || '16:9')}`,
          ...common.slice(2),
        ];
      } else {
        if (!images.length) {
          throw new DreaminaCliProviderError('DREAMINA_IMAGE_REQUIRED', '即梦 CLI 首帧模式需要一张图片。', { status: 400 });
        }
        args = ['image2video', `--image=${images[0]}`, ...common];
      }
      return await runTask(runtime, args, 'video', params, config);
    } finally {
      await runtime.cleanupTaskDirectory(taskDirectory).catch(() => {});
    }
  },
};
