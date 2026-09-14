// Shared by the browser executor and the authenticated Codex bridge. No I/O here.
import { validProjectControl, projectProjectResult, projectControlSchema } from './canvasProjectProtocol.js';
import { validTaskControl, projectTaskResult } from './canvasTaskProtocol.js';
import { validMediaControl, projectMediaResult, mediaControlSchema } from './canvasMediaProtocol.js';
import { validBudgetControl, projectBudgetResult, budgetControlSchema } from './canvasBudgetProtocol.js';
import { validWorkflowControl, projectWorkflowResult, workflowParameterSchema } from './canvasWorkflowProtocol.js';
const text = (value, max = 255) => typeof value === 'string' && value.length > 0 && value.length <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const coordinate = value => Number.isFinite(value) && Math.abs(value) <= 1000000;
const ids = value => Array.isArray(value) && value.length > 0 && value.length <= 100 && new Set(value).size === value.length && value.every(id => text(id));
const port = value => value === undefined || Number.isInteger(value) && value >= 0 && value < 100;
const patch = value => exact(value, ['title', 'prompt', 'x', 'y']) && Object.keys(value).length > 0
  && Object.entries(value).every(([key, entry]) => ['x', 'y'].includes(key) ? coordinate(entry)
    : typeof entry === 'string' && entry.length <= (key === 'prompt' ? Infinity : 500));

