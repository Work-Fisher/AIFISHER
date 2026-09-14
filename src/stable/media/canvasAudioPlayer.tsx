import type * as ReactTypes from 'react';
import { createAudioWaveform, type AudioWaveform, type AudioRange } from './audioWaveform';

type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'Fragment' | 'useState' | 'useRef' | 'useEffect'
>;
type Icon = ReactTypes.ComponentType<{
  size?: number;
  className?: string;
  fill?: string;
  strokeWidth?: number;
}>;
interface AudioNode {
  id: string;
  projectId?: string;
  resultUrl?: string;
  status?: string;
  type?: string;
  uploadPending?: boolean;
}
interface Props {
  data: AudioNode;
  selected?: boolean;
  onAudioTrim?(id: string, start: number, end: number): unknown | Promise<unknown>;
}
interface Components {
  PlayIcon: Icon;
  PauseIcon: Icon;
  TrimIcon: Icon;
  ConfirmIcon: Icon;
  Spinner: Icon;
  AudioIcon: Icon;
  Tooltip: ReactTypes.ComponentType<{
    text: string;
    position?: string;
    children: ReactTypes.ReactNode;
  }>;
  createWaveform?: typeof createAudioWaveform;
}
function formatAudioTime(seconds: number) {
  const ms = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const hours = Math.floor(ms / 3600000);
  return (
    (hours ? String(hours).padStart(2, '0') + ':' : '') +
    String(Math.floor(ms / 60000) % 60).padStart(2, '0') +
    ':' +
    String(Math.floor(ms / 1000) % 60).padStart(2, '0') +
    '.' +
    String(ms % 1000).padStart(3, '0')
  );
}
export function CanvasAudioPlayer(
  React: Runtime,
  { data, selected, onAudioTrim }: Props,
  {
    PlayIcon,
    PauseIcon,
    TrimIcon,
    ConfirmIcon,
    Spinner,
    AudioIcon,
    Tooltip,
    createWaveform = createAudioWaveform,
  }: Components,
) {
  const root = React.useRef<HTMLDivElement>(null),
    container = React.useRef<HTMLDivElement>(null);
  const player = React.useRef<AudioWaveform | null>(null),
    owner = React.useRef<object | null>(null);
  const trimPending = React.useRef(false);
  const [ready, setReady] = React.useState(false),
    [playing, setPlaying] = React.useState(false);
  const [editing, setEditing] = React.useState(false),
    [trimming, setTrimming] = React.useState(false);
  const [range, setRange] = React.useState<AudioRange | null>(null),
    [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0),
    [error, setError] = React.useState('');
  const [loadFailed, setLoadFailed] = React.useState(false),
    [attempt, setAttempt] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const token = {};
    owner.current = token;
    setReady(false);
    setPlaying(false);
    setEditing(false);
    setTrimming(false);
    setRange(null);
    setTime(0);
    setDuration(0);
    setError('');
    setLoadFailed(false);
    setSaving(false);
    trimPending.current = false;
    let instance: AudioWaveform | undefined;
    let failed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const active = () => owner.current === token && !failed;
    const fail = () => {
      if (!active()) return;
      failed = true;
      clearTimeout(timeout);
      setReady(false);
      setPlaying(false);
      setLoadFailed(true);
      setError('音频加载失败，请重试');
      instance?.destroy();
      player.current = null;
    };
    if (data.resultUrl && container.current) {
      timeout = setTimeout(fail, 30000);
      try {
        instance = createWaveform(container.current, data.resultUrl, {
          ready(value) {
            if (active()) {
              clearTimeout(timeout);
              setDuration(value);
              setReady(true);
            }
          },
          time(value) {
            if (active()) setTime(value);
          },
          playing(value) {
            if (active()) setPlaying(value);
          },
          range(value) {
            if (active()) setRange(value);
          },
          error: fail,
        });
        if (failed) instance.destroy();
        else player.current = instance;
      } catch {
        fail();
      }
    }
    return () => {
      owner.current = null;
      clearTimeout(timeout);
      instance?.destroy();
      player.current = null;
    };
  }, [data.id, data.projectId, data.resultUrl, attempt, createWaveform]);
  React.useEffect(() => {
    if (ready) player.current?.setEditing(editing, trimming);
  }, [ready, editing, trimming]);
  React.useEffect(() => {
    const visibility = () => {
      if (document.hidden) player.current?.pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  React.useEffect(() => {
    if (!editing) return;
    const outside = (event: MouseEvent) => {
      if (!trimPending.current && !root.current?.contains(event.target as Node)) {
        setEditing(false);
        setTrimming(false);
      }
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [editing]);
  const play = async (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    const token = owner.current;
    setError('');
    try {
      await player.current?.playPause();
    } catch {
      if (owner.current === token) setError('无法播放音频，请再次点击播放');
    }
  };
  const trim = async (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    if (!range || !onAudioTrim || trimPending.current || !canTrim || !(range.end > range.start))
      return;
    const token = owner.current;
    trimPending.current = true;
    setSaving(true);
    setError('');
    player.current?.pause();
    try {
      const result = await onAudioTrim(data.id, range.start, range.end);
      if (owner.current !== token) return;
      if (result === false) setError('裁切未完成，已保留选区，请重试');
      else {
        setTrimming(false);
        setEditing(false);
      }
    } catch {
      if (owner.current === token) setError('裁切失败，已保留选区，请重试');
    } finally {
      if (owner.current === token) {
        trimPending.current = false;
        setSaving(false);
      }
    }
  };
  const loading = data.status === 'loading';
  const canTrim =
    !loading && !data.uploadPending && !!data.resultUrl && !/^(blob|data):/i.test(data.resultUrl);
  return (
    <div
      ref={root}
      data-fisherai-audio-player={data.id}
      className="w-full h-full rounded-lg overflow-hidden relative"
    >
      <style>
        {
          '[data-fisherai-audio-player] ::part(region-handle){display:none!important}[data-fisherai-audio-player] ::part(region){border:0!important;box-shadow:none!important;outline:none!important}'
        }
      </style>
      {data.resultUrl ? (
        <div className="relative w-full h-full bg-[var(--af-surface)] text-[var(--af-text)] group/audio flex flex-col">
          <div
            style={{ pointerEvents: saving ? 'none' : undefined }}
            className={`flex-1 min-h-0 flex items-center px-4 pt-0 transition-colors ${trimming ? 'bg-blue-500/5 cursor-crosshair' : editing ? 'cursor-pointer' : 'cursor-grab'}`}
            onPointerDown={(event) => {
              if (editing) event.stopPropagation();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (!saving) setEditing(true);
            }}
          >
            <div ref={container} className="w-full" aria-label="音频波形" />
          </div>
          {ready && (
            <div className="h-8 px-3 grid grid-cols-[1fr_auto_1fr] items-center bg-[var(--af-surface-raised)] border-t border-[var(--af-border)]">
              <div className="justify-self-start text-[10px] text-[var(--af-text-secondary)] font-mono tabular-nums">
                {formatAudioTime(time)} / {formatAudioTime(duration)}
              </div>
              <div className="justify-self-center flex items-center gap-2">
                <Tooltip text={playing ? '暂停' : '播放'} position="top">
                  <button
                    aria-label={playing ? '暂停音频' : '播放音频'}
                    onClick={play}
                    className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--af-primary)] hover:opacity-90 text-[var(--af-on-primary)] transition-all duration-200 active:scale-95"
                  >
                    {playing ? (
                      <PauseIcon size={10} fill="currentColor" />
                    ) : (
                      <PlayIcon size={10} fill="currentColor" className="ml-0.5" />
                    )}
                  </button>
                </Tooltip>
                <Tooltip text={trimming ? '取消裁切' : '进入裁切'} position="top">
                  <button
                    aria-label={trimming ? '取消裁切' : '进入裁切'}
                    disabled={saving || !onAudioTrim || !canTrim}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (saving || !canTrim) return;
                      setEditing(true);
                      setTrimming(!trimming);
                      setError('');
                    }}
                    className={`flex items-center justify-center w-5 h-5 rounded-full transition-all duration-200 active:scale-95 ${trimming ? 'bg-[var(--af-selected)] text-[var(--af-on-selected)]' : 'bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] text-[var(--af-text-secondary)] hover:text-[var(--af-text)]'}`}
                  >
                    <TrimIcon size={10} />
                  </button>
                </Tooltip>
              </div>
              <div className="justify-self-end flex items-center gap-2">
                {trimming && (
                  <Tooltip text={range ? '确认裁切' : '请先框选范围'} position="top">
                    <button
                      aria-label="确认裁切"
                      onClick={trim}
                      disabled={!range || saving || !canTrim || !(range.end > range.start)}
                      className={`flex items-center justify-center w-5 h-5 rounded-full transition-all duration-200 ${range ? 'bg-[var(--af-primary)] text-[var(--af-on-primary)] hover:opacity-90 active:scale-95 shadow-lg' : 'bg-[var(--af-surface-raised)] text-[var(--af-text-muted)] cursor-not-allowed opacity-70'}`}
                    >
                      {saving ? (
                        <Spinner size={10} className="animate-spin" />
                      ) : (
                        <ConfirmIcon size={10} strokeWidth={3} />
                      )}
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="text-[var(--af-danger)] bg-[var(--af-danger-bg)] text-xs px-3 py-1"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {error}
              {loadFailed && (
                <button
                  className="ml-2 underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    setAttempt((value) => value + 1);
                  }}
                >
                  重试加载
                </button>
              )}
            </div>
          )}
          {((!ready && !loadFailed) || loading) && (
            <div
              className="absolute inset-0 bg-[var(--af-surface)] opacity-80 flex items-center justify-center"
              style={{ pointerEvents: 'none' }}
            >
              <Spinner size={24} className="animate-spin text-[var(--af-info)]" />
            </div>
          )}
        </div>
      ) : (
        <div
          className={`relative w-full h-full bg-[var(--af-surface)] flex flex-col items-center justify-center gap-3 rounded-lg ${selected ? 'border border-dashed border-[var(--af-border-control)]' : ''}`}
        >
          {loading ? (
            <Spinner size={24} className="animate-spin text-[var(--af-info)]" />
          ) : (
            <>
              <AudioIcon size={32} className="text-[var(--af-text-muted)]" />
              {(data.type === 'Upload Audio' || data.type === 'upload-audio') && (
                <span className="text-[10px] font-medium text-[var(--af-text-secondary)]">
                  选择音频文件
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
