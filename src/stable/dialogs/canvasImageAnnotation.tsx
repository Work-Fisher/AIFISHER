import { createPortal } from 'react-dom';
import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';
import { resizeLimit } from './imageResizeGeometry';
import {
  renderAnnotations,
  type AnnotationStroke,
  type AnnotationTool,
} from './imageAnnotationDrawing';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useState' | 'useRef' | 'useEffect' | 'useLayoutEffect' | 'useCallback'
>;
interface Props {
  initialMask?: boolean;
  saveLabel?: string;
  node?: { id: string; resultUrl?: string; title?: string };
  projectId?: string;
  onSave(
    id: string,
    data: string,
    dimensions: { width: number; height: number },
  ): Promise<unknown> | unknown;
  onClose(): void;
}
interface Icons {
  Close: CanvasComponent;
  Save: CanvasComponent;
  Spinner: CanvasComponent;
}
interface Timeline {
  past: AnnotationStroke[][];
  present: AnnotationStroke[];
  future: AnnotationStroke[][];
}

export function CanvasImageAnnotation(
  React: Runtime,
  { node, projectId, onSave, onClose, initialMask = false, saveLabel = '保存' }: Props,
  { Close, Save, Spinner }: Icons,
) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null),
    canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null),
    sessionRef = React.useRef(0),
    savingRef = React.useRef(false);
  const activeRef = React.useRef<AnnotationStroke | null>(null);
  const pointerRef = React.useRef<{
    id: number;
    x: number;
    y: number;
    pan: boolean;
  } | null>(null);
  const historyRef = React.useRef<Timeline>({
    past: [],
    present: [],
    future: [],
  });
  const closeRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const [tool, setTool] = React.useState<AnnotationTool>('brush');
  const [color, setColor] = React.useState('#ef4444'),
    [brushSize, setBrushSize] = React.useState(12),
    [opacity, setOpacity] = React.useState(0.6);
  const [mask, setMask] = React.useState(false),
    [saving, setSaving] = React.useState(false),
    [loaded, setLoaded] = React.useState(false),
    [error, setError] = React.useState('');
  const [history, setHistory] = React.useState<Timeline>(historyRef.current);
  const strokes = history.present,
    redoStrokes = history.future;
  const [display, setDisplay] = React.useState({ width: 0, height: 0 });
  const [viewport, setViewport] = React.useState({ x: 0, y: 0, scale: 1 });
  const [panning, setPanning] = React.useState(false),
    [drawing, setDrawing] = React.useState(false);
  const [cursor, setCursor] = React.useState({ x: 0, y: 0 }),
    [cursorVisible, setCursorVisible] = React.useState(false);
  const id = node?.id,
    url = node?.resultUrl;
  const redraw = React.useCallback(() => {
    const canvas = canvasRef.current,
      image = imageRef.current;
    if (!canvas || !image || !canvas.width || !canvas.height) return;
    const current = historyRef.current.present;
    renderAnnotations(canvas, activeRef.current ? [...current, activeRef.current] : current, {
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  }, []);
  const fit = React.useCallback(() => {
    const root = stageRef.current,
      image = imageRef.current;
    if (!root || !image) return;
    const width = root.clientWidth || window.innerWidth,
      height = root.clientHeight || window.innerHeight;
    const ratio = Math.max(
      0.001,
      Math.min(
        Math.max(1, width - 32) / image.naturalWidth,
        Math.max(1, height - 32) / image.naturalHeight,
      ),
    );
    const next = {
      width: image.naturalWidth * ratio,
      height: image.naturalHeight * ratio,
    };
    setDisplay(next);
    setViewport({
      x: (width - next.width) / 2,
      y: (height - next.height) / 2,
      scale: 1,
    });
  }, []);
  React.useEffect(() => {
    const session = ++sessionRef.current;
    savingRef.current = false;
    imageRef.current = null;
    activeRef.current = null;
    pointerRef.current = null;
    historyRef.current = { past: [], present: [], future: [] };
    setHistory(historyRef.current);
    setSaving(false);
    setLoaded(false);
    setError('');
    setDrawing(false);
    setPanning(false);
    setCursorVisible(false);
    setTool('brush');
    setColor('#ef4444');
    setBrushSize(12);
    setOpacity(0.6);
    setMask(initialMask);
    setDisplay({ width: 0, height: 0 });
    if (!id || !rootRef.current) return;
    const release = activateModal(rootRef.current, () => closeRef.current());
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
      const invalid = resizeLimit({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      if (invalid) {
        setError(invalid);
        return;
      }
      imageRef.current = image;
      setLoaded(true);
      setError('');
      fit();
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
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    window.addEventListener('resize', fit);
    return () => {
      sessionRef.current = session + 1;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      window.removeEventListener('resize', fit);
      observer?.disconnect();
      release();
    };
  }, [id, url, projectId, fit, initialMask]);
  React.useLayoutEffect(() => {
    if (canvasRef.current && display.width && display.height) {
      canvasRef.current.width = Math.max(1, Math.round(display.width));
      canvasRef.current.height = Math.max(1, Math.round(display.height));
      redraw();
    }
  }, [display, history, redraw]);
  const commit = (next: AnnotationStroke[]) => {
    const old = historyRef.current;
    historyRef.current = {
      past: [...old.past, old.present].slice(-50),
      present: next,
      future: [],
    };
    setHistory(historyRef.current);
  };
  const undo = () => {
    if (savingRef.current || pointerRef.current) return;
    const old = historyRef.current,
      previous = old.past.at(-1);
    if (!previous) return;
    historyRef.current = {
      past: old.past.slice(0, -1),
      present: previous,
      future: [old.present, ...old.future],
    };
    setHistory(historyRef.current);
  };
  const redo = () => {
    if (savingRef.current || pointerRef.current) return;
    const old = historyRef.current,
      next = old.future[0];
    if (!next) return;
    historyRef.current = {
      past: [...old.past, old.present],
      present: next,
      future: old.future.slice(1),
    };
    setHistory(historyRef.current);
  };
  const clear = () => {
    if (!savingRef.current && !pointerRef.current && historyRef.current.present.length) commit([]);
  };
  const zoomAt = (factor: number, x: number, y: number) =>
    setViewport((old) => {
      const scale = Math.max(0.05, Math.min(20, old.scale * factor));
      return {
        scale,
        x: x - ((x - old.x) * scale) / old.scale,
        y: y - ((y - old.y) * scale) / old.scale,
      };
    });
  const wheel = (event: ReactTypes.WheelEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!loaded || pointerRef.current || savingRef.current) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (bounds)
      zoomAt(
        event.deltaY < 0 ? 1.15 : 1 / 1.15,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
  };
  const zoomCenter = (factor: number) => {
    const root = stageRef.current;
    if (root && !pointerRef.current)
      zoomAt(
        factor,
        (root.clientWidth || window.innerWidth) / 2,
        (root.clientHeight || window.innerHeight) / 2,
      );
  };
  const zoomIn = () => zoomCenter(1.15),
    zoomOut = () => zoomCenter(1 / 1.15),
    resetView = () => {
      if (!pointerRef.current) fit();
    };
  const point = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(),
      image = imageRef.current!;
    return {
      x:
        ((event.clientX - bounds.left) / (bounds.width || display.width * viewport.scale)) *
        image.naturalWidth,
      y:
        ((event.clientY - bounds.top) / (bounds.height || display.height * viewport.scale)) *
        image.naturalHeight,
    };
  };
  const pointerDown = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded || savingRef.current || pointerRef.current || ![0, 1].includes(event.button))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: event.button === 1,
    };
    if (event.button === 1) {
      setPanning(true);
      return;
    }
    const start = point(event);
    activeRef.current = {
      tool,
      color,
      size: (brushSize * imageRef.current!.naturalWidth) / display.width,
      arrowHead: (20 * imageRef.current!.naturalWidth) / display.width,
      opacity,
      points: [start, start],
    };
    setDrawing(true);
    redraw();
  };
  const pointerMove = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    setCursorVisible(true);
    const bounds = stageRef.current?.getBoundingClientRect();
    setCursor({ x: event.clientX - (bounds?.left || 0), y: event.clientY - (bounds?.top || 0) });
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (pointer.pan) {
      const dx = event.clientX - pointer.x,
        dy = event.clientY - pointer.y;
      setViewport((old) => ({ ...old, x: old.x + dx, y: old.y + dy }));
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      return;
    }
    const stroke = activeRef.current;
    if (!stroke) return;
    if (['rectangle', 'circle', 'arrow', 'line'].includes(stroke.tool))
      stroke.points[1] = point(event);
    else stroke.points.push(point(event));
    redraw();
  };
  const pointerUp = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (event.type === 'pointerup') pointerMove(event);
    const stroke = activeRef.current;
    activeRef.current = null;
    pointerRef.current = null;
    setDrawing(false);
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (stroke) commit([...historyRef.current.present, stroke]);
    else redraw();
  };
  const save = async () => {
    const image = imageRef.current;
    if (!image || !id || savingRef.current || pointerRef.current) return;
    const session = sessionRef.current;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      const canvas = document.createElement('canvas'),
        overlay = document.createElement('canvas');
      canvas.width = overlay.width = dimensions.width;
      canvas.height = overlay.height = dimensions.height;
      renderAnnotations(overlay, historyRef.current.present, dimensions);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建标注图片');
      context.drawImage(image, 0, 0);
      context.globalCompositeOperation = mask ? 'destination-out' : 'source-over';
      context.drawImage(overlay, 0, 0);
      const data = canvas.toDataURL('image/png');
      if (!data.startsWith('data:image/png')) throw new Error('图片超出当前设备的处理范围。');
      await onSave(id, data, dimensions);
      if (sessionRef.current === session) closeRef.current();
    } catch (cause) {
      if (sessionRef.current === session)
        setError(cause instanceof Error ? cause.message : '标注保存失败，请重试。');
    } finally {
      if (sessionRef.current === session) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  const keyDown = (event: ReactTypes.KeyboardEvent) => {
    event.stopPropagation();
    if (!(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    const key = event.key.toLowerCase(),
      editing =
        event.target instanceof Element && event.target.closest('input,textarea,[contenteditable]');
    if (key === 's') {
      event.preventDefault();
      void save();
    } else if (!editing && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
    }
  };
  return node
    ? createPortal(
        <div
          ref={rootRef}
          role="dialog"
          aria-label="标注图片"
          aria-modal="true"
          onKeyDown={keyDown}
          onWheel={(event) => event.stopPropagation()}
          className={
            'fixed inset-0 z-[1000] bg-[var(--af-input)] backdrop-blur-xl flex flex-col items-center gap-4 p-4 animate-in fade-in duration-300'
          }
          onPointerDown={(event) => event.stopPropagation()}
        >
          {error && (
            <div
              role="alert"
              className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] text-sm text-[var(--af-danger)] bg-[var(--af-input)] rounded-lg px-4 py-2"
            >
              {error}
            </div>
          )}
          <div
            className={'relative z-50 flex shrink-0 items-center justify-center gap-2 w-full pr-14'}
          >
            <fieldset
              disabled={saving}
              style={{ flexWrap: 'wrap', justifyContent: 'center' }}
              className={
                'flex min-h-11 items-center gap-1 px-2 py-1.5 rounded-full bg-[var(--af-surface-raised)] backdrop-blur shadow-lg border border-[var(--af-border)]'
              }
            >
              <div
                className={
                  'flex items-center p-1 gap-1 bg-[var(--af-input)] rounded-full border border-[var(--af-border)] mr-1'
                }
              >
                <button
                  onClick={() => setMask(!1)}
                  className={`px-3 py-1 rounded-full text-[11px] font-black transition-all duration-200 ${mask ? 'text-[var(--af-text-muted)] hover:text-[var(--af-text-secondary)]' : 'bg-[var(--af-info-bg)] text-[var(--af-text)] shadow-lg'}`}
                >
                  {'标准'}
                </button>
                <button
                  onClick={() => setMask(!0)}
                  className={`px-3 py-1 rounded-full text-[11px] font-black transition-all duration-200 ${mask ? 'bg-[var(--af-info-bg)] text-[var(--af-text)] shadow-lg' : 'text-[var(--af-text-muted)] hover:text-[var(--af-text-secondary)]'}`}
                >
                  {'遮罩'}
                </button>
              </div>
              <div className={'shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1'} />
              <div
                role={'group'}
                className={'flex items-center gap-1 p-1 rounded-full bg-[var(--af-input)]'}
              >
                <button
                  onClick={() => setTool('brush')}
                  title={'画笔工具'}
                  className={`inline-flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${tool === 'brush' ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'}`}
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path d={'M3 21v-4a4 4 0 1 1 4 4h-4'} />
                    <path d={'M21 3a16 16 0 0 0 -12.8 10.2'} />
                    <path d={'M21 3a16 16 0 0 1 -10.2 12.8'} />
                    <path d={'M10.6 9a9 9 0 0 1 4.4 4.4'} />
                  </svg>
                </button>
                <button
                  onClick={() => setTool('rectangle')}
                  title={'矩形工具'}
                  className={`inline-flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${tool === 'rectangle' ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'}`}
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path
                      d={
                        'M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z'
                      }
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setTool('circle')}
                  title={'圆形工具'}
                  className={`inline-flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${tool === 'circle' ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'}`}
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <circle cx={'12'} cy={'12'} r={'9'} />
                  </svg>
                </button>
                <button
                  onClick={() => setTool('arrow')}
                  title={'箭头工具'}
                  className={`inline-flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${tool === 'arrow' ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'}`}
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path d={'M5 12l14 0'} />
                    <path d={'M13 18l6 -6'} />
                    <path d={'M13 6l6 6'} />
                  </svg>
                </button>
                <button
                  onClick={() => setTool('line')}
                  title={'直线工具'}
                  className={`inline-flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${tool === 'line' ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'}`}
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path d={'M5 12l14 0'} />
                  </svg>
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  title={'橡皮擦'}
                  className={`inline-flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${tool === 'eraser' ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'}`}
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path
                      d={
                        'M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3'
                      }
                    />
                    <path d={'M18 13.3l-6.3 -6.3'} />
                  </svg>
                </button>
              </div>
              <div className={'shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1'} />
              <div className={'flex items-center gap-3 px-2'}>
                <div
                  className={
                    'flex items-center justify-center w-10 h-10 shrink-0 bg-[var(--af-input)] rounded-lg'
                  }
                >
                  <div
                    className={'rounded-full shadow-inner transition-all duration-75'}
                    style={{
                      width: `${Math.min(32, Math.max(2, brushSize / 1.5))}px`,
                      height: `${Math.min(32, Math.max(2, brushSize / 1.5))}px`,
                      backgroundColor: color,
                      opacity: opacity,
                      boxShadow: '0 0 0 1px rgba(255,255,255,0.2)',
                    }}
                  />
                </div>
                <div className={'flex items-center gap-2'}>
                  <input
                    type={'color'}
                    value={color}
                    title={'选择颜色'}
                    onChange={(event) => setColor(event.target.value)}
                    className={
                      'size-5 aspect-square rounded-full border-none cursor-pointer bg-transparent'
                    }
                  />
                  <div className={'flex items-center gap-2 h-8 w-[136px]'}>
                    <input
                      type={'range'}
                      min={'5'}
                      max={'60'}
                      value={brushSize}
                      title={`粗细: ${brushSize}px`}
                      onChange={(event) => setBrushSize(parseInt(event.target.value))}
                      className={
                        'w-full h-1 bg-[var(--af-surface-raised)] rounded-lg appearance-none cursor-pointer accent-[var(--af-focus)]'
                      }
                    />
                    <input
                      type={'number'}
                      min={'5'}
                      max={'60'}
                      step={'1'}
                      value={brushSize}
                      title={`粗细: ${brushSize}px`}
                      onChange={(event) => {
                        const value = parseInt(event.target.value, 10);
                        if (!Number.isNaN(value)) setBrushSize(Math.max(5, Math.min(60, value)));
                      }}
                      className={
                        'w-[46px] h-7 px-1.5 rounded-md bg-[var(--af-input)] border border-[var(--af-border-control)] text-[10px] text-[var(--af-text)] outline-none focus:border-[var(--af-info)] text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                      }
                    />
                  </div>
                </div>
                <div className={'shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6'} />
                <div className={'flex items-center gap-2'}>
                  <span className={'text-[10px] text-[var(--af-text-muted)] font-bold w-4'}>
                    {'OP'}
                  </span>
                  <div className={'flex items-center gap-2 h-8 w-[132px]'}>
                    <input
                      type={'range'}
                      min={'0.1'}
                      max={'1.0'}
                      step={'0.1'}
                      value={opacity}
                      title={`透明度: ${Math.round(opacity * 100)}%`}
                      onChange={(event) => setOpacity(parseFloat(event.target.value))}
                      className={
                        'w-full h-1 bg-[var(--af-surface-raised)] rounded-lg appearance-none cursor-pointer accent-[var(--af-focus)]'
                      }
                    />
                    <input
                      type={'number'}
                      min={'10'}
                      max={'100'}
                      step={'10'}
                      value={Math.round(opacity * 100)}
                      title={`透明度: ${Math.round(opacity * 100)}%`}
                      onChange={(event) => {
                        const value = parseInt(event.target.value, 10);
                        if (!Number.isNaN(value))
                          setOpacity(Math.max(0.1, Math.min(1, value / 100)));
                      }}
                      className={
                        'w-[48px] h-7 px-1.5 rounded-md bg-[var(--af-input)] border border-[var(--af-border-control)] text-[10px] text-[var(--af-text)] outline-none focus:border-[var(--af-info)] text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                      }
                    />
                  </div>
                </div>
              </div>
              <div className={'shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1'} />
              <div className={'flex items-center gap-1'}>
                <button
                  onClick={undo}
                  disabled={history.past.length === 0}
                  title={'撤销 (Ctrl+Z)'}
                  className={
                    'h-8 w-8 rounded-full text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] disabled:opacity-30'
                  }
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path d={'M9 14l-4 -4l4 -4'} />
                    <path d={'M5 10h11a4 4 0 1 1 0 8h-1'} />
                  </svg>
                </button>
                <button
                  onClick={redo}
                  disabled={redoStrokes.length === 0}
                  title={'重做 (Ctrl+Y)'}
                  className={
                    'h-8 w-8 rounded-full text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] disabled:opacity-30'
                  }
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path d={'M15 14l4 -4l-4 -4'} />
                    <path d={'M19 10h-11a4 4 0 1 0 0 8h1'} />
                  </svg>
                </button>
                <button
                  onClick={clear}
                  disabled={strokes.length === 0}
                  title={'清除所有'}
                  className={
                    'h-8 w-8 rounded-full text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-danger)] disabled:opacity-30 transition-colors'
                  }
                >
                  <svg
                    xmlns={'http://www.w3.org/2000/svg'}
                    width={'18'}
                    height={'18'}
                    viewBox={'0 0 24 24'}
                    fill={'none'}
                    stroke={'currentColor'}
                    strokeWidth={'2'}
                    strokeLinecap={'round'}
                    strokeLinejoin={'round'}
                  >
                    <path d={'M4 7l16 0'} />
                    <path d={'M10 11l0 6'} />
                    <path d={'M14 11l0 6'} />
                    <path d={'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12'} />
                    <path d={'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3'} />
                  </svg>
                </button>
              </div>
              <div className={'shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1'} />
              <button
                onClick={save}
                aria-label="保存标注图片"
                disabled={saving || !loaded || drawing}
                className={
                  'flex items-center justify-center bg-[var(--af-info-bg)] text-[var(--af-text)] h-8 rounded-full px-4 gap-2 text-xs font-bold hover:bg-[var(--af-info-bg)] disabled:opacity-50 transition-colors ml-2'
                }
              >
                {saving ? <Spinner size={16} className={'animate-spin'} /> : <Save size={16} />}
                {saveLabel}
              </button>
            </fieldset>
          </div>
          <button
            onClick={onClose}
            title={'取消'}
            aria-label={'取消'}
            className={
              'absolute top-4 right-6 flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-full text-[var(--af-text)] transition-colors z-[60]'
            }
          >
            <Close size={22} />
          </button>
          <div
            ref={stageRef}
            className={'relative w-full flex-1 min-h-0 overflow-hidden'}
            onWheel={wheel}
          >
            {!loaded && !error && (
              <div className={'absolute inset-0 flex items-center justify-center'}>
                <Spinner size={40} className={'animate-spin text-[var(--af-text-muted)]'} />
              </div>
            )}
            <div
              className={'absolute shadow-2xl rounded-lg overflow-hidden bg-[var(--af-input)]'}
              style={{
                visibility: loaded ? 'visible' : 'hidden',
                left: 0,
                top: 0,
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                transformOrigin: '0 0',
                transition: 'none',
              }}
            >
              {node.resultUrl && (
                <img
                  src={node.resultUrl}
                  alt={'Annotate'}
                  className={'block pointer-events-none'}
                  style={{
                    width: display.width,
                    height: display.height,
                    visibility: loaded && display.width > 0 ? 'visible' : 'hidden',
                  }}
                />
              )}
              <canvas
                ref={canvasRef}
                className={`absolute inset-0 touch-none ${panning ? 'cursor-grab active:cursor-grabbing' : 'cursor-none'}`}
                style={{ width: display.width, height: display.height }}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
                onLostPointerCapture={pointerUp}
                aria-label="标注绘制区域"
                onPointerEnter={() => setCursorVisible(!0)}
                onPointerLeave={(event) => {
                  setCursorVisible(false);
                  if (
                    (drawing || panning) &&
                    !event.currentTarget.hasPointerCapture(event.pointerId)
                  )
                    pointerUp(event);
                }}
              />
            </div>
            {cursorVisible && !panning && (
              <div
                className={
                  'absolute pointer-events-none z-[2000] rounded-full border border-[var(--af-border)] shadow-[0_0_0_1px_rgba(0,0,0,0.3)] -translate-x-1/2 -translate-y-1/2'
                }
                style={{
                  left: cursor.x,
                  top: cursor.y,
                  width: `${brushSize * viewport.scale}px`,
                  height: `${brushSize * viewport.scale}px`,
                  backgroundColor: tool === 'eraser' ? 'transparent' : color,
                  opacity: tool === 'eraser' ? 0.5 : opacity,
                  borderStyle: tool === 'eraser' ? 'dashed' : 'solid',
                }}
              >
                {tool === 'eraser' && (
                  <div className={'absolute inset-0 flex items-center justify-center'}>
                    <div className={'w-1 h-1 bg-[var(--af-primary)] rounded-full'} />
                  </div>
                )}
              </div>
            )}
          </div>
          <div
            className={
              'relative shrink-0 flex items-center gap-3 bg-[var(--af-surface)] backdrop-blur-md rounded-full px-4 py-2.5 z-50 border border-[var(--af-border)] shadow-2xl animate-in slide-in-from-bottom duration-500'
            }
          >
            <button
              className={'p-1 text-[var(--af-text)] hover:text-[var(--af-text)] transition-colors'}
              onClick={zoomOut}
              title={'缩小'}
            >
              <svg
                className={'w-5 h-5'}
                viewBox={'0 0 24 24'}
                fill={'none'}
                stroke={'currentColor'}
                strokeWidth={'2.5'}
                strokeLinecap={'round'}
                strokeLinejoin={'round'}
              >
                <line x1={'5'} y1={'12'} x2={'19'} y2={'12'} />
              </svg>
            </button>
            <span
              className={
                'text-[var(--af-text)] text-[13px] font-bold min-w-[54px] text-center font-mono'
              }
            >
              {Math.round(viewport.scale * 100)}
              {'%'}
            </span>
            <button
              className={'p-1 text-[var(--af-text)] hover:text-[var(--af-text)] transition-colors'}
              onClick={zoomIn}
              title={'放大'}
            >
              <svg
                className={'w-5 h-5'}
                viewBox={'0 0 24 24'}
                fill={'none'}
                stroke={'currentColor'}
                strokeWidth={'2.5'}
                strokeLinecap={'round'}
                strokeLinejoin={'round'}
              >
                <line x1={'12'} y1={'5'} x2={'12'} y2={'19'} />
                <line x1={'5'} y1={'12'} x2={'19'} y2={'12'} />
              </svg>
            </button>
            <div className={'flex items-center ml-1 pl-3 border-l border-[var(--af-border)]'}>
              <button
                className={
                  'px-2.5 py-1 text-[11px] font-bold text-[var(--af-text)] hover:text-[var(--af-text)] bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-md transition-all active:scale-95'
                }
                onClick={resetView}
              >
                {'重置'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;
}
