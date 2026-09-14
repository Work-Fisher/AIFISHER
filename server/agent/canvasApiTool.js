import { canvasControlTool } from '../../src/shared/canvasControlProtocol.js';

// Chat Completions supports discriminated operation schemas. Codex keeps its
// shallow code-mode schema; both transports still execute the same strict protocol.
const edits = {
  create: ['ref', 'type', 'x', 'y'], update: ['nodeId', 'patch'], configure: ['nodeId', 'model', 'parameters'],
  delete: ['nodeId'], connect: ['sourceId', 'targetId'], disconnect: ['sourceId', 'targetId'],
  group: ['ref', 'nodeIds', 'label'], ungroup: ['groupId'], renameGroup: ['groupId', 'label'],
  arrange: ['nodeIds', 'columns'], duplicate: ['nodes', 'x', 'y'],
};
const optional = { create: ['title', 'prompt'], connect: ['sourcePort'], disconnect: ['targetPort'] };
const actions = {
  read: [[], []], models: [['type'], ['model']], edit: [['revision', 'operations'], []],
  focus: [['nodeIds'], []], undo: [['revision', 'operationId'], []],
  assets: [[], ['query', 'offset']], importAsset: [['revision', 'assetId', 'x', 'y'], []],
  prepareGeneration: [['revision', 'nodeIds'], []], projects: [[], ['query', 'offset']],
  project: [['revision', 'operation'], ['projectId', 'folderId', 'title']],
  tasks: [[], ['nodeIds']], cancelTask: [['revision', 'nodeId'], []],
  media: [['revision', 'operation', 'nodeId'], ['nodeIds', 'rect', 'rows', 'columns', 'times', 'speech', 'startTime', 'endTime', 'strokes', 'mask']],
  budgets: [[], []], prepareBudget: [['revision', 'nodeIds', 'maxRequests', 'maxOutputs', 'minutes'], ['budgetCny']],
  revokeBudget: [['authorizationId'], []], runGeneration: [['revision', 'generationPlanId', 'authorizationId'], []],
  workflows: [[], ['offset']], workflow: [['revision', 'operation'], ['definitionId', 'nodeId', 'parameters', 'x', 'y']],
  product: [['revision', 'operation'], ['nodeId']],
};
export function canvasApiTool() {
  const parameters = structuredClone(canvasControlTool.inputSchema);
  const fields = parameters.properties.operations.items.properties;
  parameters.properties.operations.items = { oneOf: Object.entries(edits).map(([kind, required]) => ({
    type: 'object', additionalProperties: false, required: ['kind', ...required],
    properties: { kind: { const: kind }, ...Object.fromEntries([...required, ...(optional[kind] || [])].map(key => [key, fields[key]])) },
  })) };
  parameters.properties.revision.description = 'Required for mutations. For read, omit revision and all other fields.';
  parameters.oneOf = Object.entries(actions).map(([action, [required, optional]]) => ({
    type: 'object', additionalProperties: false, required: ['action', ...required],
    properties: { action: { const: action }, ...Object.fromEntries([...required, ...optional].map(key => [key, parameters.properties[key]])) },
  }));
  const declareStringEnums = schema => {
    if (!schema || typeof schema !== 'object') return;
    if (Array.isArray(schema.enum) && schema.enum.every(value => typeof value === 'string') || typeof schema.const === 'string') schema.type = 'string';
    Object.values(schema).forEach(value => {
      if (Array.isArray(value)) value.forEach(declareStringEnums);
      else if (value && typeof value === 'object') declareStringEnums(value);
    });
  };
  declareStringEnums(parameters);
  return { type: 'function', function: { name: canvasControlTool.name,
    description: 'Operate the active AIFISHER project by calling canvas_control directly with a JSON object. '
      + 'Start with {"action":"read"}; use the returned revision for edits. '
      + 'To prepare a video node: query {"action":"models","type":"Video"}, then query the chosen exact model name for parameters; '
      + 'Example edit: {"action":"edit","revision":"returned revision","operations":[{"kind":"create","ref":"video","type":"Video","x":0,"y":0,"prompt":"the complete prompt"},{"kind":"configure","nodeId":"video","model":"returned model name","parameters":{}}]}. '
      + 'A create ref is used directly as nodeId within that batch, without a prefix. Creation and configuration do not generate media. '
      + canvasControlTool.description.slice(canvasControlTool.description.indexOf('media inspect')), parameters } };
}

/** Static correction metadata only: never echo model-supplied values or unknown field names. */
export function invalidCanvasArguments(command) {
  const action = Object.hasOwn(actions, command?.action) ? command.action : null;
  const shape = (required, optional = []) => ({ required, allowedFields: [...required, ...optional] });
  return { ok: false, code: 'INVALID', message: command === undefined
    ? 'function.arguments 不是合法 JSON，本次未执行。必须使用双引号包裹键名和字符串，并完整保留首尾大括号。例如：{"action":"read"}。请修正序列化格式。'
    : '工具参数未通过校验，本次未执行。按 expected 修正参数后再调用；省略无关字段。',
    expected: action ? { action, ...shape(['action', ...actions[action][0]], actions[action][1]),
      ...(action === 'models' ? { type: ['Image', 'Video', 'Audio', 'Text'] } : {}),
      ...(action === 'edit' ? { operations: Object.entries(edits).map(([kind, required]) => ({ kind, ...shape(['kind', ...required], optional[kind]) })),
        revision: '先 read，使用返回的最新 revision。', nodeType: ['Image', 'Video', 'Audio', 'Text'],
        configure: 'model 使用 models 返回的完整名称；parameters 只填该模型公开的参数，使用默认值时传 {}。prompt 属于 create 或 update.patch。' } : {}) }
      : { actions: Object.keys(actions), firstCall: { action: 'read' } } };
}
