export interface CropSize {
  width: number;
  height: number;
}
export interface CropPoint {
  x: number;
  y: number;
}
export interface CropRect extends CropSize, CropPoint {}
export type CropHandle = 'tl' | 'tr' | 'bl' | 'br' | 'tc' | 'bc' | 'ml' | 'mr';
export const cropMargin = 24;
export const cropRatios = [
  '1:1',
  '2:3',
  '3:2',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '5:4',
  '4:5',
  '21:9',
  '1:4',
  '1:8',
  '4:1',
  '8:1',
  '2:1',
];
export const equalCuts = (count: number) =>
  Array.from({ length: Math.max(0, count - 1) }, (_, index) => (index + 1) / count);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function cropRatio(label: string, source: CropSize): number | null {
  if (label === 'Free') return null;
  if (label === 'Original') return source.width / source.height;
  const [width, height] = label.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : null;
}
export function centeredCrop(size: CropSize, ratio: number | null, fill = 0.8): CropRect {
  const aspect = ratio || size.width / size.height;
  const width = Math.min(size.width * fill, size.height * fill * aspect),
    height = width / aspect;
  return {
    x: (size.width - width) / 2,
    y: (size.height - height) / 2,
    width,
    height,
  };
}
export function cropHandles(rect: CropRect): Array<CropPoint & { id: CropHandle }> {
  const { x, y, width: w, height: h } = rect;
  return [
    { id: 'tl', x, y },
    { id: 'tr', x: x + w, y },
    { id: 'bl', x, y: y + h },
    { id: 'br', x: x + w, y: y + h },
    { id: 'tc', x: x + w / 2, y },
    { id: 'bc', x: x + w / 2, y: y + h },
    { id: 'ml', x, y: y + h / 2 },
    { id: 'mr', x: x + w, y: y + h / 2 },
  ];
}
export function hitCrop(rect: CropRect, point: CropPoint): CropHandle | 'move' | null {
  const handle = cropHandles(rect).find(
    (handle) => Math.abs(handle.x - point.x) < 20 && Math.abs(handle.y - point.y) < 20,
  );
  if (handle) return handle.id;
  return point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height
    ? 'move'
    : null;
}
export function createCrop(
  start: CropPoint,
  end: CropPoint,
  size: CropSize,
  ratio: number | null,
): CropRect {
  const dx = end.x >= start.x ? 1 : -1,
    dy = end.y >= start.y ? 1 : -1;
  let width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y);
  if (ratio) {
    width = Math.min(
      width,
      dx > 0 ? size.width - start.x : start.x,
      (dy > 0 ? size.height - start.y : start.y) * ratio,
    );
    height = width / ratio;
  }
  return {
    x: dx > 0 ? start.x : start.x - width,
    y: dy > 0 ? start.y : start.y - height,
    width,
    height,
  };
}
export function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  point: CropPoint,
  size: CropSize,
  ratio: number | null,
): CropRect {
  const left = handle.includes('l'),
    right = handle.includes('r'),
    top = handle.includes('t'),
    bottom = handle.includes('b');
  let x = rect.x,
    y = rect.y,
    width = rect.width,
    height = rect.height;
  if (left) {
    x = clamp(point.x, 0, rect.x + rect.width - 1);
    width = rect.x + rect.width - x;
  }
  if (right) width = clamp(point.x - rect.x, 1, size.width - rect.x);
  if (top) {
    y = clamp(point.y, 0, rect.y + rect.height - 1);
    height = rect.y + rect.height - y;
  }
  if (bottom) height = clamp(point.y - rect.y, 1, size.height - rect.y);
  if (ratio) {
    if (left || right) height = width / ratio;
    else width = height * ratio;
    const maxWidth = left ? rect.x + rect.width : right ? size.width - rect.x : size.width;
    const maxHeight = top ? rect.y + rect.height : bottom ? size.height - rect.y : size.height;
    const factor = Math.min(1, maxWidth / width, maxHeight / height);
    width *= factor;
    height *= factor;
    x = left ? rect.x + rect.width - width : right ? rect.x : rect.x + (rect.width - width) / 2;
    y = top ? rect.y + rect.height - height : bottom ? rect.y : rect.y + (rect.height - height) / 2;
  }
  return {
    x: clamp(x, 0, size.width - width),
    y: clamp(y, 0, size.height - height),
    width,
    height,
  };
}
export function moveCrop(rect: CropRect, delta: CropPoint, size: CropSize): CropRect {
  return {
    ...rect,
    x: clamp(rect.x + delta.x, 0, size.width - rect.width),
    y: clamp(rect.y + delta.y, 0, size.height - rect.height),
  };
}
export function moveCropCut(
  cuts: number[],
  index: number,
  position: number,
  length: number,
): number[] {
  const before = cuts[index - 1] ?? 0,
    after = cuts[index + 1] ?? 1;
  const gap = Math.min(24 / Math.max(1, length), (after - before) / 3);
  return cuts.map((value, i) => (i === index ? clamp(position, before + gap, after - gap) : value));
}
export function cropSegments(start: number, length: number, cuts: number[], gap: number) {
  const boundaries = [start, ...cuts.map((cut) => start + cut * length), start + length];
  const maximumGap = Math.min(
    ...boundaries.slice(1).map((value, index) => {
      const deduction = (index > 0 ? 0.5 : 0) + (index < boundaries.length - 2 ? 0.5 : 0);
      return deduction ? (value - boundaries[index] - 1) / deduction : Infinity;
    }),
  );
  const safeGap = Math.max(0, Math.min(gap, maximumGap));
  return boundaries.slice(0, -1).map((value, index) => {
    const first = value + (index > 0 ? safeGap / 2 : 0),
      last = boundaries[index + 1] - (index < boundaries.length - 2 ? safeGap / 2 : 0);
    return { start: first, size: Math.max(0, last - first) };
  });
}
export interface CropOutput {
  data: string;
  width: number;
  height: number;
  row: number;
  column: number;
}
export function cropOutputRects(
  rect: CropRect,
  display: CropSize,
  source: CropSize,
  rowCuts: number[],
  columnCuts: number[],
  rowGap: number,
  columnGap: number,
) {
  const xScale = source.width / display.width,
    yScale = source.height / display.height;
  const columns = cropSegments(rect.x * xScale, rect.width * xScale, columnCuts, columnGap);
  const rows = cropSegments(rect.y * yScale, rect.height * yScale, rowCuts, rowGap);
  const pixels = (segment: { start: number; size: number }, limit: number) => {
    const start = clamp(Math.round(segment.start), 0, limit),
      end = clamp(Math.round(segment.start + segment.size), 0, limit);
    if (end <= start) throw new Error('裁切范围太小，无法为每个分块保留至少一个像素。');
    return { start, size: end - start };
  };
  return {
    columns: columns.map((part) => pixels(part, source.width)),
    rows: rows.map((part) => pixels(part, source.height)),
  };
}
