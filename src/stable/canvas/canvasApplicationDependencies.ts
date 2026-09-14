import type * as React from 'react';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { CanvasGroup } from './canvasGroups';
import type * as Editor from './canvasEditorHooks';
import type { useCanvasNodes } from '../nodes/canvasNodeState';
import type { useCanvasViewport } from './canvasViewport';
import type { useCanvasPanels } from '../dialogs/canvasPanels';
import type { useCanvasWorkflow } from '../persistence/canvasWorkflow';
import type { useCanvasGeneration } from '../generation/canvasGeneration';
import type { useCanvasLocalWorkflows } from '../generation/canvasLocalWorkflows';
import type * as Media from '../media/canvasMediaOperations';
import type { useCanvasWorkflowPresets } from './canvasWorkflowPresets';
import type { useCanvasCommands } from './canvasCommands';
import type { useCanvasContextMenu } from './canvasContextHooks';
import type { createCanvasTextActions } from './canvasTextActions';
import type { useCanvasConnections } from './canvasConnectionHooks';
export type Runtime = Pick<
  typeof React,
  | 'createElement'
  | 'Fragment'
  | 'useState'
  | 'useRef'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
>;
type Props = Record<string, unknown>;
type Component = React.ComponentType<Props>;
type Hook<F extends (...args: never[]) => unknown> = (options: Props) => ReturnType<F>;
interface LoadedProject extends Props {
  nodes: CanvasNode[];
  groups: CanvasGroup[];
  folderId?: string;
  lastSavedAt?: number;
  lastSavedBy?: string;
  revision?: number;
}
/** Native bindings supply existing React/store/collaboration instances; application behavior lives in source. */
export interface Dependencies {
  usePanels(): ReturnType<typeof useCanvasPanels>;
  useTitle(): ReturnType<typeof Editor.useCanvasTitle>;
  useViewport(): ReturnType<typeof useCanvasViewport>;
  useNodes(): Omit<ReturnType<typeof useCanvasNodes>, 'autoAlignNodes' | 'gridLayoutNodes'> & {
    autoAlignNodes(): void;
    gridLayoutNodes(columns: number, compact?: boolean): void;
  };
  useConnections(): ReturnType<typeof useCanvasConnections>;
  useDrag(): ReturnType<typeof Editor.useCanvasDrag>;
  useResize(): ReturnType<typeof Editor.useCanvasResize>;
  useMarquee(): ReturnType<typeof Editor.useCanvasMarquee>;
  useGroups(): ReturnType<typeof Editor.useCanvasGroups>;
  useEdgePan: Hook<typeof Editor.useCanvasEdgePan>;
  useHistory(
    initial: { nodes: CanvasNode[]; groups: CanvasGroup[] },
    limit: number,
  ): ReturnType<typeof Editor.useCanvasHistory<{ nodes: CanvasNode[]; groups: CanvasGroup[] }>>;
  useWorkflow(
    options: Props,
  ): Omit<ReturnType<typeof useCanvasWorkflow>, 'handleLoadWorkflow'> & {
    handleLoadWorkflow(id: string): Promise<LoadedProject | null>;
  };
  useLocalUser(): { id: string; no: string; name: string; setName(value: string): void };
  userColorForId(id: string): string;
  NodeStatus: Record<'LOADING' | 'SUCCESS', string>;
  NodeType: Record<
    'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'UPLOAD_IMAGE' | 'UPLOAD_VIDEO' | 'UPLOAD_AUDIO',
    string
  >;
  useGeneration: Hook<typeof useCanvasGeneration>;
  useSnapshots: Hook<typeof Media.useCanvasSnapshots>;
  useAudioTrim: Hook<typeof Media.useCanvasAudioTrim>;
  useTextActions: Hook<typeof createCanvasTextActions>;
  useLocalWorkflows: Hook<typeof useCanvasLocalWorkflows>;
  useAssets: Hook<typeof Media.useCanvasAssets>;
  usePresets: Hook<typeof useCanvasWorkflowPresets>;
  useCommands: Hook<typeof useCanvasCommands>;
  useAutoSave(options: Props): void;
  useVideoResults(options: Props): void;
  useImageResults(options: Props): void;
  useContextMenu: Hook<typeof useCanvasContextMenu>;
  media: typeof Media;
  getNodeWidth(node: CanvasNode): number;
  getNodeHeight(node: CanvasNode): number;
  createId(): string;
  textForNode(node: CanvasNode): string;
  Projects: Component;
  Settings: Component;
  Header: Component;
  Sidebar: Component;
  Scene: Component;
  Controls: Component;
  SidePanels: Component;
  Overlays: Component;
  Annotation: Component;
  Crop: Component;
  Resize: Component;
}
