import { spawn } from 'node:child_process';
import path from 'node:path';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';
import { resolveMediaArtifact } from './mediaArtifact.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export class MediaProbeError extends Error {
  constructor(message, status, code, cause) {
    super(message);
    this.name = 'MediaProbeError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function componentUnavailable(cause) {
  return new MediaProbeError(
    '本机媒体检查组件不可用，请重启控制中心或重新安装当前版本。',
    503,
    'BUNDLED_MEDIA_PROBE_UNAVAILABLE',
    cause,
  );
}

function readDuration(format, stream) {
  for (const value of [format?.duration, stream?.duration]) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration >= 0) return duration;
  }
  return null;
}

function mimeTypeFor(filePath, type) {
  try {
    return resolveMediaArtifact({ filename: filePath, declaredType: type }).mimeType;
  } catch {
    return null;
  }
}

function normalizeProbeResult(result, filePath, type) {
  const streams = Array.isArray(result?.streams) ? result.streams : [];
  const streamType = type === 'videos' ? 'video' : 'audio';
  const stream = streams.find((candidate) => candidate?.codec_type === streamType
    && !(streamType === 'video' && Number(candidate.disposition?.attached_pic) === 1));
  if (!stream) {
    throw new MediaProbeError(
      type === 'videos' ? '上传文件中没有可用的视频流。' : '上传文件中没有可用的音频流。',
      415,
      'MEDIA_STREAM_NOT_FOUND',
    );
  }

  const metadata = {
    duration: readDuration(result?.format, stream),
    mimeType: mimeTypeFor(filePath, type),
  };
  if (type === 'videos') {
    metadata.width = Number(stream.width) || null;
    metadata.height = Number(stream.height) || null;
    metadata.videoCodec = stream.codec_name || null;
    metadata.pixelFormat = stream.pix_fmt || null;
    metadata.audioCodec = streams.find((candidate) => candidate?.codec_type === 'audio')?.codec_name || null;
  } else {
    metadata.audioCodec = stream.codec_name || null;
  }
  return metadata;
}

function runProbe(ffprobePath, filePath, { spawnImpl, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(
        ffprobePath,
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      reject(componentUnavailable(error));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputExceeded = false;
    let timedOut = false;
    let spawnError = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();

    const appendOutput = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill();
      }
      return next.slice(0, MAX_OUTPUT_BYTES);
    };
    child.stdout?.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new MediaProbeError('媒体检查超时，请重试。', 504, 'MEDIA_PROBE_TIMEOUT'));
        return;
      }
      if (spawnError || outputExceeded) {
        reject(componentUnavailable(spawnError || new Error('ffprobe output exceeded limit')));
        return;
      }
      if (exitCode !== 0) {
        if (!stderr.trim()) {
          reject(componentUnavailable(new Error(`ffprobe exited with code ${exitCode}`)));
          return;
        }
        reject(new MediaProbeError('上传文件已损坏或不是有效媒体。', 415, 'INVALID_MEDIA_CONTENT'));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(componentUnavailable(error));
      }
    });
  });
}

export function createMediaMetadataProbe({
  ffprobePath = path.join(RUNTIME_PATHS.BIN_DIR, 'ffprobe.exe'),
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return async function probeMediaMetadata(filePath, type) {
    if (type !== 'videos' && type !== 'audios') {
      throw new TypeError(`Unsupported probe media type: ${type}`);
    }
    const result = await runProbe(ffprobePath, filePath, { spawnImpl, timeoutMs });
    return normalizeProbeResult(result, filePath, type);
  };
}
