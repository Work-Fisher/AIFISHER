import crypto from 'node:crypto';

export const WORKFLOW_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxNodes: 5_000,
  maxLinks: 20_000,
  maxDepth: 80,
});

const MODEL_FIELDS = Object.freeze({
  ckpt_name: 'checkpoints',
  unet_name: 'diffusionModels',
  clip_name: 'textEncoders',
  vae_name: 'vaes',
  lora_name: 'loras',
});

const UI_ONLY_NODE_TYPES = /^(?:Note|MarkdownNote|PrimitiveNode|Reroute)$/i;
const UI_REROUTE_NODE_TYPES = /^Reroute$/i;
const UI_PRIMITIVE_NODE_TYPES = /^PrimitiveNode$/i;
const OUTPUT_NODE_TYPES = /(?:Save|Preview|Output|VideoCombine|Audio.*Save)/i;

export class WorkflowFormatError extends Error {
  constructor(message, code = 'INVALID_WORKFLOW', details = undefined) {
    super(message);
    this.name = 'WorkflowFormatError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonDepth(value, maximum, depth = 0) {
  if (depth > maximum) {
    throw new WorkflowFormatError('工作流 JSON 嵌套过深', 'WORKFLOW_DEPTH_LIMIT');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonDepth(item, maximum, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) assertJsonDepth(item, maximum, depth + 1);
  }
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right, 'en'))
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Json(value) {
  return sha256Bytes(canonicalJson(value));
}

function looksLikeApiWorkflow(value) {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, node]) =>
    isPlainObject(node)
    && isPlainObject(node.inputs))
    && entries.some(([, node]) => hasApiClassType(node));
}

function hasApiClassType(node) {
  return typeof node.class_type === 'string' && Boolean(node.class_type.trim());
}

export function detectWorkflowFormat(workflow) {
  if (looksLikeApiWorkflow(workflow)) return 'comfy-api';
  if (!isPlainObject(workflow) || !Array.isArray(workflow.nodes)) return 'unknown';
  if (Object.hasOwn(workflow, 'version')) {
    if (workflow.version === 1) return 'comfy-ui-1.0';
    if (workflow.version === 0.4) return 'comfy-ui-0.4';
    return 'comfy-ui-unknown';
  }
  if (
    Object.hasOwn(workflow, 'last_node_id')
    || Object.hasOwn(workflow, 'last_link_id')
  ) return 'comfy-ui-0.4';
  return 'comfy-ui-unknown';
}

function linkId(link, format) {
  return format === 'comfy-ui-1.0' ? link?.id : link?.[0];
}

function linkEndpoints(link, format) {
  if (format === 'comfy-ui-1.0') {
    return {
      originId: link?.origin_id,
      originSlot: link?.origin_slot,
      targetId: link?.target_id,
      targetSlot: link?.target_slot,
    };
  }
  return {
    originId: link?.[1],
    originSlot: link?.[2],
    targetId: link?.[3],
    targetSlot: link?.[4],
  };
}

function validateUiWorkflow(workflow, format, limits) {
  if (format === 'comfy-ui-1.0' && !isPlainObject(workflow.state)) {
    throw new WorkflowFormatError('v1.0 工作流缺少 state', 'INVALID_UI_VERSION_STRUCTURE');
  }
  if (workflow.nodes.length > limits.maxNodes) {
    throw new WorkflowFormatError('工作流节点数量超过限制', 'WORKFLOW_NODE_LIMIT');
  }
  if (workflow.links != null && !Array.isArray(workflow.links)) {
    throw new WorkflowFormatError('普通工作流 links 必须是数组', 'INVALID_UI_LINKS');
  }
  const links = workflow.links || [];
  if (links.length > limits.maxLinks) {
    throw new WorkflowFormatError('工作流连线数量超过限制', 'WORKFLOW_LINK_LIMIT');
  }

  const nodeIds = new Set();
  for (const node of workflow.nodes) {
    if (!isPlainObject(node) || node.id == null || typeof node.type !== 'string') {
      throw new WorkflowFormatError('普通工作流包含无效节点', 'INVALID_UI_NODE');
    }
    if (node.inputs != null && !Array.isArray(node.inputs)) {
      throw new WorkflowFormatError('普通工作流节点 inputs 必须是数组', 'INVALID_UI_NODE_INPUTS');
    }
    if (node.outputs != null && !Array.isArray(node.outputs)) {
      throw new WorkflowFormatError('普通工作流节点 outputs 必须是数组', 'INVALID_UI_NODE_OUTPUTS');
    }
    const id = String(node.id);
    if (nodeIds.has(id)) {
      throw new WorkflowFormatError(`普通工作流包含重复节点 ID：${id}`, 'DUPLICATE_NODE_ID');
    }
    nodeIds.add(id);
  }

  const linkIds = new Set();
  for (const link of links) {
    const id = linkId(link, format);
    const endpoints = linkEndpoints(link, format);
    if (id == null || endpoints.originId == null || endpoints.targetId == null) {
      throw new WorkflowFormatError('普通工作流包含无效连线', 'INVALID_UI_LINK');
    }
    if (
      !Number.isInteger(endpoints.originSlot)
      || endpoints.originSlot < 0
      || !Number.isInteger(endpoints.targetSlot)
      || endpoints.targetSlot < 0
    ) {
      throw new WorkflowFormatError('普通工作流包含无效连线槽', 'INVALID_UI_LINK_SLOT');
    }
    if (linkIds.has(String(id))) {
      throw new WorkflowFormatError(`普通工作流包含重复连线 ID：${id}`, 'DUPLICATE_LINK_ID');
    }
    linkIds.add(String(id));
    if (!nodeIds.has(String(endpoints.originId)) || !nodeIds.has(String(endpoints.targetId))) {
      throw new WorkflowFormatError(`普通工作流连线 ${id} 引用了不存在的节点`, 'BROKEN_LINK');
    }
  }
}

