import type { CanvasPositionedNode } from './canvasEditing';
import type { CanvasNodeMeasurer } from './canvasLayout';

export interface AlignmentGuide {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
}

/** Align the selection bounds while preserving distances between its members. */
export function alignCanvasDrag<T extends CanvasPositionedNode>(
  nodes: readonly T[],
  ids: readonly string[],
  measure: CanvasNodeMeasurer<T>,
  delta: { x: number; y: number },
  zoom: number,
  threshold = 6,
) {
  const result = { x: delta.x, y: delta.y, guides: [] as AlignmentGuide[] };
  if (!Number.isFinite(zoom) || zoom <= 0 || !ids.length) return result;
  const moving = new Set(ids);
  const frames = nodes
    .map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: measure.getWidth(node),
      height: measure.getHeight(node),
    }))
    .filter(
      (f) => [f.x, f.y, f.width, f.height].every(Number.isFinite) && f.width > 0 && f.height > 0,
    );
  const selected = frames.filter((f) => moving.has(f.id));
  if (!selected.length) return result;
  const left = Math.min(...selected.map((f) => f.x)) + delta.x;
  const top = Math.min(...selected.map((f) => f.y)) + delta.y;
  const right = Math.max(...selected.map((f) => f.x + f.width)) + delta.x;
  const bottom = Math.max(...selected.map((f) => f.y + f.height)) + delta.y;
  const bounds = { x: [left, (left + right) / 2, right], y: [top, (top + bottom) / 2, bottom] };
  for (const axis of ['x', 'y'] as const) {
    let best: { distance: number; guide: AlignmentGuide } | undefined;
    for (const f of frames) {
      if (moving.has(f.id)) continue;
      const targets =
        axis === 'x'
          ? [f.x, f.x + f.width / 2, f.x + f.width]
          : [f.y, f.y + f.height / 2, f.y + f.height];
      for (const target of targets)
        for (const origin of bounds[axis]) {
          const distance = target - origin;
          if (
            Math.abs(distance) > threshold / zoom ||
            (best && Math.abs(distance) >= Math.abs(best.distance))
          )
            continue;
          best = {
            distance,
            guide: {
              axis,
              position: target,
              start: axis === 'x' ? Math.min(top, f.y) : Math.min(left, f.x),
              end: axis === 'x' ? Math.max(bottom, f.y + f.height) : Math.max(right, f.x + f.width),
            },
          };
        }
    }
    if (best) {
      result[axis] += best.distance;
      result.guides.push(best.guide);
    }
  }
  return result;
}
