import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { inspectMediaArtifact, resolveMediaArtifact } from '../media/mediaArtifact.js';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';
import { WorkflowOutputError } from './workflowOutputs.js';

function artifact(kind, extension, mimeType, metadata) {
  return { ...resolveMediaArtifact({ declaredType: kind }), extension, mimeType, metadata };
}

/** Extra source formats are accepted only here. Published assets still use browser formats. */
export async function inspectWorkflowMedia(options) {
  const { prefix, filePath, probeMediaMetadata } = options;
  const hex = prefix.toString('hex'), ascii = prefix.toString('ascii');
  const brand = ascii.slice(4, 8) === 'ftyp' ? ascii.slice(8, 12) : '';
  if (/^(49492a00|4d4d002a|49492b00|4d4d002b)/.test(hex)) return artifact('image', '.tiff', 'image/tiff');
  if (['avif', 'avis'].includes(brand)) return artifact('image', '.avif', 'image/avif');
  const aiff = ascii.startsWith('FORM') && ['AIFF', 'AIFC'].includes(ascii.slice(8, 12));
  const caf = ascii.startsWith('caff');
  const ac3 = hex.startsWith('0b77');
  const avi = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'AVI ';
  const asf = hex.startsWith('3026b2758e66cf11a6d900aa0062ce6c');
  const flv = ascii.startsWith('FLV');
  const mpeg = hex.startsWith('000001ba') || hex.startsWith('000001b3');
  const ts = [0, 4].some(offset => prefix[offset] === 0x47 && prefix[offset + (offset ? 192 : 188)] === 0x47);
  if (avi || asf || flv || mpeg || ts || aiff || caf || ac3) {
    for (const kind of aiff || caf || ac3 ? ['audio'] : ['video', 'audio']) {
      try {
        const metadata = await probeMediaMetadata(filePath, kind === 'video' ? 'videos' : 'audios');
        return artifact(kind, kind === 'video' ? '.source-video' : '.source-audio', 'application/octet-stream', metadata);
      } catch (error) { if (error.code !== 'MEDIA_STREAM_NOT_FOUND') throw error; }
    }
  }
  // Ogg can contain Theora video even when a node labels it as audio.
  if (ascii.startsWith('OggS')) {
    try { return artifact('video', '.source-video', 'video/ogg', await probeMediaMetadata(filePath, 'videos')); }
    catch (error) { if (error.code !== 'MEDIA_STREAM_NOT_FOUND') throw error; }
  }
  return inspectMediaArtifact(options);
}

export async function convertedIntegrity(filePath, maximumBytes, contentType) {
  let bytes = 0; const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new WorkflowOutputError('兼容副本超过本地化限制', 'OUTPUT_SIZE_LIMIT', 413);
    hash.update(chunk);
  }
  if (!bytes) throw new WorkflowOutputError('兼容转换未输出有效文件', 'OUTPUT_PLAYBACK_CONVERSION_FAILED');
  return { bytes, sha256: hash.digest('hex'), contentType };
}

export async function runWorkflowConversion(args, { signal, spawnProcess = spawn } = {}) {
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawnProcess(path.join(RUNTIME_PATHS.BIN_DIR, 'ffmpeg.exe'),
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let settled = false, stopped = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const failed = () => new WorkflowOutputError('媒体兼容转换失败，请检查本机媒体组件与原文件。', 'OUTPUT_PLAYBACK_CONVERSION_FAILED');
    const abort = () => { stopped = true; child.kill(); };
    const timer = setTimeout(abort, 30 * 60 * 1000); timer.unref?.();
    child.stderr?.resume();
    child.once('error', () => finish(failed()));
    child.once('close', code => finish(code === 0 && !stopped ? null : failed()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  signal?.throwIfAborted();
}

export async function prepareWorkflowCompatibility({ inputPath, artifact: source, outputPath, signal, probeMediaMetadata }) {
  signal?.throwIfAborted();
  if (source.kind === 'image' && ['.tiff', '.avif'].includes(source.extension)) {
    try {
      // A bounded source buffer avoids libvips retaining a Windows file handle
      // across the output transaction's rename/cleanup boundary.
      const image = sharp(await readFile(inputPath), { limitInputPixels: 40_000_000, animated: true });
      const metadata = await image.metadata();
      if ((metadata.pages || 1) > 1) {
        // Preserve animation/pages as a single animated WebP rather than silently dropping frames.
        await image.toColourspace('srgb').webp({ lossless: true, loop: metadata.loop || 0, delay: metadata.delay }).toFile(outputPath);
        signal?.throwIfAborted();
        return artifact('image', '.webp', 'image/webp');
      }
      await image.rotate().toColourspace('srgb').png().toFile(outputPath);
      signal?.throwIfAborted();
      return artifact('image', '.png', 'image/png');
    } catch {
      throw new WorkflowOutputError('图像兼容转换失败，原文件可能损坏、过大或包含不支持的编码。', 'OUTPUT_PLAYBACK_CONVERSION_FAILED');
    }
  }
  if (source.kind !== 'audio' || ['.mp3', '.aac', '.flac'].includes(source.extension)) return null;
  const metadata = source.metadata || await probeMediaMetadata(inputPath, 'audios');
  const safe = { '.wav': ['pcm_s16le', 'pcm_u8'], '.m4a': ['aac'], '.ogg': ['vorbis', 'opus'], '.webm': ['opus', 'vorbis'] };
  if (safe[source.extension]?.includes(metadata.audioCodec)) return null;
  await runWorkflowConversion(['-i', inputPath, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart', '-f', 'mp4', outputPath], { signal });
  const converted = await probeMediaMetadata(outputPath, 'audios');
  if (converted.audioCodec !== 'aac') throw new WorkflowOutputError('音频兼容副本校验失败', 'OUTPUT_PLAYBACK_CONVERSION_FAILED');
  return artifact('audio', '.m4a', 'audio/mp4');
}
