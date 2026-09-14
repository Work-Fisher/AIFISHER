import type { Dispatch, SetStateAction } from 'react';
import { createCanvasNode, type CanvasNode, type NodeRuntime } from '../nodes/canvasNodeOperations';

interface TextActionsOptions {
  getNodes(): CanvasNode[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setSelectedNodeIds(ids: string[]): void;
  projectId?: string;
  enabled: boolean;
}

/** Text-to-media creates one connected editable node; it never submits a generation. */
export function createCanvasTextActions(options: TextActionsOptions, runtime: NodeRuntime) {
  const createMedia = (sourceId: string, type: 'Image' | 'Video') => {
    if (!options.enabled) return;
    const source = options.getNodes().find((node) => node.id === sourceId);
    if (!source) return;
    const output = createCanvasNode(
      runtime,
      type,
      { x: source.x + 440, y: source.y },
      options.projectId,
    );
    output.parentIds = [sourceId];
    options.setNodes((current) => {
      if (!current.some((node) => node.id === sourceId)) return current;
      return [
        ...current.map((node) =>
          node.id === sourceId
            ? {
                ...node,
                textMode: 'editing',
                ...(type === 'Video' ? { linkedVideoNodeId: output.id } : {}),
              }
            : node,
        ),
        output,
      ];
    });
    options.setSelectedNodeIds([sourceId]);
  };
  return {
    handleWriteContent(id: string) {
      if (options.enabled)
        options.setNodes((current) =>
          current.map((node) => (node.id === id ? { ...node, textMode: 'editing' } : node)),
        );
    },
    handleTextToVideo: (id: string) => createMedia(id, 'Video'),
    handleTextToImage: (id: string) => createMedia(id, 'Image'),
  };
}
