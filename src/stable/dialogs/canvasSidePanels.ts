import type { CanvasComponent } from '../app/canvasComponentType';
import type * as React from 'react';

type Runtime = Pick<typeof React, 'createElement' | 'Fragment'>;
interface Props {
  documentEpoch?: number;
  isHistoryPanelOpen: boolean;
  historyPanelY: number;
  onCloseHistoryPanel(): void;
  onSelectAsset: unknown;
  isAssetLibraryOpen: boolean;
  assetLibraryY: number;
  assetLibraryVariant: 'panel' | 'modal';
  onCloseAssetLibrary(): void;
  onLibrarySelect: unknown;
  isWorkflowPresetPanelOpen: boolean;
  workflowPresetPanelY: number;
  onCloseWorkflowPresetPanel(): void;
  onWorkflowPresetSelect: unknown;
  isChatOpen: boolean;
  localUserName?: string;
  onToggleChat(): void;
  onCloseChat(): void;
  isDraggingNodeToChat?: boolean;
  isDraggingNode?: boolean;
  chatPanelWidth: number;
  onChatPanelWidthChange: unknown;
  projectId?: string;
  nodes: unknown[];
  selectedAgentReferenceNodes: unknown[];
  onLocateNode: unknown;
  selectedNodeIds?: string[];
  onApplyPrompt?: unknown;
  onCreateTextNode?: unknown;
  onCanvasAction?: unknown;
  canvasCreation?: unknown;
  canvasProjects?: unknown;
  canvasBudgets?: unknown;
  canvasExternal?: unknown;
  canvasProducts?: unknown;
}
interface Components {
  History: CanvasComponent;
  Assets: CanvasComponent;
  Presets: CanvasComponent;
  AgentLauncher: CanvasComponent;
  Agent: CanvasComponent;
}
export function CanvasSidePanels(runtime: Runtime, props: Props, components: Components) {
  return runtime.createElement(
    runtime.Fragment,
    null,
    runtime.createElement(components.History, {
      isOpen: props.isHistoryPanelOpen,
      onClose: props.onCloseHistoryPanel,
      onSelectAsset: props.onSelectAsset,
      panelY: props.historyPanelY,
      projectId: props.projectId,
    }),
    runtime.createElement(components.Assets, {
      isOpen: props.isAssetLibraryOpen,
      onClose: props.onCloseAssetLibrary,
      onSelectAsset: props.onLibrarySelect,
      panelY: props.assetLibraryY,
      variant: props.assetLibraryVariant,
    }),
    runtime.createElement(components.Presets, {
      isOpen: props.isWorkflowPresetPanelOpen,
      onClose: props.onCloseWorkflowPresetPanel,
      onSelectWorkflow: props.onWorkflowPresetSelect,
      panelY: props.workflowPresetPanelY,
    }),
    runtime.createElement(components.AgentLauncher, {
      onClick: props.onToggleChat,
      isOpen: props.isChatOpen,
    }),
    runtime.createElement(components.Agent, {
      key: props.documentEpoch ?? props.projectId ?? 'unsaved-project',
      isOpen: props.isChatOpen,
      onClose: props.onCloseChat,
      userName: props.localUserName,
      isDraggingNode: props.isDraggingNodeToChat ?? props.isDraggingNode ?? false,
      panelWidth: props.chatPanelWidth,
      onResizeWidth: props.onChatPanelWidthChange,
      nodes: props.nodes,
      selectedReferenceNodes: props.selectedAgentReferenceNodes,
      onLocateNode: props.onLocateNode,
      projectId: props.projectId,
      selectedNodeIds: props.selectedNodeIds,
      onApplyPrompt: props.onApplyPrompt,
      onCreateTextNode: props.onCreateTextNode,
      onCanvasAction: props.onCanvasAction,
      canvasCreation: props.canvasCreation,
      canvasProjects: props.canvasProjects,
      canvasBudgets: props.canvasBudgets,
      canvasExternal: props.canvasExternal,
      canvasProducts: props.canvasProducts,
    }),
  );
}
