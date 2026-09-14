import * as React from 'react';
import { toPng } from 'html-to-image';
import { CanvasApplication } from '../canvas/canvasApplication';
import type { Dependencies } from '../canvas/canvasApplicationDependencies';
import * as Components from './canvasComponents';
import { avatarColor } from '../profile/canvasAvatar';
import { useLocalUser } from '../profile/localUser';
import { IMAGE_MODELS, VIDEO_MODELS, TEXT_MODELS, AUDIO_MODELS } from '../../config/modelConfig';
import * as Rules from '../nodes/canvasNodeRules';
import * as Editor from '../canvas/canvasEditorHooks';
import * as Nodes from '../nodes/canvasNodeState';
import type { CanvasNode, NodeRuntime } from '../nodes/canvasNodeOperations';
import * as Media from '../media/canvasMediaOperations';
import * as Generation from '../generation/canvasGeneration';
import { useCanvasViewport } from '../canvas/canvasViewport';
import { useCanvasPanels } from '../dialogs/canvasPanels';
import { useCanvasWorkflow } from '../persistence/canvasWorkflow';
import { useCanvasAutoSave } from '../persistence/canvasAutoSaveLifecycle';
import { useCanvasCommands } from '../canvas/canvasCommands';
import { useCanvasWorkflowPresets } from '../canvas/canvasWorkflowPresets';
import { useRecovery, type RecoveryOptions } from './useRecovery';

const catalog = {
  image: IMAGE_MODELS,
  video: VIDEO_MODELS,
  text: TEXT_MODELS,
  audio: AUDIO_MODELS,
};
const models = {
  imageModels: IMAGE_MODELS,
  videoModels: VIDEO_MODELS,
  textModels: TEXT_MODELS,
  audioModels: AUDIO_MODELS,
};
const createId = () => crypto.randomUUID();
const nodeRuntime: NodeRuntime = {
  ...models,
  createId,
  templates: Rules.workflowTemplates,
  mediaType: Rules.nodeMediaKind,
  canConnect: (source, target, nodes, port) =>
    Rules.chooseConnectionMode(source, target, nodes, port, catalog),
  validateConnection: (source, target, nodes, model, mode, port) =>
    Rules.validateConnection(source, target, nodes, model, mode, port, catalog),
};

type Options = Record<string, unknown>;
/** The application passes document extension fields through its existing options contract. */
function optionsHook<O, Result>(hook: (options: O) => Result) {
  return (options: Options) => hook(options as O);
}
function view(component: unknown): Dependencies['Projects'] {
  return component as Dependencies['Projects'];
}

