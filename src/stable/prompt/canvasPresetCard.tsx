import type * as ReactTypes from 'react';
import {
  promptPreviewIsVideo,
  type PromptRuntime,
  type PromptIcons,
  type PresetCardProps,
} from './promptComponents';
export function CanvasPresetCard(
  React: PromptRuntime,
  { item, isSelected, onClick, onMouseEnter, onDelete }: PresetCardProps,
  { ImageIcon, DeleteIcon }: Pick<PromptIcons, 'ImageIcon' | 'DeleteIcon'>,
) {
  const videoRef = React.useRef<HTMLVideoElement>(null),
    alive = React.useRef(false),
    hovering = React.useRef(false),
    inFlight = React.useRef(false);
  const preview = typeof item.preview === 'string' ? item.preview : '',
    isVideo = promptPreviewIsVideo(preview);
  const [confirming, setConfirming] = React.useState(false),
    [deleting, setDeleting] = React.useState(false);
  React.useEffect(() => {
    alive.current = true;
    const video = videoRef.current;
    return () => {
      alive.current = false;
      hovering.current = false;
      video?.pause();
    };
  }, [preview]);
  const enter = () => {
    hovering.current = true;
    onMouseEnter();
    const video = videoRef.current;
    if (isVideo && video)
      void video
        .play()
        .then(() => {
          if (!hovering.current || !alive.current) video.pause();
        })
        .catch(() => {});
  };
  const leave = () => {
    hovering.current = false;
    if (!inFlight.current) setConfirming(false);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  };
  const confirm = (event: ReactTypes.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setConfirming(true);
  };
  const cancel = (event: ReactTypes.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!inFlight.current) setConfirming(false);
  };
  const remove = async (event: ReactTypes.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      const done = await onDelete();
      if (alive.current && done) setConfirming(false);
    } finally {
      inFlight.current = false;
      if (alive.current) setDeleting(false);
    }
  };

  return (
    <div
      data-selected={isSelected}
      onMouseEnter={enter}
      onMouseLeave={leave}
      className={`flex flex-col overflow-hidden rounded-xl border transition-all duration-200 group relative select-none ${isSelected ? 'border-[var(--af-info)] bg-[var(--af-info-bg)] shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-[var(--af-border)] bg-[var(--af-input)] hover:border-[var(--af-border-control)] hover:bg-[var(--af-surface-raised)]'}`}
    >
      <button
        aria-label={item.title}
        disabled={deleting}
        onClick={onClick}
        className={'w-full text-left'}
        draggable={!1}
      >
        <div
          className={'aspect-video w-full overflow-hidden bg-[var(--af-input)] relative'}
          draggable={!1}
        >
          {preview ? (
            isVideo ? (
              <video
                ref={videoRef}
                src={preview}
                className={'w-full h-full object-cover'}
                muted={!0}
                loop={!0}
                playsInline={!0}
                draggable={!1}
              />
            ) : (
              <img src={preview} className={'w-full h-full object-cover'} alt={''} draggable={!1} />
            )
          ) : (
            <div
              className={
                'flex h-full w-full items-center justify-center bg-[var(--af-input)] text-[var(--af-text-muted)]'
              }
              draggable={!1}
            >
              <div className={'flex flex-col items-center gap-1'}>
                <ImageIcon size={16} />
                <span className={'text-[10px]'}>{'无缩略图'}</span>
              </div>
            </div>
          )}
        </div>
        <div className={'px-3 py-2 text-center'}>
          <span
            className={`text-[11px] font-bold truncate block ${isSelected ? 'text-[var(--af-info)]' : 'text-[var(--af-text-secondary)] group-hover:text-[var(--af-text)]'}`}
          >
            {item.title}
          </span>
        </div>
      </button>
      {!confirming && (
        <button
          aria-label={`删除预设 ${item.title}`}
          onClick={confirm}
          className={
            'absolute top-1.5 right-1.5 p-1.5 bg-[var(--af-surface)] hover:bg-[var(--af-danger-bg)] rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10'
          }
        >
          <DeleteIcon size={12} className={'text-[var(--af-text)]'} />
        </button>
      )}
      {confirming && (
        <div
          data-af-media-chrome="true"
          className={
            'absolute inset-0 flex flex-col items-center justify-center gap-2 z-20 animate-in fade-in duration-200'
          }
          style={{ background: 'color-mix(in srgb, var(--af-media-bg) 85%, transparent)' }}
          onClick={(event) => event.stopPropagation()}
        >
          <span className={'text-[var(--af-media-text)] text-[10px] font-bold'}>{'删除?'}</span>
          <div className={'flex gap-2'}>
            <button
              className={
                'px-2.5 py-1 bg-[var(--af-danger-bg)] hover:bg-[var(--af-danger-bg)] text-[var(--af-danger)] text-[10px] font-bold rounded-md transition-colors'
              }
              disabled={deleting}
              onClick={remove}
            >
              {deleting ? '删除中…' : '是'}
            </button>
            <button
              className={
                'px-2.5 py-1 bg-[var(--af-hover)] hover:bg-[var(--af-hover)] text-[var(--af-text)] text-[10px] font-bold rounded-md transition-colors'
              }
              disabled={deleting}
              onClick={cancel}
            >
              {'否'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
