import { resizeLimit } from '../dialogs/imageResizeGeometry';
export interface CollageItem {
  naturalWidth: number;
  naturalHeight: number;
  centerX: number;
  centerY: number;
  visualHeight: number;
}
/** Preserve the original row grouping and pixel-size placement, without resampling inputs. */
export function layoutImageCollage<T extends CollageItem>(items: T[]) {
  if (!items.length) throw new Error('拼图没有可用图片');
  const heights = items.map((item) => item.visualHeight).sort((a, b) => a - b),
    middle = Math.floor(heights.length / 2);
  const median = heights.length % 2 ? heights[middle] : (heights[middle - 1] + heights[middle]) / 2,
    threshold = Math.max(60, median * 0.45);
  const rows: Array<{ centerY: number; items: T[] }> = [];
  for (const item of [...items].sort((a, b) => a.centerY - b.centerY)) {
    let nearest: (typeof rows)[number] | undefined,
      distance = Infinity;
    for (const row of rows) {
      const delta = Math.abs(item.centerY - row.centerY);
      if (delta <= threshold && delta < distance) {
        distance = delta;
        nearest = row;
      }
    }
    if (!nearest) rows.push({ centerY: item.centerY, items: [item] });
    else {
      nearest.items.push(item);
      nearest.centerY =
        nearest.items.reduce((sum, item) => sum + item.centerY, 0) / nearest.items.length;
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.centerX - b.centerX);
  const columns = Math.max(...rows.map((row) => row.items.length));
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map((row) => row.items[column]?.naturalWidth || 0)),
  );
  const rowHeights = rows.map((row) => Math.max(...row.items.map((item) => item.naturalHeight)));
  const placements: Array<{ item: T; x: number; y: number }> = [];
  let y = 0;
  rows.forEach((row, index) => {
    let x = 0;
    row.items.forEach((item, column) => {
      placements.push({
        item,
        x: x + (columnWidths[column] - item.naturalWidth) / 2,
        y: y + (rowHeights[index] - item.naturalHeight) / 2,
      });
      x += columnWidths[column];
    });
    y += rowHeights[index];
  });
  return {
    placements,
    width: columnWidths.reduce((sum, width) => sum + width, 0),
    height: rowHeights.reduce((sum, height) => sum + height, 0),
  };
}
export function loadCollageImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
      if (error) {
        image.removeAttribute('src');
        reject(error);
      } else resolve(image);
    };
    const abort = () => finish(new Error('拼图操作已结束。'));
    const timeout = setTimeout(() => finish(new Error('拼图图片加载超时，请重试。')), 15000);
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () =>
      finish(
        image.naturalWidth && image.naturalHeight ? undefined : new Error('拼图图片尺寸无效。'),
      );
    image.onerror = () => finish(new Error('拼图图片加载失败，请检查原图。'));
    image.src = url;
  });
}
export function renderImageCollage(items: Array<CollageItem & { image: HTMLImageElement }>) {
  const layout = layoutImageCollage(items),
    invalid = resizeLimit(layout);
  if (invalid) throw new Error(invalid);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建拼图画布');
  for (const { item, x, y } of layout.placements)
    context.drawImage(item.image, x, y, item.naturalWidth, item.naturalHeight);
  const data = canvas.toDataURL('image/png');
  if (!data.startsWith('data:image/png')) throw new Error('拼图超出当前设备的处理范围。');
  return { data, width: canvas.width, height: canvas.height };
}
