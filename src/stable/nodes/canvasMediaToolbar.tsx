import type * as ReactTypes from 'react';
import { installMediaDownloadFileName } from '../media/mediaDownloadFileName';
import { createWorkflowManagerClient } from '../local/workflowManagerClient';
import { Grid2X2, Globe, Box } from 'lucide-react';
type Runtime = Pick<typeof ReactTypes, 'createElement' | 'Fragment' | 'useState' | 'useEffect'>;
interface MediaNode {
  id: string;
  type: string;
  resultUrl?: string;
  networkUrl?: string;
  projectId?: string;
  title?: string;
  [key: string]: unknown;
}
interface Props {
  data: MediaNode;
  selected?: boolean;
  showControls?: boolean;
  isDragging?: boolean;
  zoom: number;
  projectId?: string;
  onUpdate(id: string, patch: Partial<MediaNode>): void;
  onExpand?(url: string): void;
  onSaveAsset?(id: string): void;
  onAnnotate?(id: string): void;
  onCrop?(id: string, mode?: 'editor' | 'grid' | 'panorama' | 'angle' | 'panorama-generate'): void;
  onResizeImage?(id: string): void;
  onUpscaleImage?(id: string): void;
  fileInputRef?: ReactTypes.RefObject<HTMLInputElement | null>;
}
type Icon = ReactTypes.ComponentType<{ size: number; strokeWidth: number }>;
interface Components {
  Tooltip: ReactTypes.ComponentType<{ text: string; children: ReactTypes.ReactNode }>;
  annotate: Icon;
  crop: Icon;
  resize: Icon;
  replace: Icon;
  saveAsset: Icon;
  download: Icon;
  expand: Icon;
}
const buttonClass =
  'p-1.5 text-[var(--af-text-secondary)] hover:bg-[var(--af-selected)] hover:text-[var(--af-text)] rounded-full transition-colors';
const imageTypes = new Set(['Image', 'Upload Image']),
  videoTypes = new Set(['Video', 'Upload Video']),
  audioTypes = new Set(['Audio', 'Upload Audio']);
