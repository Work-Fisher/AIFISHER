import { vi } from 'vitest';

/** Keep 2D fixtures separate from WebGL/WebGPU overloads introduced by renderer types. */
export function mockCanvas2DContext(context: CanvasRenderingContext2D) {
  const getContext = ((kind: string) =>
    kind === '2d' ? context : null) as HTMLCanvasElement['getContext'];
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext);
}
