import { GenerationWaiting } from './GenerationWaiting';
import type * as ReactTypes from 'react';
import {
  useCanvasVideoPlayback,
  type VideoRuntime,
  type VideoNode,
} from './useCanvasVideoPlayback';
import { currentVideoFrame, firstLastVideoFrames } from './videoSnapshots';
import type { MediaMetadata } from './generationMediaMetadata';
import { videoDisplayAspectRatio } from './mediaNodeSizing';
type Icon = ReactTypes.ComponentType<{
  size?: number;
  className?: string;
  fill?: string;
}>;
interface Components {
  MuteIcon: Icon;
  VolumeIcon: Icon;
  PlayIcon: Icon;
  PauseIcon: Icon;
  FramesIcon: Icon;
  SnapshotIcon: Icon;
  Spinner: Icon;
  ImageIcon: Icon;
  VideoIcon: Icon;
  Tooltip: ReactTypes.ComponentType<{
    text: string;
    children: ReactTypes.ReactNode;
  }>;
}
interface Props {
  data: VideoNode;
  selected?: boolean;
  inputUrl?: string;
  onSnapshot?(data: string): void | Promise<unknown>;
  onSnapshotFirstLast?(first: string, last: string): void | Promise<unknown>;
  onUpdate?(id: string, metadata: MediaMetadata): void;
}
export function CanvasVideoPlayer(
  React: VideoRuntime,
  { data, selected, inputUrl, onSnapshot, onSnapshotFirstLast, onUpdate }: Props,
  {
    MuteIcon,
    VolumeIcon,
    PlayIcon,
    PauseIcon,
    FramesIcon,
    SnapshotIcon,
    ImageIcon,
    VideoIcon,
    Tooltip,
  }: Components,
) {
  const playback = useCanvasVideoPlayback(React, data, onUpdate),
    {
      videoRef,
      playing,
      time,
      duration,
      muted,
      volume,
      buffering,
      error: playbackError,
    } = playback;
  const [hover, setHover] = React.useState(false),
    [snapshotBusy, setSnapshotBusy] = React.useState(false),
    [snapshotError, setSnapshotError] = React.useState('');
  const operationRef = React.useRef<AbortController | null>(null),
    ownerRef = React.useRef<object | null>(null);
  React.useEffect(() => {
    ownerRef.current = {};
    setSnapshotBusy(false);
    setSnapshotError('');
    return () => {
      ownerRef.current = null;
      operationRef.current?.abort();
      operationRef.current = null;
    };
  }, [data.id, data.projectId, data.resultUrl]);
  const isLoading = data.status === 'loading',
    hasResult = !!data.resultUrl;
  const togglePlay = (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    void playback.toggle();
  };
  const toggleSound = (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    playback.toggleMuted();
  };
  const changeVolume = (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    playback.changeVolume(Number(event.currentTarget.value));
  };
  const seek = (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    playback.seek(Number(event.currentTarget.value));
  };
  const formatTime = (value: number) => {
    const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
    return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`;
  };
  const frameStyle = (): ReactTypes.CSSProperties => {
    return {
      aspectRatio: `${videoDisplayAspectRatio(data)} / 1`,
    };
  };
  const capture = async (ends: boolean) => {
    const owner = ownerRef.current,
      video = videoRef.current;
    if (!owner || !video || !data.resultUrl || operationRef.current) return;
    const request = new AbortController();
    operationRef.current = request;
    setSnapshotBusy(true);
    setSnapshotError('');
    const valid = () => ownerRef.current === owner && !request.signal.aborted;
    try {
      if (ends) {
        const [first, last] = await firstLastVideoFrames(data.resultUrl, request.signal);
        if (valid()) await onSnapshotFirstLast?.(first, last);
      } else {
        const frame = currentVideoFrame(video);
        if (valid()) await onSnapshot?.(frame);
      }
    } catch (cause) {
      if (valid()) setSnapshotError(cause instanceof Error ? cause.message : '截图失败，请重试');
    } finally {
      if (operationRef.current === request) {
        operationRef.current = null;
        if (valid()) setSnapshotBusy(false);
      }
    }
  };
  const snapshot = (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    void capture(false);
  };
  const snapshotEnds = (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    void capture(true);
  };

  const content = (
    <div
      className={'w-full h-full rounded-lg overflow-hidden'}
      onMouseEnter={() => setHover(!0)}
      onMouseLeave={() => setHover(!1)}
    >
      {(hasResult || isLoading) && data.resultUrl ? (
        <div
          data-af-media-chrome
          className={'relative w-full h-full group/video-container'}
          style={frameStyle()}
        >
          <div data-fisherai-video-streaming={'true'} className={'absolute inset-0 bg-black'}>
            <video
              ref={videoRef}
              src={data.resultUrl}
              loop={false}
              muted={muted}
              playsInline={!0}
              preload={selected ? 'auto' : 'metadata'}
              className={'w-full h-full object-cover cursor-pointer pointer-events-auto'}
              onClick={(event) => {
                togglePlay(event);
              }}
            />
          </div>
          {buffering && !playbackError ? (
            <div
              data-fisherai-video-buffering={'true'}
              role={'status'}
              className={
                'pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/45 text-xs font-medium text-white/90'
              }
            >
              {'正在准备视频…'}
            </div>
          ) : null}
          {playbackError ? (
            <div
              data-fisherai-video-error={'true'}
              role={'alert'}
              className={
                'absolute inset-0 z-20 grid place-items-center bg-black/75 px-6 text-center text-xs font-medium text-rose-200'
              }
            >
              <div>
                <p>{playbackError}</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    playback.retry();
                  }}
                >
                  重新加载视频
                </button>
              </div>
            </div>
          ) : null}
          {hasResult && (
            <div
              data-fisherai-video-volume={'true'}
              className={`absolute top-2 left-2 z-30 flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-black/55 px-1.5 text-white backdrop-blur-sm transition-all duration-200 ${hover ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type={'button'}
                aria-label={muted ? '取消静音' : '静音'}
                onClick={toggleSound}
                className={'grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-white/10'}
              >
                {muted || volume === 0 ? <MuteIcon size={14} /> : <VolumeIcon size={14} />}
              </button>
              <input
                type={'range'}
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={changeVolume}
                aria-label={'视频音量'}
                aria-valuetext={Math.round(volume * 100) + '%'}
                className={'h-3 w-20 cursor-pointer accent-white'}
              />
              <span className={'w-7 text-right text-[10px] tabular-nums text-white/80'}>
                {Math.round(volume * 100) + '%'}
              </span>
            </div>
          )}
          {hasResult && (
            <div
              className={`absolute bottom-0 left-0 right-0 z-30 px-3 pb-2.5 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center gap-2.5 transition-all duration-300 ease-out ${hover ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                aria-label={playing ? '暂停视频' : '播放视频'}
                onClick={togglePlay}
                onPointerDown={(event) => event.stopPropagation()}
                className={'text-white hover:text-white/80 shrink-0 transition-colors z-50'}
              >
                {playing ? (
                  <PauseIcon size={16} fill={'currentColor'} />
                ) : (
                  <PlayIcon size={16} fill={'currentColor'} />
                )}
              </button>
              <span
                className={
                  'text-[11px] text-white/90 tabular-nums min-w-[34px] text-right shrink-0 leading-none'
                }
              >
                {formatTime(time)}
              </span>
              <div className={'flex-1 flex items-center'}>
                <div className={'relative w-full flex items-center h-4'}>
                  <div
                    className={
                      'absolute left-0 right-0 h-1 bg-white/20 rounded-full pointer-events-none'
                    }
                  >
                    <div
                      className={'absolute left-0 top-0 h-full bg-white rounded-full'}
                      style={{ width: `${(time / (duration || 1)) * 100}%` }}
                    />
                  </div>
                  <input
                    aria-label={'视频播放进度'}
                    type={'range'}
                    min={'0'}
                    max={duration || 0}
                    step={'0.01'}
                    value={time}
                    onChange={seek}
                    className={`relative w-full h-4 bg-transparent cursor-pointer appearance-none z-10
                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:w-3
                      [&::-webkit-slider-thumb]:h-3
                      [&::-webkit-slider-thumb]:rounded-full
                      [&::-webkit-slider-thumb]:bg-white
                      [&::-webkit-slider-thumb]:shadow-lg
                      [&::-webkit-slider-thumb]:cursor-pointer
                      [&::-webkit-slider-thumb]:transition-transform
                      [&::-webkit-slider-thumb]:hover:scale-125
                      [&::-moz-range-thumb]:w-3
                      [&::-moz-range-thumb]:h-3
                      [&::-moz-range-thumb]:rounded-full
                      [&::-moz-range-thumb]:bg-white
                      [&::-moz-range-thumb]:shadow-lg
                      [&::-moz-range-thumb]:border-0
                      [&::-moz-range-thumb]:cursor-pointer
                      [&::-moz-range-thumb]:transition-transform
                      [&::-moz-range-thumb]:hover:scale-125`}
                  />
                </div>
              </div>
              <span
                className={
                  'text-[11px] text-white/90 tabular-nums min-w-[34px] shrink-0 leading-none'
                }
              >
                {formatTime(duration)}
              </span>
              {onSnapshot && (
                <div className={'flex items-center gap-1.5 shrink-0'}>
                  {onSnapshotFirstLast && (
                    <Tooltip text={'截取首尾帧'}>
                      <button
                        aria-label="截取首尾帧"
                        disabled={snapshotBusy}
                        onClick={snapshotEnds}
                        className={'text-white hover:text-blue-400 transition-colors'}
                      >
                        <FramesIcon size={16} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip text={'截图'}>
                    <button
                      aria-label="视频截图"
                      disabled={snapshotBusy}
                      onClick={snapshot}
                      className={'text-white hover:text-blue-400 transition-colors'}
                    >
                      <SnapshotIcon size={16} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
          {isLoading && <GenerationWaiting operation="视频生成" />}
        </div>
      ) : (
        <div
          className={`relative w-full h-full bg-[var(--af-surface)] text-[var(--af-text)] flex flex-col items-center justify-center gap-3

          ${!selected || isLoading ? 'rounded-lg' : 'rounded-lg border border-dashed border-[var(--af-border-control)]'}`}
        >
          {inputUrl && (
            <div className={'absolute inset-0 z-0'}>
              <img
                src={inputUrl}
                alt={'Input Frame'}
                className={'w-full h-full object-cover opacity-30 blur-sm'}
                draggable={!1}
              />
              <div className="absolute inset-0 bg-[var(--af-surface)] opacity-70" />
              <div
                data-af-media-chrome
                className={
                  'absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-medium flex items-center gap-1'
                }
              >
                <ImageIcon size={10} />
                {'Input Frame'}
              </div>
            </div>
          )}
          {isLoading ? (
            <GenerationWaiting operation="视频生成" />
          ) : (
            <div className={'relative z-10 flex flex-col items-center gap-3'}>
              <div className={'text-[var(--af-text-muted)]'}>
                <VideoIcon size={40} />
              </div>
              {selected && inputUrl && (
                <div
                  className={
                    'absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--af-surface)] px-2 py-1 text-[var(--af-text-secondary)] text-sm font-medium'
                  }
                >
                  {'准备生成视频'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
  return (
    <div
      data-fisherai-video-player="true"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {content}
      {(snapshotError || snapshotBusy) && (
        <div
          role={snapshotError ? 'alert' : 'status'}
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 40,
            zIndex: 40,
            background: snapshotError ? 'var(--af-danger-bg)' : 'var(--af-surface-raised)',
            color: snapshotError ? 'var(--af-danger)' : 'var(--af-text)',
            fontSize: 12,
            padding: 8,
            borderRadius: 6,
          }}
        >
          {snapshotError || '正在截取视频画面…'}
        </div>
      )}
    </div>
  );
}
