import type * as ReactTypes from 'react';
import type { MediaMetadata } from './generationMediaMetadata';
import type { StableVideoPlayback } from './videoPlayback';
export type VideoRuntime = Pick<
  typeof ReactTypes,
  'createElement' | 'useRef' | 'useState' | 'useEffect' | 'useLayoutEffect' | 'useCallback'
>;
export interface VideoNode {
  id: string;
  projectId?: string;
  resultUrl?: string;
  resultAspectRatio?: string;
  aspectRatio?: string;
  status?: string;
  [key: string]: unknown;
}
export function useCanvasVideoPlayback(
  React: VideoRuntime,
  node: VideoNode,
  onUpdate?: (id: string, metadata: MediaMetadata) => void,
) {
  const videoRef = React.useRef<HTMLVideoElement>(null),
    currentRef = React.useRef({ node, onUpdate }),
    playbackRef = React.useRef<StableVideoPlayback | null>(null),
    ownerRef = React.useRef<object | null>(null);
  const [playing, setPlaying] = React.useState(false),
    [time, setTime] = React.useState(0),
    [duration, setDuration] = React.useState(0),
    [muted, setMuted] = React.useState(
      () => window.__FISHERAI_VIDEO_PLAYBACK__?.getSavedVolume() === 0,
    ),
    [volume, setVolume] = React.useState(
      () => window.__FISHERAI_VIDEO_PLAYBACK__?.getSavedVolume() ?? 1,
    ),
    [buffering, setBuffering] = React.useState(false),
    [error, setError] = React.useState('');
  React.useLayoutEffect(() => {
    currentRef.current = { node, onUpdate };
  });
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !node.resultUrl) return;
    const owner = {};
    ownerRef.current = owner;
    let active = true,
      attached = false,
      detach = () => {};
    const valid = () => active && ownerRef.current === owner;
    const sound = () => {
      if (valid()) {
        setMuted(video.muted);
        setVolume(video.volume);
      }
    };
    const metadata = () => {
      if (!valid()) return;
      setDuration(Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0);
      const current = currentRef.current;
      if (video.videoWidth && video.videoHeight && current.node.resultAspectRatio !== `${video.videoWidth}/${video.videoHeight}`)
        current.onUpdate?.(node.id, {
          resultAspectRatio: `${video.videoWidth}/${video.videoHeight}`,
        });
    };
    const progress = () => {
      if (valid()) setTime(Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0);
    };
    const play = () => {
      if (valid()) setPlaying(true);
    };
    const pause = () => {
      if (valid()) setPlaying(false);
    };
    const waiting = () => {
      if (valid()) setBuffering(true);
    };
    const ready = () => {
      if (valid()) {
        setBuffering(false);
        setError(video.videoWidth && video.videoHeight ? '' : '本机无法解码这个视频的画面，请使用 H.264（8 位）MP4 格式。');
      }
    };
    const failed = () => {
      if (valid()) {
        setBuffering(false);
        setError('视频读取失败，请重试');
      }
    };
    const listeners: Array<[string, () => void]> = [
      ['loadedmetadata', metadata],
      ['loadeddata', ready],
      ['timeupdate', progress],
      ['play', play],
      ['pause', pause],
      ['ended', pause],
      ['waiting', waiting],
      ['stalled', waiting],
      ['playing', ready],
      ['canplay', ready],
      ['error', failed],
      ['volumechange', sound],
    ];
    for (const [event, listener] of listeners) video.addEventListener(event, listener);
    const attach = () => {
      const playback = window.__FISHERAI_VIDEO_PLAYBACK__;
      if (!valid() || !playback || attached) return;
      attached = true;
      video.removeEventListener('timeupdate', progress);
      video.removeEventListener('play', play);
      video.removeEventListener('pause', pause);
      playbackRef.current = playback;
      detach = playback.attach(video, {
        id: node.id,
        onProgress: (value) => {
          if (valid()) setTime(Number.isFinite(value) ? Math.max(0, value) : 0);
        },
        onPlayingChange: (value) => {
          if (valid()) setPlaying(value);
        },
        onBufferingChange: (value) => {
          if (valid()) setBuffering(value);
        },
        onError: failed,
        onVolumeChange: sound,
      });
    };
    attach();
    window.addEventListener('fisherai:video-playback-ready', attach);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setBuffering(video.readyState < 3);
    setError('');
    video.load();
    if (video.readyState >= 1) metadata();
    return () => {
      active = false;
      ownerRef.current = null;
      playbackRef.current = null;
      window.removeEventListener('fisherai:video-playback-ready', attach);
      for (const [event, listener] of listeners) video.removeEventListener(event, listener);
      detach();
      video.pause();
    };
  }, [node.id, node.projectId, node.resultUrl]);
  const toggle = async () => {
    const video = videoRef.current,
      owner = ownerRef.current;
    if (!video || !owner) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
    } catch {
      if (ownerRef.current === owner) setError('无法播放视频，请重试');
    }
  };
  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playbackRef.current) {
      const sound = playbackRef.current.toggleMuted(video);
      setMuted(sound.muted);
      setVolume(sound.volume);
    } else {
      if (video.muted && video.volume === 0) video.volume = 1;
      video.muted = !video.muted;
      setMuted(video.muted);
      setVolume(video.volume);
    }
  };
  const changeVolume = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    if (playbackRef.current) {
      const sound = playbackRef.current.setVolume(video, next);
      setMuted(sound.muted);
      setVolume(sound.volume);
    } else {
      video.volume = next;
      video.muted = next === 0;
      setMuted(video.muted);
      setVolume(next);
    }
  };
  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(value) || !Number.isFinite(video.duration)) return;
    try {
      video.currentTime = Math.min(video.duration, Math.max(0, value));
      setTime(video.currentTime);
    } catch {
      setError('视频定位失败，请稍后重试');
    }
  };
  const retry = () => {
    const video = videoRef.current;
    if (video) {
      setError('');
      setBuffering(true);
      video.load();
    }
  };
  return {
    videoRef,
    playing,
    time,
    duration,
    muted,
    volume,
    buffering,
    error,
    toggle,
    toggleMuted,
    changeVolume,
    seek,
    retry,
  };
}
