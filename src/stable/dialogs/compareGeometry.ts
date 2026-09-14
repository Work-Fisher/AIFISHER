interface Point {
  x: number;
  y: number;
}
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const normal = (angle: number): Point => ({
  x: Math.cos((angle * Math.PI) / 180),
  y: Math.sin((angle * Math.PI) / 180),
});
const rectangle = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];
function projection(width: number, height: number, axis: Point) {
  const values = rectangle(width, height).map((point) => dot(point, axis));
  return { min: Math.min(...values), max: Math.max(...values) };
}
export function comparePosition(
  width: number,
  height: number,
  angle: number,
  x: number,
  y: number,
) {
  const axis = normal(angle),
    range = projection(width, height, axis);
  return Math.max(
    0,
    Math.min(
      100,
      ((dot({ x, y }, axis) - range.min) / Math.max(range.max - range.min, 1e-4)) * 100,
    ),
  );
}
/** Clip the image rectangle against the movable diagonal divider half-plane. */
export function compareGeometry(width: number, height: number, angle: number, position: number) {
  const axis = normal(angle),
    range = projection(width, height, axis),
    threshold = range.min + ((range.max - range.min) * position) / 100;
  const corners = rectangle(width, height),
    polygon: Point[] = [];
  for (let index = 0; index < corners.length; index++) {
    const from = corners[index],
      to = corners[(index + 1) % corners.length];
    const a = dot(from, axis) - threshold,
      b = dot(to, axis) - threshold;
    const insideA = a <= 1e-4,
      insideB = b <= 1e-4;
    if (insideA) polygon.push(from);
    if (insideA !== insideB && Math.abs(a - b) > 1e-4) {
      const ratio = a / (a - b);
      polygon.push({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio });
    }
  }
  const center = { x: width / 2, y: height / 2 },
    distance = dot(center, axis) - threshold;
  const pivot = { x: center.x - axis.x * distance, y: center.y - axis.y * distance };
  const tangent = { x: -axis.y, y: axis.x },
    lineLength = Math.hypot(width, height) * 2.4;
  return {
    polygon,
    clipPath: polygon.length
      ? `polygon(${polygon.map((point) => `${point.x}px ${point.y}px`).join(', ')})`
      : 'polygon(0 0, 0 0, 0 0)',
    lineStart: {
      x: pivot.x - (tangent.x * lineLength) / 2,
      y: pivot.y - (tangent.y * lineLength) / 2,
    },
    lineLength,
    lineAngle: (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI,
  };
}
