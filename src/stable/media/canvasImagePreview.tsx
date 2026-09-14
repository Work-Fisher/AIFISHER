import { GenerationWaiting } from './GenerationWaiting';
import type * as ReactTypes from 'react';
import { nearestAspectRatio } from './generationMediaMetadata';
import { installMediaDownloadFileName } from './mediaDownloadFileName';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useRef' | 'useState' | 'useLayoutEffect' | 'useSyncExternalStore'
>;
interface ImageNode {
  id: string;
  projectId?: string;
  type?: string;
  title?: string;
  status?: string;
  resultUrl?: string;
  resultUrls?: string[];
  resultAspectRatio?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  currentResultCount?: number;
  [key: string]: unknown;
}
interface Props {
  data: ImageNode;
  selected?: boolean;
  renderHeader?(historyControl: ReactTypes.ReactNode): ReactTypes.ReactNode;
  onUpload?(id: string, file: File): void | Promise<unknown>;
  onUpdate?(id: string, patch: Partial<ImageNode>): void;
}
type Icon = ReactTypes.ComponentType<{ size: number }>;
interface Components {
  DownloadIcon: Icon;
  ImageIcon: Icon;
  nodeWidth(node: ImageNode): number;
  nodeHeight(node: ImageNode): number;
}
const subscribeNone = () => () => {};
const zero = () => 0;
export function CanvasImagePreview(
  React: Runtime,
  { data: node, selected, onUpload, onUpdate, renderHeader }: Props,
  { DownloadIcon, ImageIcon, nodeWidth, nodeHeight }: Components,
) {
  const scheduler = window.__FISHERAI_GENERATION_SCHEDULER__;
  React.useSyncExternalStore(
    scheduler?.subscribe || subscribeNone,
    scheduler?.version || zero,
    zero,
  );
  const busy = node.status === 'loading' || !!scheduler?.isInFlight(node.id);
  const hasResult = !!node.resultUrl;
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const current = React.useRef({ node, onUpdate });
  React.useLayoutEffect(() => {
    current.current = { node, onUpdate };
  });
  React.useLayoutEffect(() => {
    setExpanded(false);
  }, [node.id, node.projectId, node.resultUrl]);
  const urls = node.resultUrls?.length ? node.resultUrls : node.resultUrl ? [node.resultUrl] : [];
  const multiple = urls.length > 1;
  const currentCount =
    node.currentResultCount == null || !Number.isFinite(Number(node.currentResultCount))
      ? null
      : Math.max(0, Math.min(urls.length, Number(node.currentResultCount)));
  const indicatorLabel =
    currentCount == null
      ? `历史 ${urls.length}`
      : currentCount === urls.length
        ? `本次 ${currentCount}`
        : `本次 ${currentCount} · 历史 ${urls.length}`;
  const frameStyle = (): ReactTypes.CSSProperties => {
    const ratio = (hasResult && node.resultAspectRatio) || node.aspectRatio || '16:9';
    return {
      aspectRatio: /^\d+(?:\.\d+)?[/:]\d+(?:\.\d+)?$/.test(ratio)
        ? ratio.replace(':', '/')
        : '16/9',
    };
  };
  const upload = (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file && !busy) void onUpload?.(node.id, file);
  };
  const metadata = (event: ReactTypes.SyntheticEvent<HTMLImageElement>) => {
    const latest = current.current;
    if (
      latest.node.id !== node.id ||
      latest.node.projectId !== node.projectId ||
      latest.node.resultUrl !== node.resultUrl ||
      latest.node.resultAspectRatio
    )
      return;
    const image = event.currentTarget;
    if (image.naturalWidth && image.naturalHeight)
      latest.onUpdate?.(node.id, {
        resultAspectRatio: `${image.naturalWidth}/${image.naturalHeight}`,
        aspectRatio: nearestAspectRatio(image.naturalWidth, image.naturalHeight),
      });
  };
  const selectMain = (url: string, image?: HTMLImageElement | null) => {
    const latest = current.current;
    if (
      latest.node.id !== node.id ||
      latest.node.projectId !== node.projectId ||
      busy ||
      !latest.onUpdate
    )
      return;
    const list = [...(latest.node.resultUrls || [])],
      index = list.indexOf(url);
    if (index < 0) return;
    [list[0], list[index]] = [list[index], list[0]];
    const ratio =
      image?.naturalWidth && image.naturalHeight
        ? `${image.naturalWidth}/${image.naturalHeight}`
        : undefined;
    latest.onUpdate(node.id, { resultUrl: url, resultUrls: list, resultAspectRatio: ratio });
    setExpanded(false);
  };
  const download = (url: string, button: HTMLButtonElement) => {
    const adapter = window.__FISHERAI_MEDIA_DOWNLOAD__ || installMediaDownloadFileName();
    void adapter.download(node, url, 'png', button, adapter.fileName(node, url, 'png'));
  };
  const optionStyle = (index: number): ReactTypes.CSSProperties => {
    const width = nodeWidth(node),
      height = nodeHeight(node);
    const ring = Math.floor(index / 4) + 1;
    const offsets = [
      { left: (width + 16) * ring, top: 0 },
      { left: 0, top: -(height + 16) * ring },
      { left: (width + 16) * ring, top: -(height + 16) * ring },
      { left: -(width + 16) * ring, top: 0 },
    ];
    return { width: `${width}px`, height: `${height}px`, ...offsets[index % 4], zIndex: 50 };
  };
  const exposureOverlay = () => (
    <GenerationWaiting operation={node.mediaOperation === 'seedvr2-upscale' ? 'SeedVR2 高清放大' : '图片生成'} />
  );

  const historyControl =
    multiple && hasResult && !busy ? (
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(!expanded);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') setExpanded(false);
        }}
        data-fisherai-result-stack-indicator="true"
        aria-label={indicatorLabel}
        title={indicatorLabel}
        aria-expanded={expanded}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--af-surface)] text-[var(--af-text-secondary)] hover:bg-[var(--af-hover)] hover:text-[var(--af-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--af-focus)] transition-colors"
      >
        <span>历史 {urls.length}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    ) : null;
  return (
    <div className={'w-full h-full relative'} data-fisherai-image-preview="true">
      {renderHeader ? (
        renderHeader(historyControl)
      ) : (
        <div className="absolute right-0" style={{ bottom: 'calc(100% + 4px)' }}>
          {historyControl}
        </div>
      )}
      {multiple &&
        !expanded &&
        urls.slice(1, 4).map((_, S) => {
          const C = S + 1,
            N = C * 2.5,
            A = 10 - C;
          return (
            <div
              className={
                'absolute inset-0 rounded-lg border border-[var(--af-border-control)] origin-bottom-left shadow-2xl'
              }
              style={{
                transform: `rotate(${N}deg)`,
                backgroundColor: 'var(--af-surface-raised)',
                zIndex: A,
              }}
              key={S}
            />
          );
        })}
      <div className={'w-full h-full rounded-lg overflow-visible relative z-10'}>
        {onUpload && (
          <input
            ref={fileInput}
            type={'file'}
            accept={'.jpg,.jpeg,.png,.webp,.bmp'}
            className={'hidden'}
            onChange={upload}
          />
        )}
        {(hasResult || busy) && node.resultUrl ? (
          <div className={'relative w-full group/image'} style={frameStyle()}>
            <div
              data-af-media-chrome
              className={
                'absolute inset-0 rounded-lg overflow-hidden bg-[var(--af-media-bg)] shadow-xl'
              }
            >
              <img
                src={node.resultUrl}
                key={node.resultUrl}
                onLoad={metadata}
                alt={'生成结果'}
                className={'w-full h-full object-cover pointer-events-none'}
              />
            </div>
            {expanded &&
              urls.slice(1).map((_, S) => (
                <div
                  className={
                    'group/item absolute bg-[var(--af-media-bg)] rounded-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95'
                  }
                  style={optionStyle(S)}
                  data-fisherai-image-history={_}
                  onPointerDown={(C) => C.stopPropagation()}
                  onClick={(C) => C.stopPropagation()}
                  key={_}
                >
                  <img
                    src={_}
                    alt={`选项 ${S + 1}`}
                    className={
                      'w-full h-full object-contain transition-[transform,opacity] duration-300 group-hover/item:scale-110 opacity-100'
                    }
                    loading={'lazy'}
                  />
                  <div
                    data-af-media-chrome
                    className={
                      'absolute top-2 right-2 flex gap-2 opacity-0 group-hover/item:opacity-100 transition-opacity duration-300'
                    }
                  >
                    <button
                      onClick={(S) => download(_, S.currentTarget)}
                      aria-label={`下载历史图片 ${S + 1}`}
                      className={
                        'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-black/50 text-white shadow-xl hover:bg-black rounded-full size-9 flex items-center justify-center cursor-pointer transition-all backdrop-blur-md border border-white/20'
                      }
                    >
                      <DownloadIcon size={16} />
                    </button>
                    <button
                      onClick={(event) =>
                        selectMain(
                          _,
                          event.currentTarget
                            .closest('[data-fisherai-image-history]')
                            ?.querySelector('img'),
                        )
                      }
                      disabled={busy}
                      className={
                        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-black/50 text-white shadow-xl hover:bg-black h-9 px-4 py-2 cursor-pointer transition-all backdrop-blur-md border border-white/20'
                      }
                    >
                      {'设为主图'}
                    </button>
                  </div>
                </div>
              ))}
            {busy && exposureOverlay()}
          </div>
        ) : (
          <div
            className={`relative w-full h-full bg-[var(--af-surface)] flex flex-col items-center justify-center gap-3

              ${!selected || busy ? 'rounded-lg' : 'rounded-lg border border-dashed border-[var(--af-border-control)]'}`}
          >
            {busy ? (
              exposureOverlay()
            ) : (
              <div className={'relative z-10 flex flex-col items-center gap-3'}>
                <div className={'text-[var(--af-text-muted)]'}>
                  <ImageIcon size={40} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
