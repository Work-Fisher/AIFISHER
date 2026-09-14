export type Size = { width: number; height: number };
export type Mode = 'scale' | 'width' | 'height';
export function resizeDimensions(original: Size, mode: Mode, raw: string): Size {
  const value = Number(raw);
  if (
    !raw.trim() ||
    !Number.isFinite(value) ||
    value <= 0 ||
    original.width <= 0 ||
    original.height <= 0
  )
    return { width: 0, height: 0 };
  const scale =
    mode === 'scale'
      ? value
      : mode === 'width'
        ? Math.trunc(value) / original.width
        : Math.trunc(value) / original.height;
  if (scale <= 0) return { width: 0, height: 0 };
  return {
    width: Math.max(1, Math.round(original.width * scale)),
    height: Math.max(1, Math.round(original.height * scale)),
  };
}
export function resizeLimit(size: Size): string {
  if (size.width <= 0 || size.height <= 0) return '请输入有效的图片尺寸。';
  if (size.width > 16384 || size.height > 16384 || size.width * size.height > 64_000_000)
    return '图片过大，请将单边控制在 16384 像素内、总像素控制在 6400 万以内。';
  return '';
}
