const text = value => typeof value === 'string' && value.length > 0 && value.length <= 255;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const time = value => Number.isFinite(value) && value >= 0 && value <= 86400;
export function validMediaControl(value) {
  if (value.action !== 'media') return null;
  if (!text(value.nodeId) || !text(value.revision)) return false;
  const base = ['action', 'revision', 'nodeId', 'operation'];
  if (value.operation === 'inspect') return exact(value, [...base, 'times', 'speech']) && (value.speech === undefined || typeof value.speech === 'boolean') && (value.times === undefined || Array.isArray(value.times) && value.times.length <= 20 && value.times.every(time));
  if (value.operation === 'view') return exact(value, base);
  if (value.operation === 'collage') return exact(value, [...base, 'nodeIds']) && Array.isArray(value.nodeIds) && value.nodeIds.length > 1 && value.nodeIds.length <= 16 && new Set(value.nodeIds).size === value.nodeIds.length && value.nodeIds.every(text) && value.nodeIds.includes(value.nodeId);
  if (value.operation === 'annotate') return exact(value, [...base, 'strokes', 'mask']) && typeof value.mask === 'boolean' && Array.isArray(value.strokes) && value.strokes.length > 0 && value.strokes.length <= 100
    && value.strokes.every(stroke => exact(stroke, ['tool', 'color', 'size', 'opacity', 'points']) && ['brush', 'rectangle', 'circle', 'arrow', 'line', 'eraser'].includes(stroke.tool)
      && /^#[0-9a-fA-F]{6}$/.test(stroke.color) && Number.isFinite(stroke.size) && stroke.size >= 1 && stroke.size <= 1000 && Number.isFinite(stroke.opacity) && stroke.opacity >= 0 && stroke.opacity <= 1
      && Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 1000 && stroke.points.every(point => exact(point, ['x', 'y']) && [point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100000)));
  if (value.operation === 'crop') return exact(value, [...base, 'rect']) && exact(value.rect, ['x', 'y', 'width', 'height'])
    && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(value.rect[key]) && value.rect[key] >= (['x', 'y'].includes(key) ? 0 : 1) && value.rect[key] <= 100000);
  if (value.operation === 'grid') return exact(value, [...base, 'columns', 'rows']) && [value.columns, value.rows].every(n => Number.isInteger(n) && n > 0 && n <= 10) && value.columns * value.rows <= 64;
  if (value.operation === 'frames') return exact(value, [...base, 'times']) && Array.isArray(value.times) && value.times.length > 0 && value.times.length <= 20 && value.times.every(time);
  if (['trimVideo', 'trimAudio'].includes(value.operation)) return exact(value, [...base, 'startTime', 'endTime']) && time(value.startTime) && time(value.endTime) && value.endTime > value.startTime;
  return false;
}
export function projectMediaResult(value, result) {
  if (value.analysis !== undefined) {
    if (typeof value.analysis !== 'string') throw new Error('Invalid media analysis');
    result.analysis = value.analysis;
  }
  if (value.images === undefined) return;
  if (!Array.isArray(value.images) || value.images.length > 20) throw new Error('Invalid image output');
  result.images = value.images.map(image => {
    if (!text(image?.nodeId) || typeof image.dataUrl !== 'string' || image.dataUrl.length > 1500000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) throw new Error('Invalid image output');
    return { nodeId: image.nodeId, dataUrl: image.dataUrl };
  });
}
export const mediaControlSchema = {
  speech: { type: 'boolean' },
  mask: { type: 'boolean' },
  strokes: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['tool', 'color', 'size', 'opacity', 'points'], properties: {
    tool: { enum: ['brush', 'rectangle', 'circle', 'arrow', 'line', 'eraser'] }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, size: { type: 'number', minimum: 1, maximum: 1000 }, opacity: { type: 'number', minimum: 0, maximum: 1 },
    points: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object', required: ['x', 'y'], additionalProperties: false, properties: { x: { type: 'number', minimum: 0, maximum: 100000 }, y: { type: 'number', minimum: 0, maximum: 100000 } } } },
  } } },
  rect: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'integer', minimum: ['x', 'y'].includes(key) ? 0 : 1, maximum: 100000 }])) },
  rows: { type: 'integer', minimum: 1, maximum: 10 }, columns: { type: 'integer', minimum: 1, maximum: 10 },
  times: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'number', minimum: 0, maximum: 86400 } },
  startTime: { type: 'number', minimum: 0 }, endTime: { type: 'number', minimum: 0 },
};