export function validCanvasControl(value) {
  if (!object(value)) return false;
  const project = validProjectControl(value);
  if (project !== null) return project;
  const task = validTaskControl(value);
  if (task !== null) return task;
  const media = validMediaControl(value);
  if (media !== null) return media;
  const budget = validBudgetControl(value);
  if (budget !== null) return budget;
  const workflow = validWorkflowControl(value);
  if (workflow !== null) return workflow;
  if (value.action === 'read') return exact(value, ['action']);
  if (value.action === 'models') return exact(value, ['action', 'type', 'model']) && ['Image', 'Video', 'Audio', 'Text'].includes(value.type) && (value.model === undefined || text(value.model));
  if (value.action === 'focus') return exact(value, ['action', 'nodeIds']) && ids(value.nodeIds);
  if (value.action === 'assets') return exact(value, ['action', 'query', 'offset'])
    && (value.query === undefined || typeof value.query === 'string' && value.query.length <= 200)
    && (value.offset === undefined || Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= 100000);
  if (!text(value.revision, 128)) return false;
  if (value.action === 'prepareGeneration') return exact(value, ['action', 'revision', 'nodeIds']) && ids(value.nodeIds) && value.nodeIds.length <= 20;
  if (value.action === 'undo') return exact(value, ['action', 'revision', 'operationId']) && text(value.operationId, 128);
  if (value.action === 'importAsset') return exact(value, ['action', 'revision', 'assetId', 'x', 'y'])
    && text(value.assetId, 128) && coordinate(value.x) && coordinate(value.y);
  if (value.action !== 'edit' || !exact(value, ['action', 'revision', 'operations'])
    || !Array.isArray(value.operations) || !value.operations.length || value.operations.length > 100) return false;
  return value.operations.every(op => {
    if (!object(op)) return false;
    if (op.kind === 'create') return exact(op, ['kind', 'ref', 'type', 'x', 'y', 'title', 'prompt'])
      && text(op.ref, 128) && ['Image', 'Video', 'Audio', 'Text'].includes(op.type)
      && coordinate(op.x) && coordinate(op.y)
      && (op.title === undefined || typeof op.title === 'string' && op.title.length <= 500)
      && (op.prompt === undefined || typeof op.prompt === 'string');
    if (op.kind === 'configure') return exact(op, ['kind', 'nodeId', 'model', 'parameters']) && text(op.nodeId) && text(op.model) && object(op.parameters) && Object.keys(op.parameters).length <= 50 && Object.entries(op.parameters).every(([key, value]) => text(key, 100) && !['__proto__', 'constructor', 'prototype'].includes(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string'));
    if (op.kind === 'update') return exact(op, ['kind', 'nodeId', 'patch']) && text(op.nodeId) && patch(op.patch);
    if (op.kind === 'delete') return exact(op, ['kind', 'nodeId']) && text(op.nodeId);
    if (op.kind === 'connect' || op.kind === 'disconnect') {
      const key = op.kind === 'connect' ? 'sourcePort' : 'targetPort';
      return exact(op, ['kind', 'sourceId', 'targetId', key]) && text(op.sourceId) && text(op.targetId)
        && op.sourceId !== op.targetId && port(op[key]);
    }
    if (op.kind === 'group') return exact(op, ['kind', 'ref', 'nodeIds', 'label']) && text(op.ref, 128)
      && ids(op.nodeIds) && op.nodeIds.length >= 2 && text(op.label, 500);
    if (op.kind === 'ungroup') return exact(op, ['kind', 'groupId']) && text(op.groupId);
    if (op.kind === 'renameGroup') return exact(op, ['kind', 'groupId', 'label']) && text(op.groupId) && text(op.label, 500);
    if (op.kind === 'arrange') return exact(op, ['kind', 'nodeIds', 'columns']) && ids(op.nodeIds)
      && Number.isInteger(op.columns) && op.columns >= 1 && op.columns <= 100;
    if (op.kind === 'duplicate') return exact(op, ['kind', 'nodes', 'x', 'y']) && coordinate(op.x) && coordinate(op.y)
      && Array.isArray(op.nodes) && op.nodes.length > 0 && op.nodes.length <= 100
      && new Set(op.nodes.map(node => node?.nodeId)).size === op.nodes.length
      && new Set(op.nodes.map(node => node?.ref)).size === op.nodes.length
      && op.nodes.every(node => exact(node, ['nodeId', 'ref']) && text(node.nodeId) && text(node.ref, 128));
    return false;
  });
}

// Responses are reconstructed, never forward arbitrary node fields, paths or settings.
export function projectCanvasResult(value) {
  if (!object(value) || typeof value.ok !== 'boolean') throw new Error('Invalid canvas result');
  if (!value.ok) return { ok: false, code: ['CONFLICT', 'UNAVAILABLE', 'INVALID', 'NOT_FOUND', 'UNCONFIRMED'].includes(value.code) ? value.code : 'INVALID' };
  if (!text(value.revision, 128)) throw new Error('Invalid revision');
  const result = { ok: true, revision: value.revision };
  projectProjectResult(value, result);
  projectTaskResult(value, result);
  projectMediaResult(value, result);
  projectBudgetResult(value, result);
  projectWorkflowResult(value, result);
  if (value.operationId !== undefined) {
    if (!text(value.operationId, 128)) throw new Error('Invalid operation');
    result.operationId = value.operationId;
  }
  if (value.generationPlanId !== undefined) {
    if (!text(value.generationPlanId, 128)) throw new Error('Invalid generation plan');
    result.generationPlanId = value.generationPlanId;
    result.generationState = value.generationState === 'running' ? 'running' : 'awaiting-approval';
  }
  if (value.models !== undefined) {
    if (!Array.isArray(value.models) || value.models.length > 200) throw new Error('Invalid models');
    result.models = value.models.map(model => {
      if (!text(model?.name) || !text(model.source) || typeof model.parameters !== 'string') throw new Error('Invalid model');
      return { name: model.name, source: model.source, parameters: model.parameters };
    });
  }
  if (value.nodes !== undefined) {
    if (!Array.isArray(value.nodes)) throw new Error('Canvas too large');
    result.nodes = value.nodes.map(node => {
      if (!text(node?.id) || !text(node.type, 100) || !coordinate(node.x) || !coordinate(node.y)) throw new Error('Invalid node');
      return { id: node.id, type: node.type, x: node.x, y: node.y,
        title: typeof node.title === 'string' ? node.title.slice(0, 500) : '',
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        ...(typeof node.textContent === 'string' ? { textContent: node.textContent } : {}),
        ...(Array.isArray(node.parentIds) ? { parentIds: node.parentIds.filter(id => id === '' || text(id)) } : {}),
        ...(Array.isArray(node.sourcePortIndices) ? { sourcePortIndices: node.sourcePortIndices.map(port => Number.isInteger(port) && port >= 0 && port < 100 ? port : 0) } : {}),
        ...(text(node.groupId) ? { groupId: node.groupId } : {}),
        ...(text(node[`${node.type.toLowerCase()}Model`]) ? { model: node[`${node.type.toLowerCase()}Model`] } : text(node.model) ? { model: node.model } : {}),
        ...(typeof node.parameters === 'string' ? { parameters: node.parameters } : {}),
        ...(text(node.status, 100) ? { status: node.status } : {}) };
    });
  }
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups)) throw new Error('Invalid groups');
    result.groups = value.groups.map(group => {
      if (!text(group?.id) || !Array.isArray(group.nodeIds) || !group.nodeIds.every(id => text(id))) throw new Error('Invalid group');
      return { id: group.id, label: typeof group.label === 'string' ? group.label.slice(0, 500) : '', nodeIds: group.nodeIds };
    });
  }
  if (value.selectedNodeIds !== undefined) {
    if (!Array.isArray(value.selectedNodeIds) || !value.selectedNodeIds.every(id => text(id))) throw new Error('Invalid selection');
    result.selectedNodeIds = value.selectedNodeIds;
  }
  if (value.created !== undefined) {
    if (!Array.isArray(value.created) || value.created.length > 100
      || value.created.some(item => !text(item?.ref, 128) || !text(item?.id))) throw new Error('Invalid created nodes');
    result.created = value.created.map(({ ref, id }) => ({ ref, id }));
  }
  if (value.assets !== undefined) {
    if (!Array.isArray(value.assets) || value.assets.length > 50 || value.assets.some(asset => !text(asset?.id, 128) || typeof asset.name !== 'string' || !['images', 'videos', 'audios'].includes(asset.type))) throw new Error('Invalid assets');
    result.assets = value.assets.map(asset => ({ id: asset.id, name: asset.name.slice(0, 500), type: asset.type }));
    if (value.nextOffset !== null && (!Number.isInteger(value.nextOffset) || value.nextOffset < 0 || value.nextOffset > 100000)) throw new Error('Invalid pagination');
    result.nextOffset = value.nextOffset;
  }
  return result;
}