function validateUnknownUiWorkflow(workflow, limits) {
  if (workflow.nodes.length > limits.maxNodes) {
    throw new WorkflowFormatError('工作流节点数量超过限制', 'WORKFLOW_NODE_LIMIT');
  }
  if (Array.isArray(workflow.links) && workflow.links.length > limits.maxLinks) {
    throw new WorkflowFormatError('工作流连线数量超过限制', 'WORKFLOW_LINK_LIMIT');
  }
  const nodeIds = new Set();
  for (const node of workflow.nodes) {
    if (!isPlainObject(node) || node.id == null || typeof node.type !== 'string') {
      throw new WorkflowFormatError('普通工作流包含无效节点', 'INVALID_UI_NODE');
    }
    const id = String(node.id);
    if (nodeIds.has(id)) {
      throw new WorkflowFormatError(`普通工作流包含重复节点 ID：${id}`, 'DUPLICATE_NODE_ID');
    }
    nodeIds.add(id);
  }
}

function connectionTarget(value) {
  if (
    Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'string'
    && Number.isInteger(value[1])
    && value[1] >= 0
  ) return value[0];
  return null;
}

function validateApiWorkflow(workflow, limits) {
  const entries = Object.entries(workflow);
  if (entries.length > limits.maxNodes) {
    throw new WorkflowFormatError('工作流节点数量超过限制', 'WORKFLOW_NODE_LIMIT');
  }
  const nodeIds = new Set(entries.map(([id]) => id));
  const incompleteNodeIds = new Set(entries.filter(([, node]) => !hasApiClassType(node)).map(([id]) => id));
  let connectionCount = 0;
  for (const [nodeId, node] of entries) {
    if (!nodeId || !isPlainObject(node.inputs)) {
      throw new WorkflowFormatError(`API 工作流节点 ${nodeId || '<空>'} 无效`, 'INVALID_API_NODE');
    }
    // An unreferenced incomplete export can be kept in the source artifact but
    // omitted from the executable plan. Never remove a dependency of a valid node.
    if (incompleteNodeIds.has(nodeId)) continue;
    for (const [fieldName, value] of Object.entries(node.inputs)) {
      const resemblesConnection = Array.isArray(value)
        && value.length === 2
        && typeof value[0] === 'string'
        && (nodeIds.has(value[0]) || typeof value[1] === 'number');
      if (resemblesConnection && (!Number.isInteger(value[1]) || value[1] < 0)) {
        throw new WorkflowFormatError(
          `API 工作流节点 ${nodeId}.${fieldName} 包含无效输出槽`,
          'INVALID_API_LINK',
        );
      }
      const target = connectionTarget(value);
      if (!target) continue;
      if (incompleteNodeIds.has(target)) {
        throw new WorkflowFormatError(
          `API 工作流节点 ${target} 缺少 class_type，节点 ${nodeId}.${fieldName} 仍依赖它。请在 ComfyUI 中恢复该节点，或断开不需要的分支后重新导出。`,
          'INCOMPLETE_API_NODE_DEPENDENCY',
          { nodeId: target, dependentNodeId: nodeId, fieldName },
        );
      }
      connectionCount += 1;
      if (!nodeIds.has(target)) {
        throw new WorkflowFormatError(
          `API 工作流节点 ${nodeId}.${fieldName} 引用了不存在的节点 ${target}`,
          'BROKEN_LINK',
        );
      }
    }
  }
  if (connectionCount > limits.maxLinks) {
    throw new WorkflowFormatError('工作流连线数量超过限制', 'WORKFLOW_LINK_LIMIT');
  }
}

export function parseWorkflowArtifact(content, {
  limits = WORKFLOW_LIMITS,
} = {}) {
  const bytes = Buffer.isBuffer(content)
    ? Buffer.from(content)
    : content instanceof Uint8Array
      ? Buffer.from(content)
      : typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : null;
  if (!bytes) throw new WorkflowFormatError('工作流内容必须是 JSON 字节或文本', 'INVALID_WORKFLOW_CONTENT');
  if (bytes.length === 0 || bytes.length > limits.maxBytes) {
    throw new WorkflowFormatError('工作流文件大小无效或超过限制', 'WORKFLOW_SIZE_LIMIT');
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new WorkflowFormatError('工作流不是有效 UTF-8 文本', 'INVALID_UTF8', { cause: cause.message });
  }
  let workflow;
  try {
    const jsonText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    workflow = JSON.parse(jsonText);
  } catch (cause) {
    throw new WorkflowFormatError('工作流不是有效 JSON', 'INVALID_JSON', { cause: cause.message });
  }
  assertJsonDepth(workflow, limits.maxDepth);
  const format = detectWorkflowFormat(workflow);
  if (format === 'unknown') {
    throw new WorkflowFormatError('无法识别工作流格式', 'UNKNOWN_WORKFLOW_FORMAT');
  }
  if (format === 'comfy-api') validateApiWorkflow(workflow, limits);
  else if (format === 'comfy-ui-unknown') validateUnknownUiWorkflow(workflow, limits);
  else validateUiWorkflow(workflow, format, limits);

  return {
    bytes,
    text,
    workflow,
    format,
    byteLength: bytes.length,
    sourceSha256: sha256Bytes(bytes),
  };
}

function positionPair(value) {
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0];
  if (isPlainObject(value)) return [Number(value[0]) || 0, Number(value[1]) || 0];
  return [0, 0];
}

function groupBounds(group) {
  const bounds = group?.bounding || group?.bounds;
  return Array.isArray(bounds) && bounds.length >= 4
    ? bounds.slice(0, 4).map((value) => Number(value) || 0)
    : null;
}

function uiGroups(workflow) {
  return (Array.isArray(workflow.groups) ? workflow.groups : []).map((group, index) => ({
    id: String(group?.id ?? index),
    title: String(group?.title || `Group ${index + 1}`),
    bounds: groupBounds(group),
  }));
}

function groupForNode(node, groups) {
  const [x, y] = positionPair(node.pos);
  const [width, height] = positionPair(node.size);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return groups.find((group) => {
    if (!group.bounds) return false;
    const [left, top, groupWidth, groupHeight] = group.bounds;
    return centerX >= left && centerX <= left + groupWidth
      && centerY >= top && centerY <= top + groupHeight;
  }) || null;
}

