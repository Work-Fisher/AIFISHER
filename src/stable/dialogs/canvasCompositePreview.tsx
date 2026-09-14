import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import { activateModal } from '../design/modalFocus';
import {
  cloneScene,
  createCompositeHistory,
  defaultTransform,
  drawComposite,
  hitCompositeLayer,
  hitCompositeCorner,
  resizeCompositeCorner,
  compositeDimensions,
  initialCompositeScene,
  scaleCompositeLayer,
  serializedCompositeLayout,
  type CompositeLayer,
  type LayerTransform,
} from './compositeScene';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'useRef' | 'useState' | 'useEffect' | 'useCallback'
>;
interface Payload {
  nodeId: string;
  layers: { nodeId: string; url: string; title?: string }[];
  layout?: Record<string, Partial<LayerTransform>>;
  onSave(
    nodeId: string,
    data: string,
    layout: Record<string, LayerTransform>,
  ): unknown | Promise<unknown>;
}
interface Props {
  saveLabel?: string;
  payload: Payload | null;
  onClose(): void;
}
interface Icons {
  layers: CanvasComponent;
  up: CanvasComponent;
  down: CanvasComponent;
  save: CanvasComponent;
  close: CanvasComponent;
}
const controlButton =
  'px-2 h-7 rounded-full text-[10px] font-bold text-[var(--af-text-secondary)] hover:text-[var(--af-text)] bg-[var(--af-surface-raised)] hover:bg-[var(--af-hover)] transition-colors flex items-center justify-center disabled:opacity-20';
