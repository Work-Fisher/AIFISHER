import { RotateCcw, FlipHorizontal, Grid2X2, Maximize, Camera, LogOut } from 'lucide-react';
import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';
import { resizeLimit } from './imageResizeGeometry';
import {
  cropMargin,
  cropRatios,
  equalCuts,
  cropRatio,
  centeredCrop,
  hitCrop,
  cropHandles,
  createCrop,
  resizeCrop,
  moveCrop,
  moveCropCut,
  cropOutputRects,
  type CropPoint,
  type CropRect,
  type CropSize,
  type CropHandle,
  type CropOutput,
} from './imageCropGeometry';
import type { PanoramaRenderer } from './canvasPanoramaScene';
import { gridExportIndices, type GridOrder } from './gridExport';
type Runtime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'useState'
  | 'useRef'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
  | 'Suspense'
  | 'Component'
>;
interface Props {
  saveLabel?: string;
  variant?: 'crop' | 'grid' | 'panorama';
  node?: { id: string; resultUrl?: string };
  projectId?: string;
  onClose(): void;
  onSave(
    id: string,
    outputs: CropOutput[],
    onProgress: (completed: number) => void,
  ): Promise<unknown> | unknown;
}
interface Dependencies {
  Close: CanvasComponent;
  Save: CanvasComponent;
  Spinner: CanvasComponent;
  Globe: CanvasComponent;
  Chevron: CanvasComponent;
  Canvas: CanvasComponent;
  Scene: CanvasComponent;
  Vector2: new () => { x: number; y: number };
  toneMapping: number;
  colorSpace: string;
}
interface CropGesture {
  id: number;
  start: CropPoint;
  rect: CropRect;
  kind: CropHandle | 'move' | 'create' | 'row' | 'column';
  index?: number;
}

