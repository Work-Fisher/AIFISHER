export interface Point {
  x: number;
  y: number;
}
export interface Curve {
  start: Point;
  end: Point;
  side?: 'left' | 'right';
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function controls(curve: Curve) {
  const distance = (Math.abs(curve.end.x - curve.start.x) / 2) * (curve.side === 'left' ? -1 : 1);
  return [
    { x: curve.start.x + distance, y: curve.start.y },
    { x: curve.end.x - distance, y: curve.end.y },
  ];
}
export function edgePath(curve: Curve) {
  const [first, second] = controls(curve);
  return `M ${curve.start.x} ${curve.start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${curve.end.x} ${curve.end.y}`;
}
export function edgePoint(curve: Curve, progress: number): Point {
  const [first, second] = controls(curve),
    remaining = 1 - progress;
  const axis = (name: 'x' | 'y') =>
    remaining ** 3 * curve.start[name] +
    3 * remaining ** 2 * progress * first[name] +
    3 * remaining * progress ** 2 * second[name] +
    progress ** 3 * curve.end[name];
  return { x: axis('x'), y: axis('y') };
}
export function edgeLength(curve: Curve) {
  let length = 0,
    previous = curve.start;
  for (let index = 1; index <= 18; index++) {
    const point = edgePoint(curve, index / 18);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}
export function edgePhase(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index++)
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  return Math.abs(hash % 1000) / 1000;
}
export function edgeFlowSegments(curve: Curve, head: number, span: number) {
  const progress = ((head % 1) + 1) % 1,
    tail = progress - span;
  const ranges =
    tail >= 0
      ? [[tail, progress]]
      : [
          [1 + tail, 1],
          [0, progress],
        ];
  return ranges.flatMap(([from, to]) => {
    const start = clamp(from, 0, 1),
      end = clamp(to, 0, 1),
      distance = end - start;
    if (distance <= 0.003) return [];
    const steps = Math.max(8, Math.ceil(distance * 28));
    const points = Array.from({ length: steps + 1 }, (_, index) =>
      edgePoint(curve, start + (distance * index) / steps),
    );
    return [
      {
        path: points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
        tail: points[0],
        head: points[points.length - 1],
      },
    ];
  });
}
