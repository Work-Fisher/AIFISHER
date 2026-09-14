export interface MediaMetadata {
  resultAspectRatio?: string;
  aspectRatio?: string;
  lastFrame?: string;
}
export function nearestAspectRatio(width: number, height: number): string | undefined {
  if (!(width > 0) || !(height > 0)) return undefined;
  const choices = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
  return choices.reduce((best, choice) => {
    const value = (label: string) => {
      const [w, h] = label.split(':').map(Number);
      return Math.abs(width / height - w / h);
    };
    return value(choice) < value(best) ? choice : best;
  });
}
export function readableMediaUrl(url: string): string {
  const parsed = new URL(url, window.location.href);
  return ['http:', 'https:'].includes(parsed.protocol) &&
    parsed.origin !== window.location.origin &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    ? `/api/proxy?url=${encodeURIComponent(url)}`
    : url;
}
export function inspectImage(url: string, timeoutMs = 5000): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (metadata: MediaMetadata) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      resolve(metadata);
    };
    const timer = setTimeout(() => finish({}), timeoutMs);
    image.crossOrigin = 'anonymous';
    image.onload = () =>
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? {
              resultAspectRatio: `${image.naturalWidth}/${image.naturalHeight}`,
              aspectRatio: nearestAspectRatio(image.naturalWidth, image.naturalHeight),
            }
          : {},
      );
    image.onerror = () => finish({});
    try {
      image.src = readableMediaUrl(url);
    } catch {
      finish({});
    }
  });
}
export function inspectVideo(
  url: string,
  timeoutMs = 5000,
  includeLastFrame = true,
): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let finished = false;
    const metadata: MediaMetadata = {};
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(metadata);
    };
    const timer = setTimeout(finish, timeoutMs);
    const capture = () => {
      try {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(video, 0, 0);
            metadata.lastFrame = canvas.toDataURL('image/png');
          }
        }
      } catch {
        /* Metadata or preview failure cannot invalidate an already completed generation. */
      }
      finish();
    };
    video.crossOrigin = 'anonymous';
    video.preload = includeLastFrame ? 'auto' : 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        metadata.resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        metadata.aspectRatio = nearestAspectRatio(video.videoWidth, video.videoHeight);
      }
      if (!includeLastFrame) finish();
    };
    video.onloadeddata = () => {
      const time = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : 0;
      if (time > 0) {
        try {
          video.currentTime = time;
        } catch {
          capture();
        }
      } else capture();
    };
    video.onseeked = capture;
    video.onerror = finish;
    try {
      video.src = readableMediaUrl(url);
    } catch {
      finish();
    }
  });
}
export const extractVideoLastFrame = async (url: string) =>
  (await inspectVideo(url)).lastFrame ?? null;
