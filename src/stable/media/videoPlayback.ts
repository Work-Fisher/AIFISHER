import { preferenceStorage } from '../persistence/preferenceStore';

const VIDEO_VOLUME_STORAGE_KEY = 'aifisher:video-volume';

type VideoPlaybackStorage = Pick<Storage, 'getItem' | 'setItem'>;
type VideoVisibilityEntry = Pick<IntersectionObserverEntry, 'isIntersecting'>;
type VideoVisibilityObserver = Pick<IntersectionObserver, 'observe' | 'disconnect'>;
type VideoVisibilityTarget = Pick<
  Document,
  'hidden' | 'addEventListener' | 'removeEventListener'
>;

export interface VideoSoundState {
  muted: boolean;
  volume: number;
}

interface StableVideoPlaybackOptions {
  storage?: VideoPlaybackStorage;
  requestAnimationFrame?: typeof window.requestAnimationFrame;
  cancelAnimationFrame?: typeof window.cancelAnimationFrame;
  createIntersectionObserver?: (
    callback: (entries: VideoVisibilityEntry[]) => void,
  ) => VideoVisibilityObserver;
  visibilityTarget?: VideoVisibilityTarget;
}

interface VideoAttachmentOptions {
  id: string;
  onProgress?: (currentTime: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onBufferingChange?: (buffering: boolean) => void;
  onError?: () => void;
  onVolumeChange?: (state: VideoSoundState) => void;
}

function normalizedVolume(value: unknown, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function readSavedVolume(storage?: VideoPlaybackStorage) {
  if (!storage) return 1;
  try {
    const saved = storage.getItem(VIDEO_VOLUME_STORAGE_KEY);
    return saved === null ? 1 : normalizedVolume(saved);
  } catch {
    return 1;
  }
}

export function createStableVideoPlayback({
  storage = preferenceStorage(),
  requestAnimationFrame: requestFrame = typeof window === 'undefined'
    ? undefined
    : window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: cancelFrame = typeof window === 'undefined'
    ? undefined
    : window.cancelAnimationFrame.bind(window),
  createIntersectionObserver = typeof IntersectionObserver === 'undefined'
    ? undefined
    : (callback) =>
        new IntersectionObserver((entries) => callback(entries), { threshold: 0.05 }),
  visibilityTarget = typeof document === 'undefined' ? undefined : document,
}: StableVideoPlaybackOptions = {}) {
  let savedVolume = readSavedVolume(storage);
  let lastAudibleVolume = savedVolume > 0 ? savedVolume : 1;
  let activeVideo: HTMLVideoElement | null = null;

  const persistVolume = (volume: number) => {
    savedVolume = volume;
    try {
      storage?.setItem(VIDEO_VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // Private browsing and locked-down storage must not break local playback.
    }
  };

  const soundState = (video: HTMLVideoElement): VideoSoundState => ({
    muted: video.muted,
    volume: video.volume,
  });

  return {
    getSavedVolume() {
      return savedVolume;
    },
    setVolume(video: HTMLVideoElement, value: unknown) {
      const volume = normalizedVolume(value, savedVolume);
      video.volume = volume;
      video.muted = volume === 0;
      if (volume > 0) lastAudibleVolume = volume;
      persistVolume(volume);
      return soundState(video);
    },
    toggleMuted(video: HTMLVideoElement) {
      if (video.muted) {
        if (video.volume <= 0) {
          video.volume = lastAudibleVolume;
          persistVolume(lastAudibleVolume);
        }
        video.muted = false;
      } else {
        video.muted = true;
      }
      return soundState(video);
    },
    attach(video: HTMLVideoElement, options: VideoAttachmentOptions) {
      void options.id;
      video.volume = savedVolume;
      if (savedVolume === 0) video.muted = true;
      let frameRequest = 0;
      let frameMode: 'video' | 'animation' | null = null;
      let detached = false;
      let intersecting = true;

      const stopClock = () => {
        if (!frameRequest) return;
        if (frameMode === 'video' && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(frameRequest);
        } else if (frameMode === 'animation') {
          cancelFrame?.(frameRequest);
        }
        frameRequest = 0;
        frameMode = null;
      };

      const updateProgress = () => {
        frameRequest = 0;
        frameMode = null;
        if (detached) return;
        options.onProgress?.(video.currentTime);
        scheduleClock();
      };

      const scheduleClock = () => {
        if (detached || !intersecting || video.paused || frameRequest) return;
        if (typeof video.requestVideoFrameCallback === 'function') {
          frameMode = 'video';
          frameRequest = video.requestVideoFrameCallback(updateProgress);
          return;
        }
        if (requestFrame) {
          frameMode = 'animation';
          frameRequest = requestFrame(updateProgress);
        }
      };

      const onPlay = () => {
        const previousVideo = activeVideo;
        activeVideo = video;
        if (previousVideo && previousVideo !== video && !previousVideo.paused) {
          previousVideo.pause();
        }
        options.onPlayingChange?.(true);
        options.onProgress?.(video.currentTime);
        scheduleClock();
      };
      const onPause = () => {
        if (activeVideo === video) activeVideo = null;
        stopClock();
        options.onBufferingChange?.(false);
        options.onProgress?.(video.currentTime);
        options.onPlayingChange?.(false);
      };
      const onBuffering = () => options.onBufferingChange?.(true);
      const onPlaying = () => {
        options.onBufferingChange?.(false);
        options.onPlayingChange?.(true);
        scheduleClock();
      };
      const onCanPlay = () => options.onBufferingChange?.(false);
      const onError = () => {
        options.onBufferingChange?.(false);
        options.onError?.();
      };
      const onVolumeChange = () => options.onVolumeChange?.(soundState(video));
      const onVisibilityChange = () => {
        if (visibilityTarget?.hidden && !video.paused) video.pause();
      };

      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onPause);
      video.addEventListener('waiting', onBuffering);
      video.addEventListener('stalled', onBuffering);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
      video.addEventListener('volumechange', onVolumeChange);
      options.onVolumeChange?.(soundState(video));
      visibilityTarget?.addEventListener('visibilitychange', onVisibilityChange);
      const visibilityObserver = createIntersectionObserver?.(([entry]) => {
        if (!entry) return;
        intersecting = entry.isIntersecting;
        if (!intersecting) stopClock();
        else scheduleClock();
      });
      visibilityObserver?.observe(video);
      if (!video.paused) onPlay();

      return () => {
        if (detached) return;
        detached = true;
        if (activeVideo === video) activeVideo = null;
        stopClock();
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('ended', onPause);
        video.removeEventListener('waiting', onBuffering);
        video.removeEventListener('stalled', onBuffering);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        video.removeEventListener('volumechange', onVolumeChange);
        visibilityTarget?.removeEventListener('visibilitychange', onVisibilityChange);
        visibilityObserver?.disconnect();
      };
    },
  };
}

export type StableVideoPlayback = ReturnType<typeof createStableVideoPlayback>;

declare global {
  interface Window {
    __FISHERAI_VIDEO_PLAYBACK__?: StableVideoPlayback;
  }
}

export function installStableVideoPlayback(targetWindow: Window = window) {
  if (targetWindow.__FISHERAI_VIDEO_PLAYBACK__) {
    return targetWindow.__FISHERAI_VIDEO_PLAYBACK__;
  }
  const playback = createStableVideoPlayback();
  targetWindow.__FISHERAI_VIDEO_PLAYBACK__ = playback;
  targetWindow.dispatchEvent(new CustomEvent('fisherai:video-playback-ready'));
  return playback;
}