const dependencies: Dependencies = {
  usePanels: () => useCanvasPanels(React),
  useTitle: () => Editor.useCanvasTitle(React),
  useViewport: () =>
    useCanvasViewport(
      React,
      (node) => Rules.nodeWidth(node as CanvasNode),
      (node) => Rules.nodeHeight(node as CanvasNode),
    ),
  useNodes: () =>
    Nodes.useCanvasNodes(React, {
      ...nodeRuntime,
      getWidth: Rules.nodeWidth,
      layout: function useLayout(options) {
        return Editor.useCanvasLayout(options, {
          getWidth: Rules.nodeWidth,
          getHeight: Rules.nodeHeight,
          horizontalGap: 40,
          verticalGap: 40,
        });
      },
    }),
  useConnections: () =>
    Editor.useCanvasConnections(React, {
      getWidth: Rules.nodeWidth,
      getHeight: Rules.nodeHeight,
      templates: Rules.workflowTemplates,
      canConnect: nodeRuntime.canConnect,
      getPortTop: Rules.legacyWorkflowPortTop,
      portHeight: Rules.portHeight,
      portGap: Rules.portGap,
      workflow: () => window.__FISHERAI_WORKFLOW_NODES__,
      minimax: () => window.__FISHERAI_MINIMAX_H3__,
    }),
  useDrag: () => Editor.useCanvasDrag(React),
  useResize: () => Editor.useCanvasResize(React),
  useMarquee: () =>
    Editor.useCanvasMarquee(
      React,
      (node) => Rules.nodeWidth(node as CanvasNode),
      (node, parent) => Rules.nodeHeight(node as CanvasNode, parent as CanvasNode | undefined),
    ),
  useGroups: () => Editor.useCanvasGroups(React, createId),
  useEdgePan: optionsHook((options: Parameters<typeof Editor.useCanvasEdgePan>[1]) =>
    Editor.useCanvasEdgePan(React, options),
  ),
  useHistory: (initial, limit) => Editor.useCanvasHistory(React, initial, limit),
  useWorkflow: optionsHook((options: Parameters<typeof useCanvasWorkflow>[1]) =>
    useCanvasWorkflow(React, options),
  ) as Dependencies['useWorkflow'],
  useLocalUser: () => useLocalUser(React),
  userColorForId: avatarColor,
  NodeStatus: Rules.nodeStatuses,
  NodeType: Rules.nodeTypes,
  useGeneration: optionsHook((options: Parameters<typeof Generation.useCanvasGeneration>[1]) =>
    Generation.useCanvasGeneration(React, { ...options, ...models }),
  ),
  useSnapshots: optionsHook((options: Parameters<typeof Media.useCanvasSnapshots>[1]) =>
    Media.useCanvasSnapshots(React, options),
  ),
  useAudioTrim: optionsHook((options: Parameters<typeof Media.useCanvasAudioTrim>[1]) =>
    Media.useCanvasAudioTrim(React, options),
  ),
  useTextActions: optionsHook((options: Parameters<typeof Nodes.createCanvasTextActions>[0]) =>
    Nodes.createCanvasTextActions(options, nodeRuntime),
  ),
  useLocalWorkflows: optionsHook(
    (options: Parameters<typeof Generation.useCanvasLocalWorkflows>[1]) =>
      Generation.useCanvasLocalWorkflows(React, options, createId),
  ),
  useAssets: optionsHook((options: Parameters<typeof Media.useCanvasAssets>[1]) =>
    Media.useCanvasAssets(React, options),
  ),
  usePresets: optionsHook((options: Parameters<typeof useCanvasWorkflowPresets>[1]) =>
    useCanvasWorkflowPresets(React, options, {
      width: Rules.nodeWidth,
      height: Rules.nodeHeight,
      capture: toPng,
    }),
  ),
  useCommands: optionsHook((options: Parameters<typeof useCanvasCommands>[2]) =>
    useCanvasCommands(React, createId, options),
  ),
  useAutoSave: optionsHook((options: Parameters<typeof useCanvasAutoSave>[1]) =>
    useCanvasAutoSave(React, options),
  ),
  useVideoResults: optionsHook((options: RecoveryOptions) => useRecovery(options, false)),
  useImageResults: optionsHook((options: RecoveryOptions) => useRecovery(options, true)),
  useContextMenu: optionsHook((options: Parameters<typeof Nodes.useCanvasContextMenu>[1]) =>
    Nodes.useCanvasContextMenu(React, options),
  ),
  media: Media,
  getNodeWidth: Rules.nodeWidth,
  getNodeHeight: Rules.nodeHeight,
  createId,
  textForNode: (node) =>
    node.type === Rules.nodeTypes.TEXT && typeof node.textContent === 'string'
      ? node.textContent
      : '',
  Projects: view(Components.ProjectDashboard),
  Settings: view(Components.Settings),
  Header: view(Components.Header),
  Sidebar: view(Components.Sidebar),
  Scene: view(Components.Scene),
  Controls: view(Components.ViewportControls),
  SidePanels: view(Components.SidePanels),
  Overlays: view(Components.Overlays),
  Annotation: view(Components.ImageAnnotation),
  Crop: view(Components.ImageCrop),
  Resize: view(Components.ImageResize),
};

export function CanvasRoot() {
  return CanvasApplication(React, dependencies);
}
