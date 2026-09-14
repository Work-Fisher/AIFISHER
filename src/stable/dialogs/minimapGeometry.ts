import type { CanvasPositionedNode } from '../canvas/canvasEditing';
import type { CanvasViewport } from '../canvas/canvasNavigation';
export interface MinimapNode extends CanvasPositionedNode {
  type?: string;
  parentIds?: string[];
}
export interface NodeMeasurement {
  width(node: MinimapNode, parent?: MinimapNode): number;
  height(node: MinimapNode, parent?: MinimapNode): number;
}
export function minimapScene(
  nodes: MinimapNode[],
  size: { width: number; height: number },
  measure: NodeMeasurement,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const frames = nodes
    .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
    .map((node) => {
      const parent = byId.get(node.parentIds?.[0] || '');
      return {
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        width: Math.max(1, measure.width(node, parent) || 1),
        height: Math.max(1, measure.height(node, parent) || 1),
      };
    });
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const frame of frames) {
    minX = Math.min(minX, frame.x);
    minY = Math.min(minY, frame.y);
    maxX = Math.max(maxX, frame.x + frame.width);
    maxY = Math.max(maxY, frame.y + frame.height);
  }
  if (!frames.length) {
    minX = -1000;
    minY = -1000;
    maxX = 1000;
    maxY = 1000;
  } else {
    minX -= 2000;
    minY -= 2000;
    maxX += 2000;
    maxY += 2000;
  }
  const scale = Math.min(size.width / (maxX - minX), size.height / (maxY - minY)),
    offsetX = (size.width - (maxX - minX) * scale) / 2,
    offsetY = (size.height - (maxY - minY) * scale) / 2;
  return { frames, minX, minY, scale, offsetX, offsetY };
}
export function minimapViewport(
  scene: ReturnType<typeof minimapScene>,
  viewport: CanvasViewport,
  size: { width: number; height: number },
) {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    left: (-viewport.x / zoom - scene.minX) * scene.scale + scene.offsetX,
    top: (-viewport.y / zoom - scene.minY) * scene.scale + scene.offsetY,
    width: (size.width / zoom) * scene.scale,
    height: (size.height / zoom) * scene.scale,
  };
}
