export type CanvasEdit =
  | { kind: 'create'; ref: string; type: 'Image' | 'Video' | 'Audio' | 'Text'; x: number; y: number; title?: string; prompt?: string }
  | { kind: 'update'; nodeId: string; patch: { title?: string; prompt?: string; x?: number; y?: number } }
  | { kind: 'configure'; nodeId: string; model: string; parameters: Record<string, string | number | boolean> }
  | { kind: 'delete'; nodeId: string }
  | { kind: 'connect'; sourceId: string; targetId: string; sourcePort?: number }
  | { kind: 'disconnect'; sourceId: string; targetId: string; targetPort?: number }
  | { kind: 'group'; ref: string; nodeIds: string[]; label: string }
  | { kind: 'ungroup'; groupId: string }
  | { kind: 'renameGroup'; groupId: string; label: string }
  | { kind: 'arrange'; nodeIds: string[]; columns: number }
  | { kind: 'duplicate'; nodes: Array<{ nodeId: string; ref: string }>; x: number; y: number };
export type ProjectCommand = { action: 'project'; revision: string } & (
  | { operation: 'save' | 'import' }
  | { operation: 'create'; title: string; folderId?: string | null }
  | { operation: 'open' | 'duplicate' | 'delete' | 'export'; projectId: string }
  | { operation: 'rename'; projectId: string; title: string }
  | { operation: 'move'; projectId: string; folderId: string | null }
  | { operation: 'createFolder' | 'renameFolder'; title: string; folderId: string | null }
  | { operation: 'deleteFolder'; folderId: string });
export type CanvasControl = { action: 'read' }
  | { action: 'workflows'; offset?: number }
  | ({ action: 'workflow'; revision: string } & ({ operation: 'describe'; definitionId: string } | { operation: 'insert'; definitionId: string; x: number; y: number } | { operation: 'configure'; nodeId: string; parameters: Record<string, string | number | boolean | { mode: 'fixed' | 'random' | 'increment' | 'decrement'; value?: number; step?: number }> }))
  | { action: 'product'; revision: string; operation: 'upload' | 'replace' | 'download' | 'saveAsset' | 'resize' | 'workflowManager' | 'runWorkflow'; nodeId?: string }
  | { action: 'budgets' }
  | { action: 'revokeBudget'; authorizationId: string }
  | { action: 'prepareBudget'; revision: string; nodeIds: string[]; maxRequests: number; maxOutputs: number; minutes: number; budgetCny?: number }
  | { action: 'runGeneration'; revision: string; generationPlanId: string; authorizationId: string }
  | ({ action: 'media'; revision: string; nodeId: string } & (
    | { operation: 'view' }
    | { operation: 'inspect'; times?: number[]; speech?: boolean }
    | { operation: 'collage'; nodeIds: string[] }
    | { operation: 'annotate'; mask: boolean; strokes: Array<{ tool: 'brush' | 'rectangle' | 'circle' | 'arrow' | 'line' | 'eraser'; color: string; size: number; opacity: number; points: Array<{ x: number; y: number }> }> }
    | { operation: 'crop'; rect: { x: number; y: number; width: number; height: number } }
    | { operation: 'grid'; rows: number; columns: number }
    | { operation: 'frames'; times: number[] }
    | { operation: 'trimVideo' | 'trimAudio'; startTime: number; endTime: number }))
  | { action: 'tasks'; nodeIds?: string[] }
  | { action: 'cancelTask'; revision: string; nodeId: string }
  | { action: 'projects'; query?: string; offset?: number }
  | ProjectCommand
  | { action: 'models'; type: 'Image' | 'Video' | 'Audio' | 'Text'; model?: string }
  | { action: 'prepareGeneration'; revision: string; nodeIds: string[] }
  | { action: 'edit'; revision: string; operations: CanvasEdit[] }
  | { action: 'undo'; revision: string; operationId: string }
  | { action: 'focus'; nodeIds: string[] }
  | { action: 'assets'; query?: string; offset?: number }
  | { action: 'importAsset'; revision: string; assetId: string; x: number; y: number };
export type CanvasResult = { ok: false; code: string } | {
  ok: true; revision: string; operationId?: string;
  projects?: Array<{ id: string; title: string; folderId?: string | null }>;
  folders?: Array<{ id: string; title: string; folderId?: string | null }>;
  projectState?: 'saved' | 'created' | 'updated' | 'ready-to-open' | 'awaiting-user';
  projectRequestId?: string; projectNextOffset?: number | null;
  /** Local continuation only; never serialized to the model or backend. */
  afterTurn?: () => Promise<void>;
  tasks?: Array<{ nodeId: string; status: string; remoteMayContinue: boolean; text?: string }>;
  workflows?: Array<{ id: string; name: string; ready?: boolean; parameters?: string }>;
  analysis?: string; images?: Array<{ nodeId: string; dataUrl: string }>;
  generationPlanId?: string; generationState?: 'awaiting-approval' | 'running';
  budgets?: Array<{ id: string; state: string; expiresAt: number; maxRequests: number; maxOutputs: number; usedRequests: number; usedOutputs: number; budgetMicros: number | null; reservedMicros: number }>;
  models?: Array<{ name: string; source: string; parameters: string }>;
  nodes?: Array<{ id: string; type: string; x: number; y: number; title: string; prompt: string; textContent?: string; parentIds?: string[]; sourcePortIndices?: number[]; groupId?: string; status?: string; model?: string; parameters?: string }>;
  groups?: Array<{ id: string; label: string; nodeIds: string[] }>;
  selectedNodeIds?: string[];
  assets?: Array<{ id: string; name: string; type: string }>;
  nextOffset?: number | null;
  created?: Array<{ ref: string; id: string }>;
};
export interface CanvasActionRequest { requestId: string; projectId: string; sessionId: string; command: CanvasControl; expiresAt: number }
export type CanvasActionHandler = (request: CanvasActionRequest, signal?: AbortSignal) => CanvasResult | Promise<CanvasResult>;
export function validCanvasControl(value: unknown): value is CanvasControl;
export function projectCanvasResult(value: unknown): CanvasResult;
export const canvasControlTool: { name: string; [key: string]: unknown };
export const canvasControlVersion: number;
