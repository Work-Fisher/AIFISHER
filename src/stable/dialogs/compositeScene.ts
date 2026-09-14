export interface LayerTransform {
  zIndex?: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  stretchX?: number;
  stretchY?: number;
}
export interface CompositeLayer {
  nodeId: string;
  url: string;
  title?: string;
  image: HTMLImageElement;
  width: number;
  height: number;
}
export interface CompositeScene {
  layout: Record<string, LayerTransform>;
  order: string[];
}
export const defaultTransform = (): LayerTransform => ({ x: 0, y: 0, rotation: 0, scale: 1 });
export const cloneScene = (scene: CompositeScene): CompositeScene => ({
  order: [...scene.order],
  layout: Object.fromEntries(Object.entries(scene.layout).map(([id, value]) => [id, { ...value }])),
});
const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export function initialCompositeScene(
  layers: CompositeLayer[],
  saved?: Record<string, Partial<LayerTransform>>,
): CompositeScene {
  const defaultOrder = [...layers]
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .map((layer) => layer.nodeId);
  const highestSaved = Math.max(-1, ...defaultOrder.map((id) => finite(saved?.[id]?.zIndex, -1)));
  const rank = (id: string) =>
    finite(saved?.[id]?.zIndex, highestSaved + 1 + defaultOrder.indexOf(id));
  return {
    order: defaultOrder.slice().sort((a, b) => rank(a) - rank(b)),
    layout: Object.fromEntries(
      layers.map((layer) => {
        const previous = saved?.[layer.nodeId];
        return [
          layer.nodeId,
          {
            x: finite(previous?.x, 0),
            y: finite(previous?.y, 0),
            rotation: Math.max(-180, Math.min(180, finite(previous?.rotation, 0))),
            scale: Math.max(0.2, Math.min(2, finite(previous?.scale, 1))),
            ...(previous?.stretchX === undefined
              ? {}
              : { stretchX: Math.max(0.05, Math.min(20, finite(previous.stretchX, 1))) }),
            ...(previous?.stretchY === undefined
              ? {}
              : { stretchY: Math.max(0.05, Math.min(20, finite(previous.stretchY, 1))) }),
          },
        ];
      }),
    ),
  };
}
export function hitCompositeLayer(
  layer: CompositeLayer,
  transform: LayerTransform,
  x: number,
  y: number,
) {
  const { width, height } = compositeDimensions(layer, transform);
  const angle = (-transform.rotation * Math.PI) / 180,
    dx = x - transform.x - width / 2,
    dy = y - transform.y - height / 2;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle),
    localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
}
export function scaleCompositeLayer(
  layer: CompositeLayer,
  transform: LayerTransform,
  next: number,
): LayerTransform {
  const scale = Math.max(0.2, Math.min(2, next));
  return {
    ...transform,
    scale,
    x: transform.x + (layer.width * (transform.stretchX ?? 1) * (transform.scale - scale)) / 2,
    y: transform.y + (layer.height * (transform.stretchY ?? 1) * (transform.scale - scale)) / 2,
  };
}
/** Render export and editor from the same scene; selection is never included in saved pixels. */
export function drawComposite(
  context: CanvasRenderingContext2D,
  layers: CompositeLayer[],
  scene: CompositeScene,
  selected: string | null = null,
) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  const draw = (id: string, selection: boolean) => {
    const layer = layers.find((item) => item.nodeId === id),
      transform = scene.layout[id];
    if (!layer || !transform) return;
    const { width, height } = compositeDimensions(layer, transform);
    context.save();
    context.translate(transform.x + width / 2, transform.y + height / 2);
    context.rotate((transform.rotation * Math.PI) / 180);
    if (!selection) context.drawImage(layer.image, -width / 2, -height / 2, width, height);
    else {
      context.strokeStyle = '#3b82f6';
      context.lineWidth = 2;
      context.setLineDash([6, 3]);
      context.strokeRect(-width / 2, -height / 2, width, height);
      context.setLineDash([]);
      context.fillStyle = '#3b82f6';
      context.strokeStyle = 'white';
      context.lineWidth = 1;
      for (const [sx, sy] of compositeCorners) {
        context.fillRect((sx * width) / 2 - 5, (sy * height) / 2 - 5, 10, 10);
        context.strokeRect((sx * width) / 2 - 5, (sy * height) / 2 - 5, 10, 10);
      }
    }
    context.restore();
  };
  scene.order.forEach((id) => draw(id, false));
  if (selected) draw(selected, true);
}
const compositeCorners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
export function compositeDimensions(
  layer: Pick<CompositeLayer, 'width' | 'height'>,
  transform: LayerTransform,
) {
  return {
    width: layer.width * transform.scale * (transform.stretchX ?? 1),
    height: layer.height * transform.scale * (transform.stretchY ?? 1),
  };
}
export function hitCompositeCorner(
  layer: CompositeLayer,
  transform: LayerTransform,
  x: number,
  y: number,
  radius: number,
) {
  const { width, height } = compositeDimensions(layer, transform),
    angle = (transform.rotation * Math.PI) / 180;
  return compositeCorners.findIndex(([sx, sy]) => {
    const dx = (sx * width) / 2,
      dy = (sy * height) / 2;
    return (
      Math.hypot(
        x - (transform.x + width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle)),
        y - (transform.y + height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)),
      ) <= radius
    );
  });
}
export function resizeCompositeCorner(
  layer: CompositeLayer,
  before: LayerTransform,
  corner: number,
  dx: number,
  dy: number,
  free: boolean,
  centered: boolean,
): LayerTransform {
  const [sx, sy] = compositeCorners[corner],
    { width, height } = compositeDimensions(layer, before);
  const angle = (before.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const factor = centered ? 2 : 1;
  let nextWidth = Math.max(
    1,
    Math.min(layer.width * 20, width + (dx * cos + dy * sin) * sx * factor),
  );
  let nextHeight = Math.max(
    1,
    Math.min(layer.height * 20, height + (-dx * sin + dy * cos) * sy * factor),
  );
  if (!free) {
    const ratio =
      Math.abs(nextWidth / width - 1) > Math.abs(nextHeight / height - 1)
        ? nextWidth / width
        : nextHeight / height;
    nextWidth = width * ratio;
    nextHeight = height * ratio;
  }
  const shiftX = centered ? 0 : (sx * (nextWidth - width)) / 2;
  const shiftY = centered ? 0 : (sy * (nextHeight - height)) / 2;
  return {
    ...before,
    stretchX: nextWidth / (layer.width * before.scale),
    stretchY: nextHeight / (layer.height * before.scale),
    x: before.x + width / 2 + shiftX * cos - shiftY * sin - nextWidth / 2,
    y: before.y + height / 2 + shiftX * sin + shiftY * cos - nextHeight / 2,
  };
}
/** Synchronous history includes layer order, so consecutive events cannot see a stale React render. */
export function createCompositeHistory(initial: CompositeScene) {
  let current = cloneScene(initial),
    undo: CompositeScene[] = [],
    redo: CompositeScene[] = [],
    checkpoint: CompositeScene | null = null;
  const equal = (a: CompositeScene, b: CompositeScene) => JSON.stringify(a) === JSON.stringify(b);
  const record = (before: CompositeScene) => {
    undo = [...undo, cloneScene(before)].slice(-50);
    redo = [];
  };
  return {
    get scene() {
      return current;
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    begin() {
      checkpoint ??= cloneScene(current);
    },
    update(next: CompositeScene) {
      if (equal(current, next)) return;
      if (!checkpoint) record(current);
      current = cloneScene(next);
    },
    end() {
      if (checkpoint && !equal(checkpoint, current)) record(checkpoint);
      checkpoint = null;
    },
    undo() {
      this.end();
      const previous = undo.pop();
      if (!previous) return;
      redo = [...redo, cloneScene(current)].slice(-50);
      current = previous;
    },
    redo() {
      this.end();
      const next = redo.pop();
      if (!next) return;
      undo = [...undo, cloneScene(current)].slice(-50);
      current = next;
    },
  };
}

export function serializedCompositeLayout(scene: CompositeScene): Record<string, LayerTransform> {
  return Object.fromEntries(scene.order.map((id, zIndex) => [id, { ...scene.layout[id], zIndex }]));
}