function directSchemaInput(nodeDefinition, fieldName) {
  return nodeDefinition?.input?.required?.[fieldName]
    || nodeDefinition?.input?.optional?.[fieldName]
    || null;
}

function conditionalSchemaInput(nodeDefinition, fieldName, nodeInputs) {
  for (const [selectorName, selectorValue] of Object.entries(nodeInputs || {})) {
    if (typeof selectorValue !== 'string') continue;
    const selector = directSchemaInput(nodeDefinition, selectorName);
    const entries = selector?.[1]?.formats?.[selectorValue];
    if (!Array.isArray(entries)) continue;
    const entry = entries.find((candidate) => Array.isArray(candidate) && candidate[0] === fieldName);
    if (!entry) continue;
    if (Array.isArray(entry[1])) return [entry[1], isPlainObject(entry[2]) ? entry[2] : {}];
    if (typeof entry[1] === 'string') return [entry[1], isPlainObject(entry[2]) ? entry[2] : {}];
  }
  return null;
}

function autogrowSchemaInput(nodeDefinition, fieldName) {
  const separator = fieldName.indexOf('.');
  if (separator <= 0) return null;
  const containerName = fieldName.slice(0, separator);
  const childName = fieldName.slice(separator + 1);
  const container = directSchemaInput(nodeDefinition, containerName);
  if (!/^COMFY_AUTOGROW/i.test(String(container?.[0] || ''))) return null;
  const template = container?.[1]?.template;
  const fields = {
    ...(template?.input?.required || {}),
    ...(template?.input?.optional || {}),
  };
  if (fields[childName]) return fields[childName];
  if (Array.isArray(template?.names) && template.names.includes(childName)) {
    return Object.values(fields)[0] || null;
  }
  if (typeof template?.prefix === 'string' && childName.startsWith(template.prefix)) {
    return Object.values(fields)[0] || null;
  }
  return null;
}

function schemaInput(nodeDefinition, fieldName, nodeInputs = null) {
  return directSchemaInput(nodeDefinition, fieldName)
    || autogrowSchemaInput(nodeDefinition, fieldName)
    || conditionalSchemaInput(nodeDefinition, fieldName, nodeInputs)
    || null;
}

function schemaOptions(specification) {
  if (Array.isArray(specification?.[0])) return specification[0];
  if (
    String(specification?.[0] || '').toUpperCase() === 'COMBO'
    && Array.isArray(specification?.[1]?.options)
  ) return specification[1].options;
  return null;
}

function schemaType(specification, value) {
  const declared = specification?.[0];
  if (Array.isArray(declared)) return 'COMBO';
  if (typeof declared === 'string') {
    const normalized = declared.toUpperCase();
    if (normalized === 'COMBO') return 'COMBO';
    if (normalized.includes(',')) {
      if (typeof value === 'boolean' && normalized.split(',').includes('BOOLEAN')) return 'BOOLEAN';
      if (Number.isInteger(value) && normalized.split(',').includes('INT')) return 'INT';
      if (typeof value === 'number' && normalized.split(',').includes('FLOAT')) return 'FLOAT';
      if (typeof value === 'string' && normalized.split(',').includes('STRING')) return 'STRING';
    }
    return normalized;
  }
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (Number.isInteger(value)) return 'INT';
  if (typeof value === 'number') return 'FLOAT';
  return 'UNKNOWN';
}

function mediaKindFor(type, fieldName, specification, classType) {
  const declared = String(type || '').toUpperCase().split(',').map((item) => item.trim());
  if (declared.includes('MASK')) return 'mask';
  if (declared.includes('IMAGE')) return 'image';
  if (declared.includes('AUDIO')) return 'audio';
  if (declared.includes('VIDEO')) return 'video';

  const options = isPlainObject(specification?.[1]) ? specification[1] : {};
  const uploadKind = Object.entries(options).find(([key, enabled]) => (
    enabled === true && /^(?:image|mask|audio|video)_upload$/i.test(key)
  ))?.[0]?.replace(/_upload$/i, '').toLowerCase();
  if (['image', 'mask', 'audio', 'video'].includes(uploadKind)) return uploadKind;

  // A loader also has rate, size, format and other scalar settings. Its class
  // name alone does not make every field a media upload input.
  if (!['STRING', 'COMBO'].includes(String(type).toUpperCase())
    || !/^(?:(?:image|mask|audio|video)(?:_path|_file|_filename)?|file|filename|path|file_path)$/i.test(fieldName)) return null;
  const loader = `${classType || ''} ${fieldName}`.toLowerCase();
  if (/load.*mask/.test(loader)) return 'mask';
  if (/load.*image/.test(loader)) return 'image';
  if (/load.*audio/.test(loader)) return 'audio';
  if (/load.*video/.test(loader)) return 'video';
  return null;
}

function controlFor(type, specification, fieldName, classType) {
  const options = specification?.[1] || {};
  if (mediaKindFor(type, fieldName, specification, classType)) return 'asset';
  if (/seed/i.test(fieldName)) return 'seed';
  if (schemaOptions(specification)) return 'select';
  if (type === 'BOOLEAN') return 'toggle';
  if (type === 'INT' || type === 'FLOAT' || type === 'NUMBER') {
    return Number.isFinite(options.min) && Number.isFinite(options.max) ? 'slider' : 'number';
  }
  if (type === 'STRING') return options.multiline ? 'textarea' : 'text';
  return 'text';
}

function candidateBinding(nodeId, node, fieldName, value, objectInfo) {
  const definition = objectInfo?.[node.class_type];
  const specification = schemaInput(definition, fieldName, node.inputs);
  const type = schemaType(specification, value);
  const options = isPlainObject(specification?.[1]) ? specification[1] : {};
  return {
    nodeId,
    classType: node.class_type,
    nodeTitle: node?._meta?.title || definition?.display_name || node.class_type,
    fieldName,
    value,
    valueType: type,
    required: Boolean(definition?.input?.required?.[fieldName]),
    connected: false,
    control: controlFor(type, specification, fieldName, node.class_type),
    mediaKind: mediaKindFor(type, fieldName, specification, node.class_type),
    modelKind: MODEL_FIELDS[fieldName] || null,
    options: schemaOptions(specification),
    minimum: Number.isFinite(options.min) ? options.min : null,
    maximum: Number.isFinite(options.max) ? options.max : null,
    step: Number.isFinite(options.step) ? options.step : null,
    confidence: specification ? 'high' : 'low',
  };
}

