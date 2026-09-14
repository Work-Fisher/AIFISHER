import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
type Runtime = Pick<typeof ReactTypes, 'createElement' | 'useEffect'>;
export interface PanoramaRenderer {
  gl: {
    getSize(target: { x: number; y: number }): unknown;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: unknown, camera: PanoramaRenderer['camera']): void;
    domElement: HTMLCanvasElement;
  };
  scene: unknown;
  camera: {
    aspect: number;
    fov?: number;
    updateProjectionMatrix(): void;
    position?: {
      clone(): unknown;
      copy(value: unknown): void;
      set(x: number, y: number, z: number): void;
    };
    quaternion?: { clone(): unknown; copy(value: unknown): void };
    lookAt?(x: number, y: number, z: number): void;
  };
}
interface Props {
  url: string;
  targetRatio: number;
  fov?: number;
  mirror?: boolean;
  onReady(state: PanoramaRenderer | null): void;
}
interface Dependencies {
  useTexture(url: string): { colorSpace: string; needsUpdate: boolean };
  useThree(): PanoramaRenderer;
  Controls: CanvasComponent;
  Sphere: CanvasComponent;
  colorSpace: string;
  side: number;
}
/** Vendor rendering primitives stay shared; panorama setup and cleanup belong to source. */
export function CanvasPanoramaScene(
  React: Runtime,
  { url, targetRatio, onReady, fov = 75, mirror = false }: Props,
  { useTexture, useThree, Controls, Sphere, colorSpace, side }: Dependencies,
) {
  const texture = useTexture(url),
    { gl, scene, camera } = useThree();
  React.useEffect(() => {
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
  }, [texture, colorSpace]);
  React.useEffect(() => {
    camera.aspect = targetRatio;
    camera.fov = Math.max(30, Math.min(120, fov));
    camera.updateProjectionMatrix();
  }, [targetRatio, camera, fov]);
  React.useEffect(() => {
    onReady({ gl, scene, camera });
    return () => onReady(null);
  }, [gl, scene, camera, onReady]);
  return React.createElement(
    'group',
    null,
    React.createElement(Controls, {
      enablePan: false,
      enableZoom: false,
      zoomSpeed: 0.8,
      rotateSpeed: -0.4,
      minDistance: 0.1,
      maxDistance: 10,
    }),
    React.createElement(
      Sphere,
      { args: [500, 60, 40], scale: [mirror ? 1 : -1, 1, 1] },
      React.createElement('meshBasicMaterial', { map: texture, side }),
    ),
  );
}
