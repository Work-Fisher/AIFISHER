function shallowEqualRecord(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

// Connected media are derived projections. Compare every field, including callbacks
// and future extensions, while allowing equivalent projections to reuse the card.
export function equalCanvasNodeProps(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => {
      if (!Object.hasOwn(right, key)) return false;
      if (Object.is(left[key], right[key])) return true;
      if (key !== 'connectedImageNodes') return false;
      const before = left[key],
        after = right[key];
      return (
        Array.isArray(before) &&
        Array.isArray(after) &&
        before.length === after.length &&
        before.every((item, index) => shallowEqualRecord(item, after[index]))
      );
    })
  );
}