export function CanvasMediaToolbar(React: Runtime, props: Props, components: Components) {
  const [panoramaOpen, setPanoramaOpen] = React.useState(false);
  const [upscaleOpen, setUpscaleOpen] = React.useState(false);
  const [rhConfigured, setRhConfigured] = React.useState<boolean | null>(null);
  const canUpscale = Boolean(props.selected && props.showControls && props.onUpscaleImage && imageTypes.has(props.data.type) && props.data.resultUrl);
  React.useEffect(() => {
    setRhConfigured(null);
    if (!canUpscale) return;
    let active = true, revision = 0;
    const client = createWorkflowManagerClient();
    const refresh = () => {
      const request = ++revision;
      void client.getRunningHubCredentialStatus().then(
        status => { if (active && request === revision) setRhConfigured(status.cnConfigured); },
        () => { if (active && request === revision) setRhConfigured(null); },
      );
    };
    refresh();
    window.addEventListener('fisherai:model-sources-changed', refresh);
    return () => { active = false; window.removeEventListener('fisherai:model-sources-changed', refresh); };
  }, [canUpscale, props.data.id, upscaleOpen]);
  React.useEffect(() => {
    setUpscaleOpen(false);
    setPanoramaOpen(false);
  }, [props.data.id, props.selected]);
  const { data: node, selected, showControls, isDragging, zoom, fileInputRef } = props;
  const { Tooltip } = components;
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  const download = (event: ReactTypes.MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!node.resultUrl) return;
    let extension = '';
    try {
      extension =
        new URL(node.resultUrl, window.location.origin).pathname
          .match(/\.([a-z0-9]+)$/i)?.[1]
          .toLowerCase() || '';
    } catch {
      /* Data URLs use the media type below. */
    }
    extension ||= videoTypes.has(node.type) ? 'mp4' : audioTypes.has(node.type) ? 'mp3' : 'png';
    void installMediaDownloadFileName().download(
      node,
      node.resultUrl,
      extension,
      event.currentTarget,
    );
  };
  if (!selected || !showControls || isDragging || (!node.resultUrl && node.type !== 'Upload Video'))
    return null;
  const action = (
    label: string,
    Icon: Icon,
    onClick: ReactTypes.MouseEventHandler<HTMLButtonElement>,
  ) => (
    <Tooltip text={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        onPointerDown={stop}
        className={buttonClass}
      >
        <Icon size={14} strokeWidth={2.5} />
      </button>
    </Tooltip>
  );
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (
    <div
      data-fisherai-media-toolbar="true"
      onPointerDown={stop}
      onClick={stop}
      onKeyDown={stop}
      className="absolute bottom-[calc(100%+28px)] left-0 right-0 flex justify-center transition-opacity z-20 animate-in fade-in slide-in-from-bottom-1 duration-200"
      style={{
        transform: `scale(${Math.max(safeZoom, 0.8) / safeZoom})`,
        transformOrigin: 'bottom center',
      }}
    >
      <div className="flex items-center gap-2 px-2 py-1 bg-[var(--af-input)] rounded-full border border-[var(--af-border-control)] shadow-xl backdrop-blur-md">
        {imageTypes.has(node.type) && node.resultUrl && (
          <React.Fragment>
            {action('标注', components.annotate, () => props.onAnnotate?.(node.id))}
            {action('图片编辑', components.crop, () => props.onCrop?.(node.id, 'editor'))}
            {action('宫格裁剪', Grid2X2, () => props.onCrop?.(node.id, 'grid'))}
            <div
              className="relative"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPanoramaOpen(false);
              }}
            >
              {action('全景图', Globe, () => setPanoramaOpen(!panoramaOpen))}
              {panoramaOpen && (
                <div
                  role="menu"
                  aria-label="全景图"
                  className="absolute top-full mt-3 left-1/2 -translate-x-1/2 w-40 p-2 rounded-xl border border-[var(--af-border-control)] bg-[var(--af-input)] shadow-xl"
                >
                  {(
                    [
                      ['panorama-generate', '生成全景图'],
                      ['panorama', '进入全景'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      role="menuitem"
                      className="block w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-[var(--af-selected)] text-[var(--af-text)]"
                      onClick={() => {
                        setPanoramaOpen(false);
                        props.onCrop?.(node.id, mode);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {action('角度', Box, () => props.onCrop?.(node.id, 'angle'))}
            {action('尺寸', components.resize, () => props.onResizeImage?.(node.id))}
            {props.onUpscaleImage && !node.uploadPending && node.status !== 'loading' && (
              <div
                className="relative"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setUpscaleOpen(false);
                    event.stopPropagation();
                  }
                }}
              >
                <Tooltip text={rhConfigured === false ? "AI 高清放大 · SeedVR2（需绑定 RunningHub 国内站 API Key）" : "AI 高清放大 · SeedVR2"}>
                  <button
                    type="button"
                    aria-label="AI 高清放大"
                    aria-expanded={upscaleOpen}
                    onPointerDown={stop}
                    onClick={() => setUpscaleOpen(!upscaleOpen)}
                    className={`${buttonClass} text-xs font-semibold px-2`}
                  >
                    HD
                  </button>
                </Tooltip>
                {upscaleOpen && (
                  <div
                    role="dialog"
                    aria-label="SeedVR2 高清放大"
                    onPointerDown={stop}
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-72 p-4 rounded-xl border border-[var(--af-border-control)] bg-[var(--af-input)] text-[var(--af-text)] shadow-xl z-30 animate-in fade-in duration-200 motion-reduce:animate-none"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <strong>SeedVR2 高清放大</strong>
                      <button
                        type="button"
                        aria-label="关闭高清放大"
                        onClick={() => setUpscaleOpen(false)}
                        className={buttonClass}
                      >
                        ×
                      </button>
                    </div>
                    {rhConfigured === false && <p className="text-xs leading-6 text-[var(--af-text-secondary)]">请先在设置中绑定 RunningHub 国内站 API Key。</p>}
                    <p className="text-xs leading-6 text-[var(--af-text-secondary)]">
                      使用云端应用默认放大设置，原图保留，输出另建卡片。
                    </p>
                    <p className="text-xs leading-6 text-[var(--af-text-secondary)] mt-2">
                      将上传此图至 RunningHub 国内站，使用 Standard 24GB 和你的 Key 计费；费用以 RH
                      账单为准。需要等待云端处理。
                    </p>
                    <button
                      type="button"
                      className="w-full mt-3 py-2 rounded-lg bg-[var(--af-primary)] text-[var(--af-on-primary)] font-semibold text-sm hover:opacity-90"
                      onClick={() => {
                        setUpscaleOpen(false);
                        props.onUpscaleImage?.(node.id);
                      }}
                    >
                      确认并开始放大
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="w-px h-3 bg-[var(--af-selected)] mx-0.5" />
          </React.Fragment>
        )}
        {node.type.startsWith('Upload ') &&
          fileInputRef &&
          action('替换素材', components.replace, () => fileInputRef.current?.click())}
        {(imageTypes.has(node.type) || videoTypes.has(node.type) || audioTypes.has(node.type)) &&
          node.resultUrl &&
          !node.uploadPending &&
          props.onSaveAsset &&
          action('保存到资产', components.saveAsset, () => props.onSaveAsset?.(node.id))}
        {node.resultUrl && action('下载', components.download, download)}
        {node.resultUrl &&
          !audioTypes.has(node.type) &&
          action('全屏查看', components.expand, () => props.onExpand?.(node.resultUrl!))}
      </div>
    </div>
  );
}