function apiRequirements(workflow) {
  const nodeTypes = new Set();
  const models = new Map();
  for (const node of Object.values(workflow)) {
    nodeTypes.add(node.class_type);
    for (const [fieldName, modelKind] of Object.entries(MODEL_FIELDS)) {
      const value = node.inputs[fieldName];
      if (typeof value !== 'string' || !value.trim()) continue;
      models.set(`${modelKind}:${value}`, { type: modelKind, name: value });
    }
  }
  return {
    nodeTypes: [...nodeTypes].sort(),
    models: [...models.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function createCapabilityProjection(apiWorkflow, objectInfo = {}) {
  const projection = {};
  for (const classType of apiRequirements(apiWorkflow).nodeTypes) {
    const definition = objectInfo[classType];
    if (!definition) continue;
    projection[classType] = {
      input: definition.input || {},
      input_order: definition.input_order || null,
      output: definition.output || [],
      output_name: definition.output_name || [],
      output_node: Boolean(definition.output_node),
    };
  }
  return {
    nodeDefinitions: projection,
    relevantCapabilityHash: sha256Json(projection),
  };
}

export function normalizeApiWorkflow(workflow, { limits = WORKFLOW_LIMITS } = {}) {
  if (!looksLikeApiWorkflow(workflow)) {
    throw new WorkflowFormatError('内容不是 ComfyUI API Format', 'INVALID_API_WORKFLOW');
  }
  validateApiWorkflow(workflow, limits);
  return JSON.parse(canonicalJson(Object.fromEntries(
    Object.entries(workflow).filter(([, node]) => hasApiClassType(node)),
  )));
}

function analyzeApiWorkflow(workflow, objectInfo) {
  const nodes = [];
  const candidateBindings = [];
  const candidateOutputs = [];
  const warnings = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    const definition = objectInfo?.[node.class_type];
    nodes.push({
      id: nodeId,
      classType: node.class_type,
      title: node?._meta?.title || definition?.display_name || node.class_type,
      inputCount: Object.keys(node.inputs).length,
      capabilityAvailable: objectInfo ? Boolean(definition) : null,
    });
    if (objectInfo && !definition) warnings.push({
      code: 'MISSING_NODE_TYPE',
      nodeId,
      classType: node.class_type,
    });
    for (const [fieldName, value] of Object.entries(node.inputs)) {
      const sourceId = connectionTarget(value);
      if (sourceId) {
        if (objectInfo) {
          const sourceNode = workflow[sourceId];
          const sourceDefinition = objectInfo?.[sourceNode?.class_type];
          const targetSpecification = schemaInput(definition, fieldName, node.inputs);
          const outputSlot = value[1];
          const runtimeOutputType = Array.isArray(sourceDefinition?.output)
            ? sourceDefinition.output[outputSlot]
            : undefined;
          const runtimeInputType = typeof targetSpecification?.[0] === 'string'
            ? targetSpecification[0]
            : undefined;
          if (
            !definition
            || !sourceDefinition
            || !Array.isArray(sourceDefinition.output)
            || outputSlot >= sourceDefinition.output.length
            || !normalizedConnectionType(runtimeOutputType)
            || !targetSpecification
            || !runtimeInputType
            || !concreteConnectionTypesMatch([runtimeOutputType, runtimeInputType])
          ) {
            warnings.push({
              code: 'RUNTIME_SLOT_MISMATCH',
              nodeId,
              fieldName,
              sourceNodeId: sourceId,
              outputSlot,
            });
          }
        }
        continue;
      }
      if (objectInfo && definition) {
        const specification = schemaInput(definition, fieldName, node.inputs);
        if (!specification) {
          warnings.push({ code: 'UNKNOWN_NODE_INPUT', nodeId, fieldName });
        } else if (!acceptsWidgetValue(specification, value)) {
          warnings.push({ code: 'INVALID_INPUT_VALUE', nodeId, fieldName });
        }
      }
      candidateBindings.push(candidateBinding(nodeId, node, fieldName, value, objectInfo));
    }
    if (definition) {
      for (const fieldName of Object.keys(definition.input?.required || {})) {
        const specification = definition.input.required[fieldName];
        const dynamicPresent = /^COMFY_AUTOGROW/i.test(String(specification?.[0] || ''))
          && Object.keys(node.inputs).some((candidate) => candidate.startsWith(`${fieldName}.`));
        if (!Object.hasOwn(node.inputs, fieldName) && !dynamicPresent) {
          warnings.push({ code: 'MISSING_REQUIRED_INPUT', nodeId, fieldName });
        }
      }
    }
    if (definition?.output_node || OUTPUT_NODE_TYPES.test(node.class_type)) {
      candidateOutputs.push({
        nodeId,
        classType: node.class_type,
        title: node?._meta?.title || definition?.display_name || node.class_type,
        outputTypes: definition?.output || [],
      });
    }
  }

  const capability = objectInfo ? createCapabilityProjection(workflow, objectInfo) : null;
  return {
    format: 'comfy-api',
    nodeCount: nodes.length,
    linkCount: Object.values(workflow).reduce(
      (total, node) => total + Object.values(node.inputs).filter(connectionTarget).length,
      0,
    ),
    nodes,
    groups: [],
    candidateBindings,
    candidateOutputs,
    requirements: apiRequirements(workflow),
    warnings,
    // API Format is already the executable contract. object_info can enrich
    // controls and diagnostics, but ComfyUI remains the execution authority.
    compileStatus: 'ready',
    ...(capability || {}),
  };
}

function definitionFieldOrder(definition) {
  const requiredOrder = Array.isArray(definition?.input_order?.required)
    ? definition.input_order.required
    : Object.keys(definition?.input?.required || {});
  const optionalOrder = Array.isArray(definition?.input_order?.optional)
    ? definition.input_order.optional
    : Object.keys(definition?.input?.optional || {});
  return [...requiredOrder, ...optionalOrder];
}

function acceptsWidgetValue(specification, value) {
  const type = schemaType(specification, value);
  const options = schemaOptions(specification);
  if (options) return options.includes(value);
  if (type === 'STRING') return typeof value === 'string';
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  if (type === 'INT') return Number.isInteger(value);
  if (type === 'FLOAT' || type === 'NUMBER') return typeof value === 'number';
  if (type === 'JSON') return value !== null && typeof value === 'object';
  return false;
}

function explicitSchemaDefault(specification) {
  const options = isPlainObject(specification?.[1]) ? specification[1] : null;
  if (!options || !Object.hasOwn(options, 'default')) return { found: false };
  return { found: true, value: options.default };
}

function slotAt(slots, slot) {
  if (!Array.isArray(slots)) return null;
  const explicit = slots.find((item) => String(item?.slot_index) === String(slot));
  if (explicit) return explicit;
  const index = Number(slot);
  return Number.isInteger(index) && index >= 0 ? slots[index] || null : null;
}

function validateUiLinkSemantics(workflow, format) {
  const nodes = new Map(workflow.nodes.map((node) => [String(node.id), node]));
  const links = new Map((workflow.links || []).map((link) => [String(linkId(link, format)), link]));
  const originOwners = new Map();
  const targetOwners = new Map();
  const validLinkIds = new Set();
  const warnings = [];

  const recordOwner = (owners, id, owner) => {
    const existing = owners.get(id) || [];
    existing.push(owner);
    owners.set(id, existing);
  };

  for (const [nodeId, node] of nodes) {
    for (const [index, input] of (Array.isArray(node.inputs) ? node.inputs : []).entries()) {
      if (input?.link == null) continue;
      const id = String(input.link);
      const slot = input.slot_index ?? index;
      recordOwner(targetOwners, id, { nodeId, slot });
      const link = links.get(id);
      const endpoints = link ? linkEndpoints(link, format) : null;
      if (
        !endpoints
        || String(endpoints.targetId) !== nodeId
        || String(endpoints.targetSlot) !== String(slot)
      ) {
        warnings.push({ code: 'INCONSISTENT_UI_LINK_SLOT', linkId: id, nodeId, side: 'target' });
      }
    }
    for (const [index, output] of (Array.isArray(node.outputs) ? node.outputs : []).entries()) {
      const slot = output?.slot_index ?? index;
      for (const candidate of Array.isArray(output?.links) ? output.links : []) {
        const id = String(candidate);
        recordOwner(originOwners, id, { nodeId, slot });
        const link = links.get(id);
        const endpoints = link ? linkEndpoints(link, format) : null;
        if (
          !endpoints
          || String(endpoints.originId) !== nodeId
          || String(endpoints.originSlot) !== String(slot)
        ) {
          warnings.push({ code: 'INCONSISTENT_UI_LINK_SLOT', linkId: id, nodeId, side: 'origin' });
        }
      }
    }
  }

  for (const link of workflow.links || []) {
    const id = String(linkId(link, format));
    const endpoints = linkEndpoints(link, format);
    const origin = nodes.get(String(endpoints.originId));
    const target = nodes.get(String(endpoints.targetId));
    const originOutput = slotAt(origin?.outputs, endpoints.originSlot);
    const targetInput = slotAt(target?.inputs, endpoints.targetSlot);
    const originReferences = originOwners.get(id) || [];
    const targetReferences = targetOwners.get(id) || [];
    if (
      !originOutput
      || !targetInput
      || originReferences.length !== 1
      || targetReferences.length !== 1
    ) {
      warnings.push({
        code: 'INCONSISTENT_UI_LINK_SLOT',
        linkId: id,
        originNodeId: String(endpoints.originId),
        targetNodeId: String(endpoints.targetId),
      });
      continue;
    }
    validLinkIds.add(id);
  }
  return { validLinkIds, warnings };
}

function linkType(link, format) {
  return format === 'comfy-ui-1.0' ? link?.type : link?.[5];
}

function normalizedConnectionType(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function concreteConnectionTypesMatch(values) {
  const typeSets = values
    .map((value) => normalizedConnectionType(value))
    .filter((value) => value && !['ANY', '*'].includes(value))
    .map((value) => new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
  if (typeSets.length <= 1) return true;
  let compatible = new Set(typeSets[0]);
  for (const types of typeSets.slice(1)) {
    compatible = new Set([...compatible].filter((type) => types.has(type)));
    if (!compatible.size) return false;
  }
  return true;
}

function validateUiLinkRuntimeSemantics(workflow, format, objectInfo, structurallyValidIds) {
  const nodes = new Map(workflow.nodes.map((node) => [String(node.id), node]));
  const validLinkIds = new Set();
  const warnings = [];
  for (const link of workflow.links || []) {
    const id = String(linkId(link, format));
    if (!structurallyValidIds.has(id)) continue;
    const endpoints = linkEndpoints(link, format);
    const origin = nodes.get(String(endpoints.originId));
    const target = nodes.get(String(endpoints.targetId));
    const originDefinition = objectInfo?.[origin?.type];
    const targetDefinition = objectInfo?.[target?.type];
    const originSlot = Number(endpoints.originSlot);
    const originOutput = slotAt(origin?.outputs, endpoints.originSlot);
    const targetInput = slotAt(target?.inputs, endpoints.targetSlot);
    const targetSpecification = schemaInput(targetDefinition, targetInput?.name);
    const runtimeOutputType = Number.isInteger(originSlot)
      && Array.isArray(originDefinition?.output)
      ? originDefinition.output[originSlot]
      : undefined;
    const runtimeInputType = typeof targetSpecification?.[0] === 'string'
      ? targetSpecification[0]
      : undefined;
    const typeEvidence = [
      linkType(link, format),
      originOutput?.type,
      targetInput?.type,
      runtimeOutputType,
      runtimeInputType,
    ];
    const typeMatches = concreteConnectionTypesMatch(typeEvidence);
    if (
      !Number.isInteger(originSlot)
      || originSlot < 0
      || !Array.isArray(originDefinition?.output)
      || originSlot >= originDefinition.output.length
      || !normalizedConnectionType(runtimeOutputType)
      || !targetSpecification
      || !runtimeInputType
      || !typeMatches
    ) {
      warnings.push({
        code: 'RUNTIME_SLOT_MISMATCH',
        linkId: id,
        originNodeId: String(endpoints.originId),
        targetNodeId: String(endpoints.targetId),
      });
      continue;
    }
    validLinkIds.add(id);
  }
  return { validLinkIds, warnings };
}

function primitiveWidgetValue(node) {
  if (Array.isArray(node?.widgets_values) && node.widgets_values.length === 1) {
    return { found: true, value: node.widgets_values[0] };
  }
  if (isPlainObject(node?.widgets_values)) {
    const values = Object.values(node.widgets_values);
    if (values.length === 1) return { found: true, value: values[0] };
  }
  return { found: false, value: undefined };
}

function projectUiExecutionGraph(uiWorkflow, format, executableNodes, apiWorkflow, validLinkIds) {
  const allNodes = new Map(uiWorkflow.nodes.map((node) => [String(node.id), node]));
  const linksByOrigin = new Map();
  const linksByTarget = new Map();
  for (const link of uiWorkflow.links || []) {
    const id = String(linkId(link, format));
    if (!validLinkIds.has(id)) continue;
    const endpoints = linkEndpoints(link, format);
    const originId = String(endpoints.originId);
    const existing = linksByOrigin.get(originId) || [];
    existing.push(link);
    linksByOrigin.set(originId, existing);
    const targetId = String(endpoints.targetId);
    const targetLinks = linksByTarget.get(targetId) || [];
    targetLinks.push(link);
    linksByTarget.set(targetId, targetLinks);
  }

  const uiEdges = [];
  const projectionConflicts = [];
  const projectedTargets = [];

  const reachableReroutes = new Set([
    ...executableNodes.keys(),
    ...[...allNodes]
      .filter(([, node]) => UI_PRIMITIVE_NODE_TYPES.test(node.type))
      .map(([nodeId]) => nodeId),
  ]);
  let reachabilityChanged = true;
  while (reachabilityChanged) {
    reachabilityChanged = false;
    for (const link of uiWorkflow.links || []) {
      if (!validLinkIds.has(String(linkId(link, format)))) continue;
      const endpoints = linkEndpoints(link, format);
      const originId = String(endpoints.originId);
      const targetId = String(endpoints.targetId);
      if (
        reachableReroutes.has(originId)
        && UI_REROUTE_NODE_TYPES.test(allNodes.get(targetId)?.type)
        && !reachableReroutes.has(targetId)
      ) {
        reachableReroutes.add(targetId);
        reachabilityChanged = true;
      }
    }
  }
  for (const [nodeId, node] of allNodes) {
    if (!UI_REROUTE_NODE_TYPES.test(node.type) || !(linksByOrigin.get(nodeId)?.length)) continue;
    if ((linksByTarget.get(nodeId)?.length || 0) !== 1 || !reachableReroutes.has(nodeId)) {
      projectionConflicts.push({ code: 'REROUTE_SOURCE_MISSING_OR_AMBIGUOUS', nodeId });
    }
  }

  const rerouteStates = new Map();
  const visitReroute = (nodeId) => {
    const state = rerouteStates.get(nodeId);
    if (state === 'visiting') {
      projectionConflicts.push({ code: 'REROUTE_CYCLE', nodeId });
      return;
    }
    if (state === 'visited') return;
    rerouteStates.set(nodeId, 'visiting');
    for (const link of linksByOrigin.get(nodeId) || []) {
      const targetId = String(linkEndpoints(link, format).targetId);
      if (UI_REROUTE_NODE_TYPES.test(allNodes.get(targetId)?.type)) visitReroute(targetId);
    }
    rerouteStates.set(nodeId, 'visited');
  };
  for (const [nodeId, node] of allNodes) {
    if (UI_REROUTE_NODE_TYPES.test(node.type)) visitReroute(nodeId);
  }

  const trace = (link, source, reroutePath = new Set()) => {
    const endpoints = linkEndpoints(link, format);
    const targetId = String(endpoints.targetId);
    const target = allNodes.get(targetId);
    if (UI_REROUTE_NODE_TYPES.test(target?.type)) {
      if (reroutePath.has(targetId)) {
        projectionConflicts.push({ code: 'REROUTE_CYCLE', nodeId: targetId });
        return;
      }
      const nextPath = new Set(reroutePath);
      nextPath.add(targetId);
      for (const outgoing of linksByOrigin.get(targetId) || []) trace(outgoing, source, nextPath);
      return;
    }
    if (!executableNodes.has(targetId)) {
      if (!UI_ONLY_NODE_TYPES.test(target?.type)) {
        projectionConflicts.push({ code: 'UNRESOLVED_UI_TARGET', nodeId: targetId });
      }
      return;
    }
    const targetInput = slotAt(target.inputs, endpoints.targetSlot);
    if (!targetInput?.name) {
      projectionConflicts.push({ code: 'UNRESOLVED_UI_TARGET_SLOT', nodeId: targetId });
      return;
    }
    projectedTargets.push({
      targetId,
      fieldName: targetInput.name,
      source,
    });
  };

  for (const [sourceId, sourceNode] of allNodes) {
    if (!executableNodes.has(sourceId) && !UI_PRIMITIVE_NODE_TYPES.test(sourceNode.type)) continue;
    for (const link of linksByOrigin.get(sourceId) || []) {
      const endpoints = linkEndpoints(link, format);
      trace(link, {
        kind: executableNodes.has(sourceId) ? 'edge' : 'primitive',
        nodeId: sourceId,
        outputSlot: endpoints.originSlot,
        node: sourceNode,
      });
    }
  }

  for (const target of projectedTargets) {
    if (target.source.kind === 'edge') {
      uiEdges.push(
        `${target.targetId}:${target.fieldName}`
        + `<-${target.source.nodeId}:${String(target.source.outputSlot)}`,
      );
      continue;
    }
    const primitive = primitiveWidgetValue(target.source.node);
    const apiValue = apiWorkflow?.[target.targetId]?.inputs?.[target.fieldName];
    if (
      !primitive.found
      || connectionTarget(apiValue)
      || canonicalJson(primitive.value) !== canonicalJson(apiValue)
    ) {
      projectionConflicts.push({
        code: 'PRIMITIVE_VALUE_MISMATCH',
        primitiveNodeId: target.source.nodeId,
        targetNodeId: target.targetId,
        fieldName: target.fieldName,
      });
    }
  }
  return { uiEdges, projectionConflicts };
}

function compileUiWorkflow(workflow, format, objectInfo) {
  if (format === 'comfy-ui-unknown') {
    return { compileStatus: 'unsupported-version', warnings: [{ code: 'UNKNOWN_UI_VERSION' }] };
  }
  if (!objectInfo) {
    return { compileStatus: 'needs-runtime-capabilities', warnings: [{ code: 'OBJECT_INFO_REQUIRED' }] };
  }

  const links = new Map((workflow.links || []).map((link) => [String(linkId(link, format)), link]));
  const apiWorkflow = {};
  const linkValidation = validateUiLinkSemantics(workflow, format);
  const runtimeLinkValidation = validateUiLinkRuntimeSemantics(
    workflow,
    format,
    objectInfo,
    linkValidation.validLinkIds,
  );
  const warnings = [...linkValidation.warnings, ...runtimeLinkValidation.warnings];
  let missingNodeDefinition = false;

  for (const uiNode of workflow.nodes) {
    const nodeId = String(uiNode.id);
    const definition = objectInfo[uiNode.type];
    if (!definition) {
      missingNodeDefinition = true;
      warnings.push({ code: 'MISSING_NODE_TYPE', nodeId, classType: uiNode.type });
      continue;
    }
    const inputs = {};
    const declaredConnectedFields = new Set(
      (Array.isArray(uiNode.inputs) ? uiNode.inputs : [])
        .filter((input) => input?.link != null)
        .map((input) => input.name),
    );
    for (const input of Array.isArray(uiNode.inputs) ? uiNode.inputs : []) {
      if (input?.link == null) continue;
      const link = links.get(String(input.link));
      if (!link || !runtimeLinkValidation.validLinkIds.has(String(input.link))) continue;
      const endpoints = linkEndpoints(link, format);
      inputs[input.name] = [String(endpoints.originId), Number(endpoints.originSlot)];
    }

    const fieldOrder = definitionFieldOrder(definition).filter((fieldName) => {
      if (declaredConnectedFields.has(fieldName)) return false;
      if (Object.hasOwn(inputs, fieldName)) return false;
      const specification = schemaInput(definition, fieldName);
      const options = specification?.[1] || {};
      if (options.forceInput && definition?.input?.required?.[fieldName]) {
        warnings.push({ code: 'UNCONNECTED_REQUIRED_INPUT', nodeId, fieldName });
      }
      return !options.forceInput && !options.defaultInput;
    });
    const widgetValues = uiNode.widgets_values;
    if (isPlainObject(widgetValues)) {
      for (const [fieldName, value] of Object.entries(widgetValues)) {
        if (declaredConnectedFields.has(fieldName)) continue;
        const specification = schemaInput(definition, fieldName);
        if (!specification || !acceptsWidgetValue(specification, value)) {
          warnings.push({ code: 'AMBIGUOUS_WIDGET_MAPPING', nodeId, fieldName });
          continue;
        }
        inputs[fieldName] = value;
      }
      for (const [fieldName, specification] of Object.entries(
        definition.input?.required || {},
      )) {
        if (Object.hasOwn(inputs, fieldName) || declaredConnectedFields.has(fieldName)) continue;
        const options = specification?.[1] || {};
        if (options.forceInput) continue;
        const defaultValue = explicitSchemaDefault(specification);
        if (defaultValue.found && acceptsWidgetValue(specification, defaultValue.value)) {
          inputs[fieldName] = defaultValue.value;
        } else {
          warnings.push({ code: 'MISSING_REQUIRED_INPUT', nodeId, fieldName });
        }
      }
    } else {
      const values = Array.isArray(widgetValues) ? widgetValues : [];
      if (values.length > 0) {
        warnings.push({ code: 'POSITIONAL_WIDGET_MAPPING_REQUIRES_CONFIRMATION', nodeId });
      }
      if (values.length !== fieldOrder.length) {
        warnings.push({
          code: 'AMBIGUOUS_WIDGET_COUNT',
          nodeId,
          expected: fieldOrder.length,
          actual: values.length,
        });
      }
      for (let index = 0; index < Math.min(values.length, fieldOrder.length); index += 1) {
        const fieldName = fieldOrder[index];
        const specification = schemaInput(definition, fieldName);
        if (!acceptsWidgetValue(specification, values[index])) {
          warnings.push({ code: 'AMBIGUOUS_WIDGET_MAPPING', nodeId, fieldName });
          continue;
        }
        inputs[fieldName] = values[index];
      }
    }
    apiWorkflow[nodeId] = {
      inputs,
      class_type: uiNode.type,
      _meta: { title: uiNode.title || definition.display_name || uiNode.type },
    };
  }

  if (missingNodeDefinition) return { compileStatus: 'needs-api-export', warnings };
  if (warnings.length) {
    return { compileStatus: 'needs-confirmation', warnings, draftApiJson: apiWorkflow };
  }
  const normalized = normalizeApiWorkflow(apiWorkflow);
  return {
    compileStatus: 'ready',
    warnings: [],
    apiJson: normalized,
    executionPlanHash: sha256Json(normalized),
  };
}

function analyzeUiWorkflow(workflow, format, objectInfo) {
  const groups = uiGroups(workflow);
  const nodes = workflow.nodes.map((node) => {
    const group = groupForNode(node, groups);
    return {
      id: String(node.id),
      classType: node.type,
      title: node.title || node.type,
      groupId: group?.id || null,
      groupTitle: group?.title || null,
      capabilityAvailable: objectInfo ? Boolean(objectInfo[node.type]) : null,
    };
  });
  const compilation = compileUiWorkflow(workflow, format, objectInfo);
  return {
    format,
    nodeCount: nodes.length,
    linkCount: Array.isArray(workflow.links) ? workflow.links.length : 0,
    nodes,
    groups,
    candidateBindings: compilation.apiJson
      ? analyzeApiWorkflow(compilation.apiJson, objectInfo).candidateBindings
      : [],
    candidateOutputs: compilation.apiJson
      ? analyzeApiWorkflow(compilation.apiJson, objectInfo).candidateOutputs
      : [],
    requirements: {
      nodeTypes: [...new Set(nodes.map((node) => node.classType))].sort(),
      models: [],
    },
    ...compilation,
  };
}

export function analyzeWorkflow(workflow, format, { objectInfo } = {}) {
  if (format === 'comfy-api') {
    const analysis = analyzeApiWorkflow(normalizeApiWorkflow(workflow), objectInfo);
    const omitted = Object.entries(workflow).filter(([, node]) => !hasApiClassType(node));
    analysis.warnings.push(...omitted.map(([nodeId]) => ({ code: 'UNREFERENCED_INCOMPLETE_API_NODE', nodeId })));
    return analysis;
  }
  return analyzeUiWorkflow(workflow, format, objectInfo);
}

export function compareUiAndApiWorkflows(uiWorkflow, apiWorkflow) {
  const format = detectWorkflowFormat(uiWorkflow);
  if (!['comfy-ui-0.4', 'comfy-ui-1.0'].includes(format)) {
    return {
      status: 'conflict',
      reason: 'UNSUPPORTED_UI_VERSION',
      apiNodeCount: Object.keys(apiWorkflow).length,
      uiNodeCount: Array.isArray(uiWorkflow?.nodes) ? uiWorkflow.nodes.length : 0,
    };
  }
  const omittedIds = new Set(Object.entries(apiWorkflow)
    .filter(([, node]) => !hasApiClassType(node)).map(([id]) => id));
  apiWorkflow = normalizeApiWorkflow(apiWorkflow);
  if (omittedIds.size) {
    const links = uiWorkflow.links || [];
    const hasSurvivingDependency = links.some(link => {
      const edge = linkEndpoints(link, format);
      return omittedIds.has(String(edge.originId)) && !omittedIds.has(String(edge.targetId));
    });
    if (hasSurvivingDependency) return { status: 'conflict', reason: 'INCOMPLETE_API_NODE_UI_DEPENDENCY' };
    const removedLinkIds = new Set(links
      .filter(link => omittedIds.has(String(linkEndpoints(link, format).targetId)))
      .map(link => String(linkId(link, format))));
    uiWorkflow = {
      ...uiWorkflow,
      nodes: uiWorkflow.nodes.filter(node => !omittedIds.has(String(node.id))).map(node => ({
        ...node,
        ...(Array.isArray(node.outputs) ? { outputs: node.outputs.map(output => ({
          ...output,
          ...(Array.isArray(output.links) ? { links: output.links.filter(id => !removedLinkIds.has(String(id))) } : {}),
        })) } : {}),
      })),
      links: links.filter(link => !omittedIds.has(String(linkEndpoints(link, format).targetId))),
    };
  }
  const uiNodes = uiWorkflow.nodes.filter((node) => !UI_ONLY_NODE_TYPES.test(node.type));
  const uiById = new Map(uiNodes.map((node) => [String(node.id), node]));
  const apiEntries = Object.entries(apiWorkflow);
  const nodeConflicts = [];
  const titleConflicts = [];
  for (const [nodeId, apiNode] of apiEntries) {
    const uiNode = uiById.get(nodeId);
    if (!uiNode || uiNode.type !== apiNode.class_type) {
      nodeConflicts.push({ nodeId, uiType: uiNode?.type || null, apiType: apiNode.class_type });
      continue;
    }
    const uiTitle = typeof uiNode.title === 'string' ? uiNode.title.trim() : '';
    const apiTitle = typeof apiNode?._meta?.title === 'string' ? apiNode._meta.title.trim() : '';
    if (uiTitle && apiTitle && uiTitle !== apiTitle) {
      titleConflicts.push({ nodeId, uiTitle, apiTitle });
    }
  }
  const apiNodeIds = new Set(apiEntries.map(([nodeId]) => nodeId));
  const extraUiNodeIds = [...uiById.keys()].filter((nodeId) => !apiNodeIds.has(nodeId));
  const linkValidation = validateUiLinkSemantics(uiWorkflow, format);

  const graphProjection = projectUiExecutionGraph(
    uiWorkflow,
    format,
    uiById,
    apiWorkflow,
    linkValidation.validLinkIds,
  );
  const uiEdges = graphProjection.uiEdges;

  const apiEdges = [];
  for (const [targetId, apiNode] of apiEntries) {
    for (const [fieldName, value] of Object.entries(apiNode.inputs)) {
      const originId = connectionTarget(value);
      if (!originId) continue;
      apiEdges.push(`${targetId}:${fieldName}<-${originId}:${String(value[1])}`);
    }
  }
  uiEdges.sort();
  apiEdges.sort();
  const topologyMatches = canonicalJson(uiEdges) === canonicalJson(apiEdges);
  const exact = apiEntries.length > 0
    && uiById.size === apiEntries.length
    && nodeConflicts.length === 0
    && extraUiNodeIds.length === 0
    && titleConflicts.length === 0
    && linkValidation.warnings.length === 0
    && graphProjection.projectionConflicts.length === 0
    && topologyMatches;
  return {
    status: exact ? 'exact' : 'conflict',
    exactMatchCount: apiEntries.length - nodeConflicts.length,
    apiNodeCount: apiEntries.length,
    uiNodeCount: uiById.size,
    extraUiNodeIds,
    nodeConflicts,
    titleConflicts,
    linkConflicts: linkValidation.warnings,
    projectionConflicts: graphProjection.projectionConflicts,
    topologyMatches,
    uiEdges,
    apiEdges,
  };
}