const numberClass =
  'w-16 bg-[var(--af-input)] text-[var(--af-text-secondary)] text-xs rounded px-2 py-1 outline-none border border-[#333] focus:border-[var(--af-info)] text-right';
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function CanvasCompositePreview(
  React: Runtime,
  { payload, onClose, saveLabel = '保存' }: Props,
  icons: Icons,
) {
  const root = React.useRef<HTMLDivElement>(null),
    viewport = React.useRef<HTMLDivElement>(null),
    canvas = React.useRef<HTMLCanvasElement>(null);
  const [layers, setLayers] = React.useState<CompositeLayer[]>([]),
    [loading, setLoading] = React.useState(false),
    [loadError, setLoadError] = React.useState(''),
    [saveError, setSaveError] = React.useState(''),
    [saving, setSaving] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null),
    [revision, refresh] = React.useState(0),
    [rotationDraft, setRotationDraft] = React.useState<string | null>(null),
    [scaleDraft, setScaleDraft] = React.useState<string | null>(null);
  const history = React.useRef(createCompositeHistory({ order: [], layout: {} }));
  const [view, setView] = React.useState({ x: 0, y: 0, scale: 1 });
  const viewRef = React.useRef(view);
  const close = React.useRef(onClose);
  close.current = onClose;
  const epoch = React.useRef(0),
    saveLock = React.useRef(false);
  const drag = React.useRef<{
    id: number;
    mode: 'pan' | 'layer';
    nodeId?: string;
    x: number;
    y: number;
    originX: number;
    originY: number;
    corner?: number;
    before?: LayerTransform;
  } | null>(null);
  const width = Math.max(1, ...layers.map((layer) => layer.width)),
    height = Math.max(1, ...layers.map((layer) => layer.height));
  const updateView = React.useCallback((next: typeof view) => {
    viewRef.current = next;
    setView(next);
  }, []);
  const fit = React.useCallback(() => {
    const element = viewport.current;
    if (!element || !layers.length) return;
    const scale = Math.min(
      Math.max(element.clientWidth - 80, 100) / width,
      Math.max(element.clientHeight - 200, 100) / height,
    );
    updateView({
      x: (element.clientWidth - width * scale) / 2,
      y: (element.clientHeight - height * scale) / 2,
      scale,
    });
  }, [height, layers.length, updateView, width]);
  const zoom = React.useCallback(
    (factor: number, x?: number, y?: number) => {
      const element = viewport.current;
      if (!element) return;
      const current = viewRef.current,
        scale = clamp(current.scale * factor, 0.05, 20),
        ax = x ?? element.clientWidth / 2,
        ay = y ?? element.clientHeight / 2;
      updateView({
        scale,
        x: ax - ((ax - current.x) / current.scale) * scale,
        y: ay - ((ay - current.y) / current.scale) * scale,
      });
    },
    [updateView],
  );
  React.useEffect(() => {
    const session = ++epoch.current;
    setLayers([]);
    setSelected(null);
    setRotationDraft(null);
    setScaleDraft(null);
    setLoadError('');
    setSaveError('');
    setSaving(false);
    saveLock.current = false;
    drag.current = null;
    history.current = createCompositeHistory({ order: [], layout: {} });
    if (!payload) return;
    setLoading(true);
    const requests: { image: HTMLImageElement; cancel(): void }[] = [];
    const pending = payload.layers.map(
      (layer) =>
        new Promise<CompositeLayer | null>((resolve) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          requests.push({ image, cancel: () => resolve(null) });
          image.onload = () =>
            resolve(
              image.naturalWidth && image.naturalHeight
                ? { ...layer, image, width: image.naturalWidth, height: image.naturalHeight }
                : null,
            );
          image.onerror = () => resolve(null);
          image.src = layer.url;
        }),
    );
    void Promise.all(pending).then((results) => {
      if (epoch.current !== session) return;
      const loaded = results.filter((layer): layer is CompositeLayer => !!layer);
      history.current = createCompositeHistory(initialCompositeScene(loaded, payload.layout));
      setLayers(loaded);
      setSelected(loaded.at(-1)?.nodeId ?? null);
      setLoading(false);
      if (loaded.length !== payload.layers.length || !loaded.length)
        setLoadError('部分图层读取失败，请关闭后重试。');
      refresh((value) => value + 1);
    });
    return () => {
      epoch.current = session + 1;
      requests.forEach(({ image, cancel }) => {
        image.onload = null;
        image.onerror = null;
        cancel();
      });
    };
  }, [payload]);
  React.useEffect(() => {
    if (!payload || !root.current || !viewport.current) return;
    const release = activateModal(root.current, () => close.current());
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      zoom(
        event.deltaY > 0 ? 1 / 1.15 : 1.15,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      release();
      element.removeEventListener('wheel', wheel);
      drag.current = null;
    };
  }, [payload, zoom]);
  React.useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
  React.useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context) drawComposite(context, layers, history.current.scene, selected);
  }, [layers, revision, selected, width, height]);
  if (!payload) return null;
  const scene = history.current.scene,
    transform = selected ? scene.layout[selected] : null;
  const render = () => refresh((value) => value + 1);
  const end = () => {
    history.current.end();
    render();
  };
  const undo = () => {
    history.current.undo();
    setRotationDraft(null);
    setScaleDraft(null);
    render();
  };
  const redo = () => {
    history.current.redo();
    setRotationDraft(null);
    setScaleDraft(null);
    render();
  };
  const select = (id: string | null) => {
    end();
    setSelected(id);
    setRotationDraft(null);
    setScaleDraft(null);
  };
  const changeLayer = (next: LayerTransform) => {
    if (!selected || saveLock.current) return;
    history.current.update({
      ...history.current.scene,
      layout: { ...history.current.scene.layout, [selected]: next },
    });
    render();
  };
  const rotate = (value: number) => {
    const current = selected && history.current.scene.layout[selected];
    if (current) changeLayer({ ...current, rotation: clamp(value, -180, 180) });
  };
  const scaleLayer = (value: number) => {
    const layer = layers.find((item) => item.nodeId === selected),
      current = selected && history.current.scene.layout[selected];
    if (layer && current) changeLayer(scaleCompositeLayer(layer, current, value));
  };
  const reorder = (id: string, delta: number) => {
    if (saveLock.current) return;
    history.current.end();
    const next = cloneScene(history.current.scene),
      index = next.order.indexOf(id),
      target = index + delta;
    if (index < 0 || target < 0 || target >= next.order.length) return;
    [next.order[index], next.order[target]] = [next.order[target], next.order[index]];
    history.current.update(next);
    setSelected(id);
    render();
  };
  const save = async () => {
    if (saveLock.current || loading || loadError || !layers.length) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError('');
    history.current.end();
    const session = epoch.current,
      captured = cloneScene(history.current.scene);
    try {
      const output = document.createElement('canvas');
      output.width = width;
      output.height = height;
      const context = output.getContext('2d');
      if (!context) throw new Error('无法创建合成图片');
      drawComposite(context, layers, captured);
      const data = output.toDataURL('image/png');
      await payload.onSave(payload.nodeId, data, serializedCompositeLayout(captured));
      if (epoch.current === session) close.current();
    } catch (error) {
      if (epoch.current === session)
        setSaveError(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      if (epoch.current === session) {
        saveLock.current = false;
        setSaving(false);
      }
    }
  };
  const releasePointer = (event: ReactTypes.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    end();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const IconLayers = icons.layers,
    IconUp = icons.up,
    IconDown = icons.down,
    IconSave = icons.save,
    IconClose = icons.close;
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="图片合成"
      tabIndex={-1}
      className="fixed inset-0 z-[1000] bg-[var(--af-input)] backdrop-blur-xl flex"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const editing =
          event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable="true"]');
        if (!editing && !saveLock.current && (event.ctrlKey || event.metaKey)) {
          if (event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
          } else if (event.key.toLowerCase() === 'y') {
            event.preventDefault();
            redo();
          }
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
      <div
        className="w-[300px] bg-[var(--af-surface-raised)] border-r border-[var(--af-border)] flex flex-col p-6 overflow-hidden"
        style={{ flexShrink: 0, width: 'min(300px, 30vw)', padding: 'clamp(10px, 2vw, 24px)' }}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[var(--af-text)] font-bold flex items-center gap-2">
            <IconLayers size={18} className="text-[var(--af-info)]" />
            图层面板
          </h3>
          <span className="text-xs text-[var(--af-text-muted)]">{layers.length} 层</span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
          {[...scene.order].reverse().map((id, index) => {
            const layer = layers.find((item) => item.nodeId === id)!,
              value = scene.layout[id];
            return (
              <div
                key={id}
                data-fisherai-composite-layer={id}
                role="group"
                aria-label={layer.title || '未命名图层'}
                className={
                  'group relative p-3 rounded-lg border transition-all cursor-pointer ' +
                  (selected === id
                    ? 'bg-[var(--af-hover)] border-[var(--af-info)] shadow-lg'
                    : 'bg-transparent border-[var(--af-border)] hover:bg-[var(--af-hover)]')
                }
                onClick={() => select(id)}
              >
                <button
                  className="text-xs font-bold text-[var(--af-text)] truncate"
                  onClick={() => select(id)}
                >
                  {layer.title || '未命名图层'}
                </button>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--af-text-muted)]">
                    {layer.width}×{layer.height}
                    {value.scale !== 1 ? ` @${Math.round(value.scale * 100)}%` : ''}
                    {value.rotation !== 0 ? ` ${Math.round(value.rotation)}°` : ''}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      title="上移一层"
                      aria-label="上移一层"
                      disabled={index === 0 || saving}
                      className={controlButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        reorder(id, 1);
                      }}
                    >
                      <IconUp size={12} />
                    </button>
                    <button
                      title="下移一层"
                      aria-label="下移一层"
                      disabled={index === scene.order.length - 1 || saving}
                      className={controlButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        reorder(id, -1);
                      }}
                    >
                      <IconDown size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex-1 relative flex flex-col overflow-hidden" style={{ minWidth: 0 }}>
        <button
          onClick={onClose}
          title="取消"
          aria-label="取消"
          className="absolute top-4 right-6 flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--af-hover)] hover:bg-[var(--af-hover)] rounded-full text-[var(--af-text)] transition-colors z-[1001]"
        >
          <IconClose size={22} />
        </button>
        <button
          type="button"
          disabled={saving || loading || !!loadError || !layers.length}
          onClick={() => void save()}
          className="absolute bottom-5 right-6 z-50 flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--af-primary)] text-[var(--af-on-primary)] text-sm disabled:opacity-40"
        >
          <IconSave size={16} />
          {saving ? '保存中…' : saveLabel}
        </button>
        {selected && transform && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 w-max max-w-[calc(100%-88px)]">
            <div
              className="flex min-h-11 items-center gap-1 px-2 py-1.5 rounded-full bg-[var(--af-surface-raised)] backdrop-blur shadow-lg border border-[var(--af-border)]"
              style={{ flexWrap: 'wrap', justifyContent: 'center' }}
            >
              <button
                title="撤销 Ctrl+Z"
                aria-label="撤销"
                disabled={!history.current.canUndo || saving}
                className={controlButton}
                onClick={undo}
              >
                ↶
              </button>
              <button
                title="重做 Ctrl+Shift+Z"
                aria-label="重做"
                disabled={!history.current.canRedo || saving}
                className={controlButton}
                onClick={redo}
              >
                ↷
              </button>
              <span className="text-[10px] text-[var(--af-text-muted)]">旋转</span>
              <input
                aria-label="图层旋转"
                type="range"
                min={-180}
                max={180}
                step="any"
                value={transform.rotation}
                disabled={saving}
                onPointerDown={() => history.current.begin()}
                onChange={(event) => rotate(Number(event.target.value))}
                onPointerUp={end}
                onPointerCancel={end}
                className="w-20 accent-blue-500 cursor-pointer"
              />
              <input
                aria-label="图层旋转数值"
                type="number"
                min={-180}
                max={180}
                step={0.1}
                value={rotationDraft ?? transform.rotation.toFixed(1)}
                disabled={saving}
                onFocus={() => history.current.begin()}
                onChange={(event) => {
                  const value = event.target.value;
                  setRotationDraft(value);
                  if (value !== '' && Number.isFinite(Number(value))) rotate(Number(value));
                }}
                onBlur={() => {
                  end();
                  setRotationDraft(null);
                }}
                className={numberClass}
              />
              <span className="text-[10px] text-[var(--af-text)]">°</span>
              <span className="text-[10px] text-[var(--af-text-muted)]">缩放</span>
              <input
                aria-label="图层缩放"
                type="range"
                min={20}
                max={200}
                step="any"
                value={transform.scale * 100}
                disabled={saving}
                onPointerDown={() => history.current.begin()}
                onChange={(event) => scaleLayer(Number(event.target.value) / 100)}
                onPointerUp={end}
                onPointerCancel={end}
                className="w-20 accent-blue-500 cursor-pointer"
              />
              <input
                aria-label="图层缩放数值"
                type="number"
                min={20}
                max={200}
                step={0.1}
                value={scaleDraft ?? (transform.scale * 100).toFixed(1)}
                disabled={saving}
                onFocus={() => history.current.begin()}
                onChange={(event) => {
                  const value = event.target.value;
                  setScaleDraft(value);
                  if (value !== '' && Number.isFinite(Number(value)))
                    scaleLayer(Number(value) / 100);
                }}
                onBlur={() => {
                  end();
                  setScaleDraft(null);
                }}
                className={numberClass}
              />
              <span className="text-[10px] text-[var(--af-text)]">%</span>
              <span className="text-[10px] text-[var(--af-text-muted)]">X</span>
              <span className="text-[10px] text-[var(--af-text)] font-mono">
                {Math.round(transform.x)}
              </span>
              <span className="text-[10px] text-[var(--af-text-muted)]">Y</span>
              <span className="text-[10px] text-[var(--af-text)] font-mono">
                {Math.round(transform.y)}
              </span>
              <button
                className={controlButton}
                disabled={saving}
                onClick={() => changeLayer(defaultTransform())}
              >
                复位
              </button>
            </div>
          </div>
        )}
        <div
          ref={viewport}
          data-fisherai-composite-viewport="true"
          className="flex-1 relative overflow-hidden bg-transparent"
          onPointerDown={(event) => {
            if (![0, 1].includes(event.button) || saveLock.current) return;
            event.preventDefault();
            root.current?.focus({ preventScroll: true });
            const current = viewRef.current,
              bounds = event.currentTarget.getBoundingClientRect();
            if (event.button === 1)
              drag.current = {
                id: event.pointerId,
                mode: 'pan',
                x: event.clientX,
                y: event.clientY,
                originX: current.x,
                originY: current.y,
              };
            else {
              const x = (event.clientX - bounds.left - current.x) / current.scale,
                y = (event.clientY - bounds.top - current.y) / current.scale;
              const currentScene = history.current.scene,
                selectedLayer = layers.find((item) => item.nodeId === selected),
                corner =
                  selectedLayer && selected
                    ? hitCompositeCorner(
                        selectedLayer,
                        currentScene.layout[selected],
                        x,
                        y,
                        12 / current.scale,
                      )
                    : -1,
                id =
                  corner >= 0 && selected
                    ? selected
                    : [...currentScene.order].reverse().find((key) => {
                        const layer = layers.find((item) => item.nodeId === key);
                        return layer && hitCompositeLayer(layer, currentScene.layout[key], x, y);
                      });
              select(id ?? null);
              if (!id) return;
              history.current.begin();
              const value = currentScene.layout[id];
              drag.current = {
                id: event.pointerId,
                mode: 'layer',
                nodeId: id,
                x: event.clientX,
                y: event.clientY,
                originX: value.x,
                originY: value.y,
                corner,
                before: { ...value },
              };
            }
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const active = drag.current;
            if (!active || active.id !== event.pointerId || saveLock.current) return;
            const current = viewRef.current,
              dx = event.clientX - active.x,
              dy = event.clientY - active.y;
            if (active.mode === 'pan')
              updateView({ ...current, x: active.originX + dx, y: active.originY + dy });
            else {
              const id = active.nodeId!,
                layer = layers.find((item) => item.nodeId === id)!,
                value = history.current.scene.layout[id];
              const size = compositeDimensions(layer, value);
              history.current.update({
                ...history.current.scene,
                layout: {
                  ...history.current.scene.layout,
                  [id]:
                    active.corner !== undefined && active.corner >= 0 && active.before
                      ? resizeCompositeCorner(
                          layer,
                          active.before,
                          active.corner,
                          dx / current.scale,
                          dy / current.scale,
                          event.shiftKey,
                          event.altKey,
                        )
                      : {
                          ...value,
                          x: clamp(
                            active.originX + dx / current.scale,
                            Math.min(0, width - size.width),
                            Math.max(0, width - size.width),
                          ),
                          y: clamp(
                            active.originY + dy / current.scale,
                            Math.min(0, height - size.height),
                            Math.max(0, height - size.height),
                          ),
                        },
                },
              });
              render();
            }
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onLostPointerCapture={releasePointer}
        >
          <div
            className="relative rounded-lg border border-[var(--af-border)] shadow-2xl"
            data-fisherai-composite-transform="true"
            style={{
              width,
              height,
              left: 0,
              top: 0,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: '0 0',
            }}
          >
            <div
              className="absolute inset-0 rounded-lg overflow-hidden"
              style={{
                backgroundImage:
                  'linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              }}
            />
            <canvas
              ref={canvas}
              width={width}
              height={height}
              aria-label="合成画面"
              className="absolute inset-0 z-10 rounded-lg"
            />
          </div>
        </div>
        {(loading || loadError || saveError) && (
          <div
            role={loadError || saveError ? 'alert' : 'status'}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 text-[var(--af-text)] bg-[var(--af-surface)] rounded-lg px-4 py-2"
          >
            {saveError || loadError || '正在读取图层…'}
          </div>
        )}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[var(--af-surface)] backdrop-blur-md rounded-full px-4 py-2.5 z-50 border border-[var(--af-border)] shadow-2xl">
          <button
            title="缩小"
            aria-label="缩小"
            className={controlButton}
            onClick={() => zoom(1 / 1.15)}
          >
            −
          </button>
          <span className="text-[var(--af-text)] text-[13px] font-bold min-w-[54px] text-center font-mono">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            title="放大"
            aria-label="放大"
            className={controlButton}
            onClick={() => zoom(1.15)}
          >
            +
          </button>
          <button className={controlButton} title="重置视图" onClick={fit}>
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