const string = { type: 'string' };
const fields = { title: string, prompt: string, x: { type: 'number' }, y: { type: 'number' } };
const nodeIds = { type: 'array', items: string, minItems: 1, maxItems: 100, uniqueItems: true };
const portSchema = { type: 'integer', minimum: 0, maximum: 99 };
export const canvasControlVersion = 5;
export const canvasControlTool = {
  type: 'function', name: 'canvas_control',
  description: 'Operate the active AIFISHER project. In Codex functions.exec this tool returns JSON TEXT, not a JavaScript object. Parse it before reading fields: const state = JSON.parse(await tools.canvas_control({action: "read"})); then use state.revision for edit. media inspect reads video/audio metadata, samples frames and transcribes speech locally; optional times selects frames and speech=false skips transcription. Use media view to see images. read obtains nodes, selection, connections, groups and revision. edit applies atomic undoable create/update/delete/duplicate/connect/disconnect/group/ungroup/renameGroup/arrange/configure operations; refs address newly created objects. focus locates nodes. undo requires a returned operationId and current revision. assets(query,offset) searches the user library; importAsset uses its opaque assetId. models(type,model?) returns connected models and valid parameter descriptors for configure. projects(query,offset) lists user projects/folders. project(operation,revision,...) supports save/create/open/rename/duplicate/move/delete/createFolder/renameFolder/deleteFolder/import/export; open is deferred until the answer ends, import/export/delete return a user action card. media accepts current node IDs for image pixels (view), crop(rect), grid(rows,columns), frames(times), trimVideo/trimAudio(startTime,endTime), annotate(strokes,mask) with image-pixel coordinates, and collage(nodeIds). workflows(offset) lists imported execution templates. workflow supports describe(definitionId), insert(definitionId,x,y), configure(nodeId,parameters), always with revision; use the returned parameter descriptors. product(operation,revision,nodeId?) opens a visible user card for upload, replace, download, saveAsset, resize, workflowManager or runWorkflow. These reuse the existing file picker/editor/workflow runner; report awaiting-user, not completion. Workflow execution retains its original confirmation and is not part of automatic model batches. Results are new undoable nodes. tasks(nodeIds?) queries original attempts and text results; cancelTask requires nodeId and revision, and remoteMayContinue must be reported accurately. prepareGeneration(revision,nodeIds) journals up to 20 nodes/100 outputs and displays an approval card; dependent nodes execute after upstream success. It does not submit. prepareBudget(revision,nodeIds,maxRequests,maxOutputs,minutes,budgetCny?) requests a visible user authorization for those models and parameters; budgets lists grants, revokeBudget revokes. runGeneration(revision,generationPlanId,authorizationId) starts a prepared plan only within an already user-approved grant. New prompts and the same quantity of media may vary; execution parameters and connection configuration may not. A hard money cap requires a server-verified cost ceiling; unsupported sources are refused, not priced by estimates. Never auto-recreate or replay interrupted batches. IDs are opaque; never supply paths, URLs, credentials or system commands. Stale edits fail. UNCONFIRMED requires checking existing state, never replaying. Check receipts and distinguish pending/running from completed.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { enum: ['read', 'edit', 'undo', 'focus', 'assets', 'importAsset', 'models', 'prepareGeneration', 'projects', 'project', 'tasks', 'cancelTask', 'media', 'budgets', 'prepareBudget', 'revokeBudget', 'runGeneration', 'workflows', 'workflow', 'product'] }, revision: string, operationId: string, nodeIds, nodeId: string,
    definitionId: string, parameters: { type: 'object', additionalProperties: workflowParameterSchema },
    ...projectControlSchema,
    ...mediaControlSchema,
    ...budgetControlSchema,
    operation: { enum: [...projectControlSchema.operation.enum, 'view', 'inspect', 'crop', 'grid', 'frames', 'trimVideo', 'trimAudio', 'annotate', 'collage', 'describe', 'insert', 'configure', 'upload', 'replace', 'download', 'saveAsset', 'resize', 'workflowManager', 'runWorkflow'] },
    type: { enum: ['Image', 'Video', 'Audio', 'Text'] }, model: string,
    query: { type: 'string', maxLength: 200 }, offset: { type: 'integer', minimum: 0, maximum: 100000 }, assetId: string, x: fields.x, y: fields.y,
    // Keep the model-facing shape shallow. Native Codex code-mode renders deep
    // oneOf branches as unknown, hiding every operation field from the model.
    // validCanvasControl still enforces the exact fields for each operation.
    operations: { type: 'array', minItems: 1, maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['kind'],
      description: 'Use only fields for the selected kind. create: ref,type,x,y,title?,prompt?; update: nodeId,patch; configure: nodeId,model,parameters; delete: nodeId; connect: sourceId,targetId,sourcePort?; disconnect: sourceId,targetId,targetPort?; group: ref,nodeIds,label; ungroup: groupId; renameGroup: groupId,label; arrange: nodeIds,columns; duplicate: nodes,x,y. edit requires the latest read revision.',
      properties: {
        kind: { enum: ['create', 'update', 'configure', 'delete', 'connect', 'disconnect', 'group', 'ungroup', 'renameGroup', 'arrange', 'duplicate'] },
        ref: string, type: { enum: ['Image', 'Video', 'Audio', 'Text'] }, ...fields,
        nodeId: string, model: string,
        parameters: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
        patch: { type: 'object', additionalProperties: false, properties: fields },
        sourceId: string, targetId: string, sourcePort: portSchema, targetPort: portSchema,
        nodeIds, label: string, groupId: string,
        columns: { type: 'integer', minimum: 1, maximum: 100 },
        nodes: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['nodeId', 'ref'], properties: { nodeId: string, ref: string } } },
      },
    } },
  } },
};
