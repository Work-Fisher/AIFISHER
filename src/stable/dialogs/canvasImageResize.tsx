import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';

type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useRef' | 'useEffect' | 'useLayoutEffect'
>;
import { resizeDimensions, resizeLimit, type Size, type Mode } from './imageResizeGeometry';
interface ImageNode {
  id: string;
  resultUrl?: string;
  title?: string;
}
interface Props {
  node?: ImageNode;
  projectId?: string;
  onSave(id: string, data: string, dimensions: Size): Promise<unknown> | unknown;
  onClose(): void;
}
interface Icons {
  Close: CanvasComponent;
  Save: CanvasComponent;
  Spinner: CanvasComponent;
}
const inputClass =
  'h-7 px-1.5 rounded-md bg-[var(--af-input)] border border-[var(--af-border-control)] text-[10px] text-[var(--af-text)] outline-none focus:border-[var(--af-info)] text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
/** Keeps the compact original editor; save completion belongs to this editor opening. */
export function CanvasImageResize(
  React: Runtime,
  { node, onSave, onClose, projectId }: Props,
  { Close, Save, Spinner }: Icons,
) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const sessionRef = React.useRef(0);
  const savingRef = React.useRef(false);
  const closeRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const [original, setOriginal] = React.useState<Size | null>(null);
  const [mode, setMode] = React.useState<Mode>('scale');
  const [scale, setScale] = React.useState('1');
  const [width, setWidth] = React.useState('');
  const [height, setHeight] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [viewport, setViewport] = React.useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const id = node?.id,
    url = node?.resultUrl;
  React.useEffect(() => {
    const session = ++sessionRef.current;
    savingRef.current = false;
    imageRef.current = null;
    setSaving(false);
    setOriginal(null);
    setMode('scale');
    setScale('1');
    setWidth('');
    setHeight('');
    setError('');
    if (!id || !rootRef.current) return;
    const release = activateModal(rootRef.current, () => closeRef.current());
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const fail = () => {
      if (sessionRef.current === session) setError('图片加载失败，请关闭后重新打开。');
    };
    const timeout = window.setTimeout(fail, 15000);
    image.onload = () => {
      clearTimeout(timeout);
      if (sessionRef.current !== session) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        fail();
        return;
      }
      imageRef.current = image;
      setOriginal({ width: image.naturalWidth, height: image.naturalHeight });
      setWidth(String(image.naturalWidth));
      setHeight(String(image.naturalHeight));
      setError('');
    };
    image.onerror = () => {
      clearTimeout(timeout);
      fail();
    };
    if (url) image.src = url;
    else {
      clearTimeout(timeout);
      fail();
    }
    return () => {
      sessionRef.current = session + 1;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      imageRef.current = null;
      window.removeEventListener('resize', resize);
      release();
    };
  }, [id, url, projectId]);
  const dimensions = original
    ? resizeDimensions(original, mode, mode === 'scale' ? scale : mode === 'width' ? width : height)
    : { width: 0, height: 0 };
  const invalid = original ? resizeLimit(dimensions) : '';
  const ratio = dimensions.width && original ? (dimensions.width / original.width).toFixed(3) : '';
  const fit = Math.max(
    0,
    Math.min(
      (viewport.width - 80) / dimensions.width,
      (viewport.height - 200) / dimensions.height,
      1,
    ),
  );
  const change = (nextMode: Mode, raw: string) => {
    setMode(nextMode);
    setError('');
    if (nextMode === 'scale') setScale(raw);
    else if (nextMode === 'width') setWidth(raw);
    else setHeight(raw);
    if (!original) return;
    const next = resizeDimensions(original, nextMode, raw);
    if (!next.width || !next.height) return;
    if (nextMode !== 'width') setWidth(String(next.width));
    if (nextMode !== 'height') setHeight(String(next.height));
    if (nextMode !== 'scale') setScale((next.width / original.width).toFixed(3));
  };
  const save = async () => {
    const image = imageRef.current;
    if (!image || !id || savingRef.current || invalid) return;
    const session = sessionRef.current;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建尺寸处理画布');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
      const data = canvas.toDataURL('image/png');
      if (!data.startsWith('data:image/png')) throw new Error('图片尺寸超出当前设备的处理范围。');
      await onSave(id, data, dimensions);
      if (sessionRef.current === session) closeRef.current();
    } catch (cause) {
      if (sessionRef.current === session)
        setError(cause instanceof Error ? cause.message : '尺寸图片保存失败，请重试。');
    } finally {
      if (sessionRef.current === session) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  if (!node) return null;
  const canSave = !!original && !invalid && !saving;
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="调整图片尺寸"
      tabIndex={-1}
      className="fixed inset-0 z-[1000] bg-[var(--af-input)] backdrop-blur-xl flex flex-col items-center justify-center p-10 animate-in fade-in duration-300"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const key = event.key.toLowerCase();
        const editing =
          event.target instanceof Element &&
          event.target.closest('input,textarea,[contenteditable]');
        if (
          (event.ctrlKey || event.metaKey) &&
          (key === 's' || (!editing && (key === 'z' || key === 'y')))
        )
          event.preventDefault();
      }}
    >
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 w-max max-w-[calc(100%-88px)]">
        <div
          className="flex min-h-11 items-center gap-1 px-2 py-1.5 rounded-full bg-[var(--af-surface-raised)] backdrop-blur shadow-lg border border-[var(--af-border)]"
          style={{ flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <span
            className={
              'text-[10px] font-bold whitespace-nowrap ml-1 ' +
              (mode === 'scale' ? 'text-[var(--af-info)]' : 'text-[var(--af-text-muted)]')
            }
          >
            倍数
          </span>
          <input
            disabled={saving}
            aria-label="图片缩放滑块"
            type="range"
            min="0.1"
            max="5"
            step="0.01"
            value={mode === 'scale' ? scale : ratio || '1'}
            onChange={(event) => change('scale', event.target.value)}
            className="w-[120px] h-1 bg-[var(--af-surface-raised)] rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <input
            disabled={saving}
            aria-label="图片缩放倍数"
            type="number"
            min="0.01"
            step="0.01"
            value={mode === 'scale' ? scale : ratio || '1'}
            onChange={(event) => change('scale', event.target.value)}
            className={'w-[64px] ' + inputClass}
          />
          <span className="text-[10px] text-[var(--af-text-muted)] mr-1">x</span>
          <div className="shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1" />
          <span
            className={
              'text-[10px] font-bold whitespace-nowrap ' +
              (mode === 'width' ? 'text-[var(--af-info)]' : 'text-[var(--af-text-muted)]')
            }
          >
            设置宽
          </span>
          <input
            disabled={saving}
            aria-label="图片宽度"
            type="number"
            min="1"
            value={width}
            onChange={(event) => change('width', event.target.value)}
            className={'w-[72px] ' + inputClass}
          />
          <span
            className={
              'text-[10px] font-bold whitespace-nowrap ml-1 ' +
              (mode === 'height' ? 'text-[var(--af-info)]' : 'text-[var(--af-text-muted)]')
            }
          >
            设置高
          </span>
          <input
            disabled={saving}
            aria-label="图片高度"
            type="number"
            min="1"
            value={height}
            onChange={(event) => change('height', event.target.value)}
            className={'w-[72px] ' + inputClass}
          />
          <div className="shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="取消"
              onClick={onClose}
              className="p-1.5 rounded-full text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)] transition-colors"
            >
              <Close size={16} />
            </button>
            <button
              type="button"
              aria-label="保存尺寸图片"
              onClick={() => void save()}
              disabled={!canSave}
              className={
                'p-1.5 rounded-full transition-all ' +
                (canSave
                  ? 'bg-[var(--af-info-bg)] text-[var(--af-text)] hover:bg-[var(--af-info-bg)] shadow-lg shadow-blue-900/20'
                  : 'bg-[var(--af-surface-raised)] text-[var(--af-text-muted)] cursor-not-allowed')
              }
            >
              {saving ? <Spinner size={16} className="animate-spin" /> : <Save size={16} />}
            </button>
          </div>
        </div>
      </div>
      <div className="relative flex items-center justify-center flex-1 w-full overflow-hidden select-none">
        {original && !invalid && dimensions.width > 0 && dimensions.height > 0 && (
          <div
            style={{
              width: Math.max(1, Math.round(dimensions.width * fit)),
              height: Math.max(1, Math.round(dimensions.height * fit)),
            }}
            className="relative bg-[var(--af-input)] shadow-2xl rounded-lg overflow-hidden border border-[var(--af-border)]"
          >
            <img
              src={url}
              alt={node.title || '尺寸预览'}
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>
        )}
        {!original && !error && (
          <span role="status" className="text-xs text-[var(--af-text-secondary)]">
            正在加载图片…
          </span>
        )}
      </div>
      {(error || invalid) && (
        <div role="alert" className="absolute bottom-20 px-4 text-xs text-[var(--af-danger)]">
          {error || invalid}
        </div>
      )}
      <div className="absolute bottom-10 flex items-center gap-3 text-xs font-medium">
        <span className="text-[var(--af-text-muted)]">
          {original ? `${original.width} × ${original.height}` : '--'}
        </span>
        <span className="text-[var(--af-text-muted)]">→</span>
        <span className="text-[var(--af-info)] font-mono">
          {dimensions.width ? `${dimensions.width} × ${dimensions.height}` : '--'}
        </span>
      </div>
    </div>
  );
}