export function CanvasImageCrop(
  React: Runtime,
  { node, projectId, onSave, onClose, variant = 'grid', saveLabel = '保存' }: Props,
  { Close, Save, Spinner, Chevron, Canvas, Scene, Vector2, toneMapping, colorSpace }: Dependencies,
) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null),
    canvasRef = React.useRef<HTMLCanvasElement>(null),
    imageRef = React.useRef<HTMLImageElement | null>(null);
  const sessionRef = React.useRef(0),
    savingRef = React.useRef(false),
    gestureRef = React.useRef<CropGesture | null>(null),
    sceneRef = React.useRef<PanoramaRenderer | null>(null);
  const closeRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const [display, setDisplay] = React.useState<CropSize>({
      width: 0,
      height: 0,
    }),
    [crop, setCrop] = React.useState<CropRect | null>(null);
  const displayRef = React.useRef(display),
    cropRef = React.useRef(crop);
  const updateCrop = (next: CropRect | null) => {
    cropRef.current = next;
    setCrop(next);
  };
  const [loaded, setLoaded] = React.useState(false),
    [saving, setSaving] = React.useState(false),
    [error, setError] = React.useState(''),
    [progress, setProgress] = React.useState(0);
  const [ratioLabel, setRatioLabel] = React.useState(variant === 'panorama' ? '16:9' : 'Original'),
    [ratioOpen, setRatioOpen] = React.useState(false),
    [fov, setFov] = React.useState(75),
    [panoramaReady, setPanoramaReady] = React.useState(false);
  const panorama = variant === 'panorama';
  const [viewPreview, setViewPreview] = React.useState<CropOutput[]>([]);
  const [selectedViews, setSelectedViews] = React.useState<number[]>([]);
  const [mirror, setMirror] = React.useState(false);
  const [guides, setGuides] = React.useState(false);
  const [sceneVersion, setSceneVersion] = React.useState(0);
  const [order, setOrder] = React.useState<GridOrder>('row');
  const [exportSelection, setExportSelection] = React.useState('');
  const [rows, setRows] = React.useState(1),
    [columns, setColumns] = React.useState(1),
    [rowCuts, setRowCuts] = React.useState<number[]>([]),
    [columnCuts, setColumnCuts] = React.useState<number[]>([]),
    [rowGap, setRowGap] = React.useState(0),
    [columnGap, setColumnGap] = React.useState(0);
  const [hover, setHover] = React.useState<CropHandle | 'move' | 'row' | 'column' | null>(null);
  const [viewport, setViewport] = React.useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const id = node?.id,
    url = node?.resultUrl;
  React.useEffect(() => {
    setViewPreview([]);
    setSelectedViews([]);
  }, [id, url, fov, mirror, ratioLabel, sceneVersion]);
  const fit = React.useCallback(() => {
    const image = imageRef.current,
      root = stageRef.current;
    if (!image || !root) return;
    const width = root.clientWidth || window.innerWidth,
      height = root.clientHeight || window.innerHeight;
    setViewport({ width, height });
    const factor = Math.max(
      0.001,
      Math.min(
        Math.max(1, width - cropMargin * 2 - 16) / image.naturalWidth,
        Math.max(1, height - cropMargin * 2 - 16) / image.naturalHeight,
      ),
    );
    const next = {
        width: image.naturalWidth * factor,
        height: image.naturalHeight * factor,
      },
      previous = displayRef.current,
      current = cropRef.current;
    const nextCrop =
      current && previous.width > 0
        ? {
            x: (current.x * next.width) / previous.width,
            y: (current.y * next.height) / previous.height,
            width: (current.width * next.width) / previous.width,
            height: (current.height * next.height) / previous.height,
          }
        : centeredCrop(next, image.naturalWidth / image.naturalHeight);
    displayRef.current = next;
    cropRef.current = nextCrop;
    setDisplay(next);
    setCrop(nextCrop);
  }, []);
  React.useEffect(() => {
    const session = ++sessionRef.current;
    savingRef.current = false;
    imageRef.current = null;
    gestureRef.current = null;
    sceneRef.current = null;
    cropRef.current = null;
    displayRef.current = { width: 0, height: 0 };
    setLoaded(false);
    setSaving(false);
    setError('');
    setProgress(0);
    setDisplay({ width: 0, height: 0 });
    setCrop(null);
    setFov(75);
    setMirror(false);
    setGuides(false);
    setOrder('row');
    setExportSelection('');
    setPanoramaReady(false);
    setRatioLabel(variant === 'panorama' ? '16:9' : 'Original');
    setRatioOpen(false);
    setRows(1);
    setColumns(1);
    setRowCuts([]);
    setColumnCuts([]);
    setRowGap(0);
    setColumnGap(0);
    if (!id || !rootRef.current) return;
    const release = activateModal(rootRef.current, () => closeRef.current()),
      image = new Image();
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
  }, [id, url, projectId, fit, variant]);
  const source = imageRef.current
    ? {
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      }
    : display;
  const ratio = source.width ? cropRatio(ratioLabel, source) : 1;
  const panoramaRatio = ratio || 16 / 9;
  const panoramaSize = {
    width: Math.min(
      Math.max(1, viewport.width - 32),
      Math.max(1, viewport.height - cropMargin * 2 - 16) * panoramaRatio,
    ),
    height: 0,
  };
  panoramaSize.height = panoramaSize.width / panoramaRatio;
  const onSceneReady = React.useCallback((scene: PanoramaRenderer | null) => {
    sceneRef.current = scene;
    setPanoramaReady(!!scene);
  }, []);
  const Boundary = React.useMemo(
    () =>
      class extends React.Component<{ children: ReactTypes.ReactNode }, { failed: boolean }> {
        state = { failed: false };
        static getDerivedStateFromError() {
          return { failed: true };
        }
        componentDidCatch() {
          setError('全景预览加载失败，请关闭后重新打开。');
          setPanoramaReady(false);
        }
        render() {
          return this.state.failed ? null : this.props.children;
        }
      },
    [React.Component],
  );
  const grid = !!crop && (rows > 1 || columns > 1);
  const selection = React.useMemo(() => {
    if (!crop || !display.width) return { pieces: null, error: '' };
    try {
      return {
        pieces: cropOutputRects(
          crop,
          display,
          { width: source.width, height: source.height },
          rowCuts,
          columnCuts,
          rowGap,
          columnGap,
        ),
        error: '',
      };
    } catch {
      return { pieces: null, error: '裁切范围太小，无法为每个分块保留至少一个像素。' };
    }
  }, [crop, display, source.width, source.height, rowCuts, columnCuts, rowGap, columnGap]);
  let invalidSelection = panorama ? '' : selection.error;
  if (!panorama && !invalidSelection) {
    try {
      gridExportIndices(rows, columns, order, exportSelection);
    } catch (cause) {
      invalidSelection = cause instanceof Error ? cause.message : '导出序号无效';
    }
  }
  const restoreGrid = (nextRows = rows, nextColumns = columns) => {
    if (savingRef.current) return;
    setRowCuts(equalCuts(nextRows));
    setColumnCuts(equalCuts(nextColumns));
    setRowGap(0);
    setColumnGap(0);
    setRatioLabel('Original');
    updateCrop({ ...display, x: 0, y: 0 });
  };
  const changeRows = (value: number) => {
    setRows(value);
    restoreGrid(value, columns);
  };
  const changeColumns = (value: number) => {
    setColumns(value);
    restoreGrid(rows, value);
  };
  const selectRatio = (label: string) => {
    if (savingRef.current) return;
    setRatioLabel(label);
    setRatioOpen(false);
    if (label !== 'Free') updateCrop(centeredCrop(display, cropRatio(label, source)));
  };
  const location = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(display.width, event.clientX - bounds.left - cropMargin)),
      y: Math.max(0, Math.min(display.height, event.clientY - bounds.top - cropMargin)),
    };
  };
  const hit = (point: CropPoint): { kind: CropGesture['kind']; index?: number } => {
    const current = cropRef.current;
    if (!current) return { kind: 'create' };
    if (grid) {
      const column = columnCuts.findIndex(
        (cut) =>
          Math.abs(point.x - current.x - current.width * cut) <= 10 &&
          point.y >= current.y &&
          point.y <= current.y + current.height,
      );
      if (column >= 0) return { kind: 'column', index: column };
      const row = rowCuts.findIndex(
        (cut) =>
          Math.abs(point.y - current.y - current.height * cut) <= 10 &&
          point.x >= current.x &&
          point.x <= current.x + current.width,
      );
      if (row >= 0) return { kind: 'row', index: row };
    }
    return { kind: hitCrop(current, point) || 'create' };
  };
  const pointerDown = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded || savingRef.current || event.button !== 0 || gestureRef.current) return;
    const start = location(event),
      action = hit(start);
    gestureRef.current = {
      id: event.pointerId,
      start,
      rect: cropRef.current || { ...start, width: 0, height: 0 },
      ...action,
    };
    if (action.kind === 'create') updateCrop({ ...start, width: 0, height: 0 });
    setRatioOpen(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    const point = location(event),
      gesture = gestureRef.current;
    if (!gesture) {
      const kind = hit(point).kind;
      setHover(kind === 'create' ? null : kind);
      return;
    }
    if (gesture.id !== event.pointerId) return;
    if (gesture.kind === 'column')
      setColumnCuts((old) =>
        moveCropCut(
          old,
          gesture.index!,
          (point.x - gesture.rect.x) / gesture.rect.width,
          gesture.rect.width,
        ),
      );
    else if (gesture.kind === 'row')
      setRowCuts((old) =>
        moveCropCut(
          old,
          gesture.index!,
          (point.y - gesture.rect.y) / gesture.rect.height,
          gesture.rect.height,
        ),
      );
    else if (gesture.kind === 'move')
      updateCrop(
        moveCrop(
          gesture.rect,
          { x: point.x - gesture.start.x, y: point.y - gesture.start.y },
          display,
        ),
      );
    else if (gesture.kind === 'create')
      updateCrop(createCrop(gesture.start, point, display, ratio));
    else updateCrop(resizeCrop(gesture.rect, gesture.kind, point, display, ratio));
  };
  const pointerUp = (event: ReactTypes.PointerEvent<HTMLCanvasElement>) => {
    if (gestureRef.current?.id !== event.pointerId) return;
    if (event.type === 'pointerup') pointerMove(event);
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !crop || !display.width || panorama) return;
    canvas.width = display.width + cropMargin * 2;
    canvas.height = display.height + cropMargin * 2;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(cropMargin, cropMargin);
    context.fillStyle = 'rgba(0,0,0,.6)';
    context.fillRect(0, 0, display.width, display.height);
    context.clearRect(crop.x, crop.y, crop.width, crop.height);
    context.strokeStyle = '#3b82f6';
    context.lineWidth = 2;
    context.strokeRect(crop.x, crop.y, crop.width, crop.height);
    if (grid && selection.pieces) {
      const pieces = selection.pieces;
      context.fillStyle = 'rgba(239,68,68,.2)';
      for (let index = 1; index < pieces.columns.length; index++) {
        const previous = pieces.columns[index - 1],
          start = ((previous.start + previous.size) * display.width) / source.width;
        context.fillRect(
          start,
          crop.y,
          (pieces.columns[index].start * display.width) / source.width - start,
          crop.height,
        );
      }
      for (let index = 1; index < pieces.rows.length; index++) {
        const previous = pieces.rows[index - 1],
          start = ((previous.start + previous.size) * display.height) / source.height;
        context.fillRect(
          crop.x,
          start,
          crop.width,
          (pieces.rows[index].start * display.height) / source.height - start,
        );
      }
      for (const [rowIndex, row] of pieces.rows.entries())
        for (const [columnIndex, column] of pieces.columns.entries()) {
          context.strokeRect(
            (column.start * display.width) / source.width,
            (row.start * display.height) / source.height,
            (column.size * display.width) / source.width,
            (row.size * display.height) / source.height,
          );
          context.font = '12px sans-serif';
          context.fillStyle = '#fff';
          context.fillText(
            String(rowIndex * columns + columnIndex + 1),
            (column.start * display.width) / source.width + 8,
            (row.start * display.height) / source.height + 18,
          );
        }
      for (const cut of columnCuts) {
        context.beginPath();
        context.moveTo(crop.x + crop.width * cut, crop.y);
        context.lineTo(crop.x + crop.width * cut, crop.y + crop.height);
        context.stroke();
      }
      for (const cut of rowCuts) {
        context.beginPath();
        context.moveTo(crop.x, crop.y + crop.height * cut);
        context.lineTo(crop.x + crop.width, crop.y + crop.height * cut);
        context.stroke();
      }
    } else {
      context.strokeStyle = 'rgba(255,255,255,.3)';
      context.lineWidth = 1;
      for (const part of [1 / 3, 2 / 3]) {
        context.beginPath();
        context.moveTo(crop.x + crop.width * part, crop.y);
        context.lineTo(crop.x + crop.width * part, crop.y + crop.height);
        context.moveTo(crop.x, crop.y + crop.height * part);
        context.lineTo(crop.x + crop.width, crop.y + crop.height * part);
        context.stroke();
      }
    }
    for (const handle of cropHandles(crop)) {
      context.beginPath();
      context.arc(handle.x, handle.y, hover === handle.id ? 8 : 6, 0, Math.PI * 2);
      context.fillStyle = '#3b82f6';
      context.fill();
      context.strokeStyle = 'white';
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();
  }, [
    crop,
    display,
    grid,
    rowCuts,
    columnCuts,
    rowGap,
    columnGap,
    hover,
    panorama,
    source.width,
    source.height,
    selection,
    columns,
  ]);
  const save = async (viewCount: 1 | 4 | 12 = 1, previewOnly = false) => {
    if (invalidSelection) return;
    const image = imageRef.current,
      current = cropRef.current;
    if (
      !image ||
      !id ||
      (!panorama && (!current || current.width <= 0 || current.height <= 0)) ||
      savingRef.current ||
      gestureRef.current ||
      (panorama && !sceneRef.current)
    )
      return;
    const session = sessionRef.current;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setProgress(0);
    try {
      const outputs: CropOutput[] = [];
      if (panorama && viewCount === 1 && viewPreview.length) {
        outputs.push(...selectedViews.map((index) => viewPreview[index]));
        if (!outputs.length) throw new Error('请至少选择一个视角');
      } else if (panorama) {
        const scene = sceneRef.current!,
          previousSize = new Vector2();
        scene.gl.getSize(previousSize);
        const previousAspect = scene.camera.aspect;
        const previousPosition = scene.camera.position?.clone();
        const previousQuaternion = scene.camera.quaternion?.clone();
        const width = Math.round(Math.max(2048, image.naturalWidth / 2)),
          height = Math.round(width / panoramaRatio);
        const invalid = resizeLimit({ width, height });
        if (invalid) throw new Error(invalid);
        try {
          scene.gl.setSize(width, height, false);
          scene.camera.aspect = panoramaRatio;
          scene.camera.updateProjectionMatrix();
          if (
            viewCount > 1 &&
            (!scene.camera.position || !scene.camera.lookAt || !scene.camera.quaternion)
          )
            throw new Error('全景相机尚未准备好');
          for (let index = 0; index < viewCount; index++) {
            if (viewCount > 1) {
              const yaw = ((index % 4) * Math.PI) / 2;
              const pitch =
                viewCount === 12 ? ([0, 30, -30][Math.floor(index / 4)] * Math.PI) / 180 : 0;
              scene.camera.position!.set(
                -Math.sin(yaw) * Math.cos(pitch) * 0.1,
                -Math.sin(pitch) * 0.1,
                Math.cos(yaw) * Math.cos(pitch) * 0.1,
              );
              scene.camera.lookAt!(0, 0, 0);
            }
            scene.gl.render(scene.scene, scene.camera);
            outputs.push({
              data: scene.gl.domElement.toDataURL('image/png'),
              width,
              height,
              row: Math.floor(index / 4),
              column: index % 4,
            });
          }
        } finally {
          if (previousPosition) scene.camera.position?.copy(previousPosition);
          if (previousQuaternion) scene.camera.quaternion?.copy(previousQuaternion);
          scene.gl.setSize(previousSize.x, previousSize.y, false);
          scene.camera.aspect = previousAspect;
          scene.camera.updateProjectionMatrix();
          scene.gl.render(scene.scene, scene.camera);
        }
      } else {
        const pieces = cropOutputRects(
            current!,
            display,
            source,
            rowCuts,
            columnCuts,
            rowGap,
            columnGap,
          ),
          canvas = document.createElement('canvas');
        for (let row = 0; row < pieces.rows.length; row++)
          for (let column = 0; column < pieces.columns.length; column++) {
            if (sessionRef.current !== session) return;
            const vertical = pieces.rows[row],
              horizontal = pieces.columns[column];
            canvas.width = horizontal.size;
            canvas.height = vertical.size;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('无法创建裁切图片');
            if (grid) {
              context.fillStyle = 'white';
              context.fillRect(0, 0, canvas.width, canvas.height);
            }
            context.drawImage(
              image,
              horizontal.start,
              vertical.start,
              horizontal.size,
              vertical.size,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            outputs.push({
              data: canvas.toDataURL('image/png'),
              width: canvas.width,
              height: canvas.height,
              row,
              column,
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
      }
      if (sessionRef.current !== session) return;
      if (outputs.some((output) => !output.data.startsWith('data:image/png')))
        throw new Error('图片超出当前设备的处理范围。');
      if (previewOnly) {
        setViewPreview(outputs);
        setSelectedViews(outputs.map((_, index) => index));
        return;
      }
      const ordered = panorama
        ? outputs
        : gridExportIndices(rows, columns, order, exportSelection).map((index) => outputs[index]);
      await onSave(id, ordered, (completed) => {
        if (sessionRef.current === session) setProgress(completed);
      });
      if (sessionRef.current === session && !panorama) closeRef.current();
    } catch (cause) {
      if (sessionRef.current === session)
        setError(cause instanceof Error ? cause.message : '裁切保存失败，请重试。');
    } finally {
      if (sessionRef.current === session) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  if (!node) return null;
  const sliderClass =
    'w-20 h-1 bg-[var(--af-surface-raised)] rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:cursor-not-allowed';
  const divider = <div className="shrink-0 bg-[var(--af-surface-raised)] w-[1px] h-6 mx-1" />;
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="裁切图片"
      className="fixed inset-0 z-[1000] bg-[var(--af-input)] backdrop-blur-xl flex flex-col items-center gap-4 p-4 animate-in fade-in duration-300"
      onPointerDown={(event) => {
        event.stopPropagation();
        setRatioOpen(false);
      }}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.ctrlKey || event.metaKey) {
          const key = event.key.toLowerCase();
          if (key === 's') {
            event.preventDefault();
            void save();
          } else if (
            ['z', 'y'].includes(key) &&
            !(
              event.target instanceof Element &&
              event.target.closest('input,textarea,[contenteditable]')
            )
          )
            event.preventDefault();
        }
      }}
    >
      {(error || invalidSelection) && (
        <div
          role="alert"
          className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] text-sm text-[var(--af-danger)] bg-[var(--af-input)] rounded-lg px-4 py-2"
        >
          {error || invalidSelection}
        </div>
      )}
      <div
        className="relative z-50 flex shrink-0 items-center justify-center gap-2 w-full pr-14"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <fieldset
          disabled={saving || !loaded}
          className="flex min-h-11 items-center gap-1 px-2 py-1.5 rounded-full bg-[var(--af-surface-raised)] backdrop-blur shadow-lg border border-[var(--af-border)]"
          style={{ flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <strong className="px-3 text-xs text-[var(--af-text)]">
            {panorama ? '3D 全景' : variant === 'grid' ? '宫格裁剪' : '裁剪'}
          </strong>
          {panorama && (
            <>
              <button className="px-2 py-1 text-xs flex items-center gap-1" onClick={onClose}>
                <LogOut size={14} />
                退出
              </button>
              <button
                className="px-2 py-1 text-xs flex items-center gap-1"
                disabled={!panoramaReady}
                onClick={() => void save(4, true)}
              >
                <Grid2X2 size={14} />
                4视角预览
              </button>
              <button
                className="px-2 py-1 text-xs flex items-center gap-1"
                disabled={!panoramaReady}
                onClick={() => void save(12, true)}
              >
                <Camera size={14} />
                12视角预览
              </button>
              <button
                className="px-2 py-1 text-xs flex items-center gap-1"
                onClick={() => {
                  setFov(75);
                  setMirror(false);
                  setSceneVersion((v) => v + 1);
                }}
              >
                <RotateCcw size={14} />
                重置
              </button>
              <button
                className="px-2 py-1 text-xs flex items-center gap-1"
                aria-pressed={mirror}
                onClick={() => setMirror(!mirror)}
              >
                <FlipHorizontal size={14} />
                镜像
              </button>
              <button
                className="px-2 py-1 text-xs flex items-center gap-1"
                aria-pressed={guides}
                onClick={() => setGuides(!guides)}
              >
                <Grid2X2 size={14} />
                参考线
              </button>
              <button
                className="px-2 py-1 text-xs flex items-center gap-1"
                onClick={() => {
                  const request = document.fullscreenElement
                    ? document.exitFullscreen()
                    : rootRef.current?.requestFullscreen();
                  void request?.catch(() => setError('当前窗口不支持全屏。'));
                }}
              >
                <Maximize size={14} />
                全屏
              </button>
            </>
          )}
          {panorama && (
            <label className="flex items-center gap-2 text-xs text-[var(--af-text-secondary)]">
              视野
              <input
                aria-label="全景视野"
                type="range"
                min="30"
                max="120"
                value={fov}
                onChange={(event) => setFov(Number(event.target.value))}
              />
              {fov}°
            </label>
          )}
          {variant === 'grid' && (
            <>
              <select
                aria-label="宫格预设"
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  const [cols, lines] = event.target.value.split('x').map(Number);
                  setRows(lines);
                  setColumns(cols);
                  restoreGrid(lines, cols);
                  setExportSelection('');
                }}
                className="bg-[var(--af-surface-raised)] text-xs p-2 rounded"
              >
                <option value="" disabled>
                  选择宫格
                </option>
                {['2x2', '3x3', '3x4', '4x3', '1x4', '4x1'].map((value) => (
                  <option key={value} value={value}>
                    {value.replace('x', ' × ')}
                  </option>
                ))}
              </select>
              <select
                aria-label="输出顺序"
                value={order}
                onChange={(event) => setOrder(event.target.value as GridOrder)}
                className="bg-[var(--af-surface-raised)] text-xs p-2 rounded"
              >
                <option value="row">逐行</option>
                <option value="column">逐列</option>
                <option value="snake">蛇形</option>
                <option value="reverse">倒序</option>
              </select>
              <input
                aria-label="导出格子序号"
                value={exportSelection}
                onChange={(event) => setExportSelection(event.target.value)}
                placeholder="全部 / 1,3,5-8"
                className="bg-[var(--af-surface-raised)] text-xs p-2 rounded w-28"
              />
              <div className="flex items-center gap-3 px-3">
                {[
                  {
                    label: '横向分割',
                    value: columns,
                    max: 5,
                    min: 1,
                    onChange: changeColumns,
                  },
                  {
                    label: '竖向分割',
                    value: rows,
                    max: 5,
                    min: 1,
                    onChange: changeRows,
                  },
                ].map((control) => (
                  <label
                    key={control.label}
                    className={`flex items-center gap-2 ${panorama ? 'opacity-40' : ''}`}
                  >
                    <span className="text-[10px] text-[var(--af-text-muted)] font-bold whitespace-nowrap">
                      {control.label}
                    </span>
                    <input
                      aria-label={control.label}
                      type="range"
                      min={control.min}
                      max={control.max}
                      value={control.value}
                      disabled={panorama}
                      onChange={(event) => control.onChange(Number(event.target.value))}
                      className={sliderClass}
                    />
                    <span className="text-[10px] text-[var(--af-info)] font-mono w-6">
                      {control.value}
                    </span>
                  </label>
                ))}
              </div>
              {divider}
              <div className="flex items-center gap-3 px-3">
                {[
                  { label: '横向间隙', value: rowGap, onChange: setRowGap },
                  { label: '竖向间隙', value: columnGap, onChange: setColumnGap },
                ].map((control) => (
                  <label
                    key={control.label}
                    className={`flex items-center gap-2 ${panorama ? 'opacity-40' : ''}`}
                  >
                    <span className="text-[10px] text-[var(--af-text-muted)] font-bold whitespace-nowrap">
                      {control.label}
                    </span>
                    <input
                      aria-label={control.label}
                      type="range"
                      min={0}
                      max={100}
                      value={control.value}
                      disabled={panorama}
                      onChange={(event) => control.onChange(Number(event.target.value))}
                      className={sliderClass}
                    />
                    <span className="text-[10px] text-[var(--af-info)] font-mono w-6">
                      {control.value}
                    </span>
                  </label>
                ))}
              </div>
              {divider}
              <button
                onClick={() => restoreGrid()}
                disabled={panorama || !grid}
                title="恢复默认等分，并让裁切范围重新铺满原图"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)] border-transparent hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)] disabled:opacity-40"
              >
                恢复等分
              </button>
              {divider}
            </>
          )}
          <div className="relative">
            <button
              onClick={() => setRatioOpen(!ratioOpen)}
              aria-expanded={ratioOpen}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${ratioLabel !== 'Free' ? 'bg-[var(--af-info-bg)] text-[var(--af-info)] border-[var(--af-info)]' : 'bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)] border-transparent hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'}`}
            >
              <span>
                {ratioLabel === 'Free'
                  ? '自由比例'
                  : ratioLabel === 'Original'
                    ? '原图比例'
                    : ratioLabel}
              </span>
              <Chevron size={14} className={ratioOpen ? 'rotate-180' : ''} />
            </button>
            {ratioOpen && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-32 bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg shadow-2xl py-1.5 z-50 max-h-64 overflow-y-auto custom-scrollbar">
                {['Original', 'Free', ...cropRatios].map((label) => (
                  <button
                    key={label}
                    onClick={() => selectRatio(label)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${ratioLabel === label ? 'bg-[var(--af-info-bg)] text-[var(--af-info)] font-bold' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] hover:text-[var(--af-text)]'}`}
                  >
                    {label === 'Original' ? '原图比例' : label === 'Free' ? '自由比例' : label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {divider}
          <button
            onClick={() => void save()}
            disabled={
              saving ||
              !!invalidSelection ||
              !loaded ||
              (!panorama && (!crop || crop.width <= 0 || crop.height <= 0)) ||
              (panorama &&
                (!panoramaReady || (viewPreview.length > 0 && selectedViews.length === 0)))
            }
            aria-label={panorama ? (viewPreview.length ? '导出所选视角' : '截图') : '保存裁切图片'}
            className="flex items-center justify-center bg-[var(--af-info-bg)] text-[var(--af-text)] h-8 rounded-full px-4 gap-2 text-xs font-bold hover:bg-[var(--af-info-bg)] disabled:opacity-50 transition-colors"
          >
            {saving ? <Spinner size={16} className="animate-spin" /> : <Save size={16} />}
            {panorama
              ? viewPreview.length
                ? `导出 ${selectedViews.length} 个视角`
                : '截图'
              : saveLabel}
            {saving && grid && !panorama ? ` ${progress}/${rows * columns}` : ''}
          </button>
        </fieldset>
      </div>
      <button
        onClick={onClose}
        title="取消"
        aria-label="取消"
        className="absolute top-4 right-6 flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-full text-[var(--af-text)] transition-colors z-[60]"
      >
        <Close size={22} />
      </button>
      <div
        ref={stageRef}
        className="relative flex flex-1 min-h-0 items-center justify-center w-full overflow-hidden"
      >
        {!loaded && !error && (
          <Spinner size={40} className="animate-spin text-[var(--af-text-muted)]" />
        )}
        {loaded && panorama ? (
          <div
            className="relative flex items-center justify-center border-2 border-[var(--af-info)] shadow-[0_0_0_9999px_rgba(0,0,0,0.6),0_0_20px_rgba(0,0,0,0.8)] rounded-sm"
            onWheel={(event) => {
              event.stopPropagation();
              if (!saving)
                setFov((value) => Math.max(30, Math.min(120, value + Math.sign(event.deltaY) * 3)));
            }}
            style={panoramaSize}
          >
            <Boundary key={url}>
              <Canvas
                key={sceneVersion}
                flat
                gl={{
                  preserveDrawingBuffer: true,
                  toneMapping,
                  outputColorSpace: colorSpace,
                }}
                camera={{ fov: 75, near: 0.1, far: 1000 }}
              >
                <React.Suspense fallback={null}>
                  <Scene
                    url={url}
                    targetRatio={panoramaRatio}
                    onReady={onSceneReady}
                    fov={fov}
                    mirror={mirror}
                  />
                </React.Suspense>
              </Canvas>
            </Boundary>
            {viewPreview.length > 0 && (
              <div
                className="absolute inset-0 z-10 bg-[var(--af-input)] flex flex-col"
                aria-label="全景视角预览"
              >
                <div className="flex items-center justify-between px-3 py-2 text-xs text-[var(--af-text)]">
                  <span>检查分框构图，点击选择要导出的视角</span>
                  <button
                    onClick={() => {
                      setViewPreview([]);
                      setSelectedViews([]);
                    }}
                  >
                    返回全景调整
                  </button>
                </div>
                <div
                  className="grid flex-1 min-h-0 gap-px bg-[var(--af-info-bg)] border border-[var(--af-info)]"
                  style={{
                    gridTemplateColumns: `repeat(${viewPreview.length === 4 ? 2 : 4}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${viewPreview.length === 4 ? 2 : 3}, minmax(0, 1fr))`,
                  }}
                >
                  {viewPreview.map((view, index) => (
                    <button
                      key={index}
                      aria-label={`视角 ${index + 1}`}
                      aria-pressed={selectedViews.includes(index)}
                      className="relative min-h-0 overflow-hidden bg-[var(--af-input)]"
                      onClick={() =>
                        setSelectedViews((values) =>
                          values.includes(index)
                            ? values.filter((value) => value !== index)
                            : [...values, index].sort((a, b) => a - b),
                        )
                      }
                    >
                      <img
                        src={view.data}
                        alt={`视角 ${index + 1} 预览`}
                        className="w-full h-full object-contain"
                        style={{ opacity: selectedViews.includes(index) ? 1 : 0.35 }}
                      />
                      <span className="absolute top-2 left-2 rounded bg-[var(--af-surface)] px-2 py-1 text-xs text-[var(--af-text)]">
                        {selectedViews.includes(index) ? '✓ ' : ''}
                        {index + 1}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {guides && (
              <div
                aria-label="全景参考线"
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, transparent calc(33.333% - 0.5px), #ffffff70 33.333%, transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), #ffffff70 66.666%, transparent calc(66.666% + 0.5px)), linear-gradient(to bottom, transparent calc(33.333% - 0.5px), #ffffff70 33.333%, transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), #ffffff70 66.666%, transparent calc(66.666% + 0.5px))',
                }}
              />
            )}
            <div className="absolute top-2 left-2 text-[10px] text-[var(--af-info)] font-mono bg-[var(--af-surface)] px-1 rounded pointer-events-none">
              当前视角: {ratioLabel === 'Free' ? '16:9' : ratioLabel}
            </div>
          </div>
        ) : (
          <div
            className="relative shrink-0 select-none overflow-visible"
            style={{
              width: display.width + cropMargin * 2,
              height: display.height + cropMargin * 2,
            }}
          >
            <div
              className="absolute rounded-lg overflow-hidden shadow-2xl bg-[var(--af-input)]"
              style={{
                left: cropMargin,
                top: cropMargin,
                width: display.width,
                height: display.height,
                visibility: loaded ? 'visible' : 'hidden',
              }}
            >
              {url && (
                <img
                  src={url}
                  alt="Crop"
                  className="block pointer-events-none"
                  style={{ width: display.width, height: display.height }}
                />
              )}
            </div>
            <canvas
              ref={canvasRef}
              aria-label="裁切选择区域"
              className="absolute inset-0 cursor-crosshair touch-none z-10"
              style={{
                width: display.width + cropMargin * 2,
                height: display.height + cropMargin * 2,
                cursor:
                  hover === 'column'
                    ? 'col-resize'
                    : hover === 'row'
                      ? 'row-resize'
                      : hover === 'move'
                        ? 'move'
                        : hover
                          ? 'pointer'
                          : 'crosshair',
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onLostPointerCapture={pointerUp}
            />
          </div>
        )}
      </div>
      <div className="shrink-0 text-center text-[var(--af-text-muted)] text-xs font-medium">
        {panorama
          ? '鼠标拖拽旋转视角 • 滚轮缩放焦距 (FOV)'
          : grid
            ? '拖拽蓝色分割线可单独微调每一行或每一列，点击“恢复等分”可回到默认宫格'
            : '拖拽边缘调整区域，拖拽中心移动，或在空白处重新框选'}
      </div>
    </div>
  );
}
