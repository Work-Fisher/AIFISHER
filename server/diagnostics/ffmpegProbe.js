import { execFile } from 'node:child_process';
import path from 'node:path';

// Probe the same bundled executable used by media editing, never cwd or PATH.
export function isBundledFFmpegAvailable(binaryDirectory, { runFile = execFile } = {}) {
  const executable = path.join(binaryDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return new Promise((resolve) => {
    try {
      runFile(executable, ['-version'], {
        timeout: 4_000,
        windowsHide: true,
        maxBuffer: 128 * 1024,
      }, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}
