export interface AnnotationPoint {
  x: number;
  y: number;
}
export type AnnotationTool = 'brush' | 'rectangle' | 'circle' | 'arrow' | 'line' | 'eraser';
export interface AnnotationStroke {
  tool: AnnotationTool;
  color: string;
  size: number;
  opacity: number;
  arrowHead?: number;
  points: AnnotationPoint[];
}

/** Stroke geometry is stored in source-image pixels, independent of viewport and export size. */
export function drawAnnotationStroke(context: CanvasRenderingContext2D, stroke: AnnotationStroke) {
  const first = stroke.points[0],
    last = stroke.points.at(-1);
  if (!first || !last) return;
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const paint = () => {
    context.beginPath();
    if (stroke.tool === 'rectangle')
      context.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    else if (stroke.tool === 'circle') {
      context.ellipse(
        (first.x + last.x) / 2,
        (first.y + last.y) / 2,
        Math.abs(last.x - first.x) / 2,
        Math.abs(last.y - first.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else if (stroke.points.every((point) => point.x === first.x && point.y === first.y)) {
      context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(first.x, first.y);
      const points =
        stroke.tool === 'line' || stroke.tool === 'arrow' ? [last] : stroke.points.slice(1);
      for (const point of points) context.lineTo(point.x, point.y);
      if (stroke.tool === 'arrow') {
        const angle = Math.atan2(last.y - first.y, last.x - first.x),
        head = stroke.arrowHead ?? 20;
        context.lineTo(
          last.x - head * Math.cos(angle - Math.PI / 6),
          last.y - head * Math.sin(angle - Math.PI / 6),
        );
        context.moveTo(last.x, last.y);
        context.lineTo(
          last.x - head * Math.cos(angle + Math.PI / 6),
          last.y - head * Math.sin(angle + Math.PI / 6),
        );
      }
      context.stroke();
    }
  };
  // Preserve the original export's coverage semantics: repeated marks keep the chosen opacity.
  context.globalCompositeOperation = 'destination-out';
  context.globalAlpha = 1;
  paint();
  if (stroke.tool !== 'eraser') {
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = stroke.opacity;
    paint();
  }
  context.restore();
}

/** Preview and export use the same chronological renderer; a later stroke can paint over an erasure. */
export function renderAnnotations(
  canvas: HTMLCanvasElement,
  strokes: AnnotationStroke[],
  source: { width: number; height: number },
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建标注画布');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(canvas.width / source.width, canvas.height / source.height);
  for (const stroke of strokes) drawAnnotationStroke(context, stroke);
  context.restore();
}
