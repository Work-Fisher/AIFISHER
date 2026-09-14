import type * as React from 'react';
import {
  installStableCanvasContextActions,
  type CanvasContextMenuState,
  type CanvasConnectorSide,
} from './canvasContextActions';
import type { CanvasViewport } from './canvasNavigation';
import type { NodeMenu } from '../nodes/canvasNodeOperations';
import { canCreateWorkflowPresetComposition } from './workflowPresetComposition';

interface Options {
  nodes: { id: string }[];
  selectedNodeIds: string[];
  viewport: CanvasViewport;
  projectId?: string;
  contextMenu: CanvasContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<CanvasContextMenuState>>;
  handleOpenCreateAsset(id: string): void;
  handleOpenCreateWorkflowPreset(): void;
  handleSelectTypeFromMenu(
    type: string,
    menu: NodeMenu,
    viewport: CanvasViewport,
    close: () => void,
    projectId?: string,
  ): void;
  onCancelConnection?(): void;
}
type Pointer = Pick<
  MouseEvent,
  'clientX' | 'clientY' | 'target' | 'preventDefault' | 'stopPropagation'
>;
export function useCanvasContextMenu(hooks: Pick<typeof React, 'useCallback'>, options: Options) {
  const adapter = installStableCanvasContextActions();
  const {
    nodes,
    selectedNodeIds,
    viewport,
    projectId,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleOpenCreateWorkflowPreset,
    handleSelectTypeFromMenu,
    onCancelConnection,
  } = options;
  return {
    handleDoubleClick: hooks.useCallback(
      (event: Pointer) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (
          target.id === 'canvas-background' ||
          target.tagName.toLowerCase() === 'svg' ||
          (target.closest('#canvas-background') && !target.closest('.group\\/node'))
        )
          setContextMenu(adapter.openCanvasMenu('add-nodes', event.clientX, event.clientY));
      },
      [adapter, setContextMenu],
    ),
    handleGlobalContextMenu: hooks.useCallback(
      (event: Pointer) => {
        event.preventDefault();
        if (event.target instanceof Element && event.target.id === 'canvas-background')
          setContextMenu(adapter.openCanvasMenu('global', event.clientX, event.clientY));
      },
      [adapter, setContextMenu],
    ),
    handleAddNext: hooks.useCallback(
      (
        id: string,
        side: CanvasConnectorSide,
        x = window.innerWidth / 2,
        y = window.innerHeight / 2,
        ids?: string[],
        sourcePortIndex?: number,
      ) => {
        const menu = adapter.openNextNodeMenu(
          nodes.map((node) => node.id),
          id,
          side,
          x,
          y,
          ids,
          sourcePortIndex,
        );
        if (menu) setContextMenu(menu);
      },
      [adapter, nodes, setContextMenu],
    ),
    handleNodeContextMenu: hooks.useCallback(
      (event: Pointer, id: string) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = adapter.openNodeMenu(
          nodes.map((node) => node.id),
          id,
          event.clientX,
          event.clientY,
        );
        if (menu) setContextMenu(menu);
      },
      [adapter, nodes, setContextMenu],
    ),
    handleContextMenuCreateAsset: hooks.useCallback(() => {
      if (contextMenu.sourceNodeId) handleOpenCreateAsset(contextMenu.sourceNodeId);
    }, [contextMenu.sourceNodeId, handleOpenCreateAsset]),
    handleContextMenuCreateWorkflowPreset: hooks.useCallback(() => {
      if (canCreateWorkflowPresetComposition(nodes, selectedNodeIds))
        handleOpenCreateWorkflowPreset();
    }, [nodes, selectedNodeIds, handleOpenCreateWorkflowPreset]),
    handleContextMenuSelect: hooks.useCallback(
      (type: string) =>
        handleSelectTypeFromMenu(
          type,
          contextMenu,
          viewport,
          () => {
            setContextMenu((current) => ({ ...current, isOpen: false }));
            onCancelConnection?.();
          },
          projectId,
        ),
      [
        handleSelectTypeFromMenu,
        contextMenu,
        viewport,
        projectId,
        setContextMenu,
        onCancelConnection,
      ],
    ),
    handleToolbarAdd: hooks.useCallback(
      (event: { currentTarget: Element }) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setContextMenu(adapter.openCanvasMenu('global', rect.right + 10, rect.top));
      },
      [adapter, setContextMenu],
    ),
  };
}
