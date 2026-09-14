export type GridOrder = 'row' | 'column' | 'snake' | 'reverse';
/** Cell IDs always use one-based row-major numbering, independent of export order. */
export function gridExportIndices(rows: number, columns: number, order: GridOrder, selection = '') {
  const total = rows * columns;
  let indices = Array.from({ length: total }, (_, i) => i);
  if (selection.trim()) {
    const chosen = new Set<number>();
    for (const part of selection.replaceAll('，', ',').split(',')) {
      const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!match) throw new Error('序号请填写为 1,3,5-8');
      const from = Number(match[1]),
        to = Number(match[2] || match[1]);
      if (from < 1 || to < from || to > total) throw new Error(`序号范围为 1–${total}`);
      for (let i = from; i <= to; i++) chosen.add(i - 1);
    }
    indices = indices.filter((i) => chosen.has(i));
  }
  if (order === 'column')
    indices.sort(
      (a, b) => (a % columns) - (b % columns) || Math.floor(a / columns) - Math.floor(b / columns),
    );
  if (order === 'snake')
    indices.sort((a, b) => {
      const row = Math.floor(a / columns),
        other = Math.floor(b / columns);
      return row - other || (row % 2 ? b - a : a - b);
    });
  if (order === 'reverse') indices.reverse();
  return indices;
}
