import { readableMediaUrl } from './generationMediaMetadata';
export function currentVideoFrame(video: HTMLVideoElement): string {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw Error('视频画面尚未准备好，请稍后截图');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (canvas.width * canvas.height > 64 * 1024 * 1024) throw Error('视频画面过大，无法截图');
  const context = canvas.getContext('2d');
  if (!context) throw Error('无法创建截图画布');
  try {
    context.drawImage(video, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    throw Error('无法读取此视频画面，请先将视频保存到本地素材');
  }
}
/** A separate decoder leaves the visible player's position and playback untouched. */
export async function firstLastVideoFrames(
  url: string,
  signal: AbortSignal,
): Promise<[string, string]> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  const wait = (event: string, action: () => void, ready: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        video.removeEventListener(event, complete);
        video.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      };
      const complete = () => {
        if (ready()) finish();
      };
      const failed = () => finish(Error('视频读取失败，无法截取首尾帧'));
      const aborted = () => finish(new DOMException('截图已取消', 'AbortError'));
      const timer = setTimeout(() => finish(Error('视频截图等待超时，请稍后重试')), 10000);
      video.addEventListener(event, complete);
      video.addEventListener('error', failed);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      try {
        action();
        complete();
      } catch (cause) {
        finish(cause instanceof Error ? cause : Error('视频定位失败'));
      }
    });
  try {
    await wait(
      'loadeddata',
      () => {
        video.src = readableMediaUrl(url);
        video.load();
      },
      () => video.readyState >= 2,
    );
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw Error('无法读取视频时长');
    const first = currentVideoFrame(video),
      // Stay inside the final frame without seeking beyond the playable timeline.
      lastTime = Math.max(0, video.duration - 0.000001);
    if (lastTime > 0)
      await wait(
        'seeked',
        () => {
          video.currentTime = lastTime;
        },
        () =>
          !video.seeking && Math.abs(video.currentTime - lastTime) < 0.01 && video.readyState >= 2,
      );
    if (signal.aborted) throw new DOMException('截图已取消', 'AbortError');
    return [first, currentVideoFrame(video)];
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
