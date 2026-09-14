import { useRef } from 'react';

export function AgentAttachmentPreview({ type, url, index }: { type: 'image' | 'video' | 'audio'; url: string; index: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = `${type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片'}附件 ${index}`;
  return <>
    <button type="button" aria-label={`预览${label}`} className="w-full h-full" onClick={() => dialog.current?.showModal()}>
      {type === 'image' ? <img src={url} alt={label} className="w-full h-full object-cover" />
        : type === 'video' ? <video src={url} muted preload="metadata" className="w-full h-full object-cover" />
          : <span className="text-xl text-[var(--af-media-text)]" aria-hidden="true">♪</span>}
    </button>
    <dialog ref={dialog} aria-label={label} className="m-auto w-[min(640px,90vw)] max-h-[85vh] rounded-xl border border-[var(--af-border-control)] bg-[var(--af-surface-raised)] p-4 text-[var(--af-text)] backdrop:bg-[var(--af-overlay)]"
      onClose={() => { dialog.current?.querySelector<HTMLMediaElement>('video, audio')?.pause(); }}>
      <div className="mb-3 flex justify-between gap-3 text-sm"><span>{label}</span><button type="button" aria-label="关闭附件预览" className="rounded px-2 py-1 text-[var(--af-text-secondary)] hover:bg-[var(--af-hover)] hover:text-[var(--af-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)]" onClick={() => dialog.current?.close()}>关闭</button></div>
      {type === 'image' ? <img src={url} alt={`${label}完整预览`} loading="lazy" className="max-h-[65vh] w-full object-contain bg-[var(--af-media-bg)]" />
        : type === 'video' ? <video src={url} controls preload="none" className="max-h-[65vh] w-full bg-[var(--af-media-bg)]" />
          : <audio src={url} controls preload="none" className="w-full" />}
    </dialog>
  </>;
}
