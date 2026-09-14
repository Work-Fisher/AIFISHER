import crypto from 'node:crypto';
import {
  analyzeWorkflow,
  normalizeApiWorkflow,
  sha256Json,
} from './workflowFormat.js';
import { deriveVariableAssetGroupCandidates } from './workflowVariableAssetGroups.js';
import { cloudMediaEmptyValue, isAbsentMediaInput, isCloudDeployment } from './cloudMediaInputs.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const CONTROL_KINDS = new Set([
  'text',
  'textarea',
  'number',
  'slider',
  'toggle',
  'select',
  'seed',
  'asset',
]);
const REQUEST_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 16,
  maxKeys: 512,
  maxArrayItems: 100,
  maxStringBytes: 64 * 1024,
});

export class WorkflowBindingError extends Error {
  constructor(message, code = 'INVALID_BINDING', status = 400, details = undefined) {
    super(message);
    this.name = 'WorkflowBindingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function define(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneNullPrototype(value) {
  if (Array.isArray(value)) return value.map(cloneNullPrototype);
  if (!isPlainObject(value)) return value;
  const cloned = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    define(cloned, key, cloneNullPrototype(child));
  }
  return cloned;
}

function assertSafeKey(value, label = '参数 key') {
  const key = String(value || '');
  if (!KEY_PATTERN.test(key) || DANGEROUS_KEYS.has(key)) {
    throw new WorkflowBindingError(`${label}无效`, 'INVALID_BINDING_KEY');
  }
  return key;
}

function assertSafeText(value, label, maximum, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
  if (Buffer.byteLength(normalized, 'utf8') > maximum || /[\0\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) {
    throw new WorkflowBindingError(`${label}无效或超过限制`, 'INVALID_BINDING_PRESENTATION');
  }
  return normalized;
}

function assertNoDangerousKeys(value, depth = 0, state = { keys: 0 }) {
  if (depth > REQUEST_LIMITS.maxDepth) {
    throw new WorkflowBindingError('参数嵌套过深', 'BINDING_VALUES_DEPTH_LIMIT');
  }
  if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > REQUEST_LIMITS.maxStringBytes) {
    throw new WorkflowBindingError('参数字符串超过限制', 'BINDING_VALUE_SIZE_LIMIT');
  }
  if (Array.isArray(value)) {
    if (value.length > REQUEST_LIMITS.maxArrayItems) {
      throw new WorkflowBindingError('参数数组超过限制', 'BINDING_VALUES_ARRAY_LIMIT');
    }
    for (const item of value) assertNoDangerousKeys(item, depth + 1, state);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > REQUEST_LIMITS.maxKeys) {
      throw new WorkflowBindingError('参数字段数量超过限制', 'BINDING_VALUES_KEY_LIMIT');
    }
    if (DANGEROUS_KEYS.has(key)) {
      throw new WorkflowBindingError('参数包含危险字段', 'DANGEROUS_BINDING_KEY');
    }
    assertNoDangerousKeys(child, depth + 1, state);
  }
}

function assertRequestBudgets(values) {
  if (!isPlainObject(values)) {
    throw new WorkflowBindingError('values 必须是对象', 'INVALID_BINDING_VALUES');
  }
  if (Buffer.byteLength(JSON.stringify(values), 'utf8') > REQUEST_LIMITS.maxBytes) {
    throw new WorkflowBindingError('参数请求超过 4 MiB', 'BINDING_VALUES_SIZE_LIMIT', 413);
  }
  assertNoDangerousKeys(values);
}

function candidateId(candidate) {
  return sha256Json({
    nodeId: String(candidate.nodeId),
    classType: candidate.classType,
    fieldName: candidate.fieldName,
  });
}

function defaultControl(candidate) {
  if (!CONTROL_KINDS.has(candidate.control)) return 'text';
  return candidate.control;
}

function compatibleControlKinds(candidate) {
  if (candidate.control === 'asset') return new Set(['asset']);
  if (candidate.control === 'seed') return new Set(['seed', 'number']);
  if (candidate.valueType === 'STRING') return new Set(['text', 'textarea']);
  if (['INT', 'FLOAT', 'NUMBER'].includes(candidate.valueType)) return new Set(['number', 'slider']);
  if (candidate.valueType === 'BOOLEAN') return new Set(['toggle']);
  if (candidate.valueType === 'COMBO') return new Set(['select']);
  return new Set([defaultControl(candidate)]);
}

function bindingDefault(candidate, controlKind) {
  if (controlKind === 'asset') return undefined;
  if (controlKind === 'seed') return { mode: 'fixed', value: candidate.value };
  return cloneNullPrototype(candidate.value);
}

export function deriveBindingCandidates({ executionPlan, nodeDefinitions }) {
  const normalized = normalizeApiWorkflow(executionPlan);
  const analysis = analyzeWorkflow(normalized, 'comfy-api', { objectInfo: nodeDefinitions });
  const candidates = analysis.candidateBindings
    .filter((candidate) => ![
      String(candidate.nodeId),
      candidate.classType,
      candidate.fieldName,
    ].some((value) => DANGEROUS_KEYS.has(value)))
    .map((candidate) => {
      if (Array.isArray(candidate.options)) {
        const totalBytes = Buffer.byteLength(JSON.stringify(candidate.options), 'utf8');
        if (candidate.options.length > 5_000 || totalBytes > 1024 * 1024) {
          throw new WorkflowBindingError(
            `${candidate.nodeTitle} · ${candidate.fieldName} 的选项超过外置限制`,
            'BINDING_OPTIONS_LIMIT',
          );
        }
      }
      return { ...candidate, id: candidateId(candidate) };
    });
  return deriveVariableAssetGroupCandidates({
    executionPlan: normalized,
    nodeDefinitions,
    candidates,
  });
}

export function deriveBindingSetBindings({ executionPlan, nodeDefinitions, selections }) {
  if (!Array.isArray(selections) || selections.length > 256) {
    throw new WorkflowBindingError('参数选择数量超过限制', 'BINDING_SET_SIZE_LIMIT');
  }
  const candidates = deriveBindingCandidates({ executionPlan, nodeDefinitions });
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selectedCandidateIds = new Set(
    selections.map((selection) => String(selection?.candidateId || '')),
  );
  const automaticGroupSelections = candidates
    .filter((candidate) => candidate.variableAssetGroup && !selectedCandidateIds.has(candidate.id))
    .map((candidate) => {
      const rawKey = `${candidate.fieldName}_${candidate.nodeId}`.replace(/[^A-Za-z0-9._-]/g, '_');
      const label = candidate.mediaKind === 'video'
        ? '参考视频'
        : candidate.mediaKind === 'audio'
          ? '参考音频'
          : '参考图片';
      return {
        candidateId: candidate.id,
        key: /^[A-Za-z]/.test(rawKey) ? rawKey.slice(0, 64) : `asset_group_${candidate.id.slice(0, 12)}`,
        label,
        section: '参考素材',
      };
    });
  const effectiveSelections = [...selections, ...automaticGroupSelections];
  if (effectiveSelections.length > 256) {
    throw new WorkflowBindingError('参数选择数量超过限制', 'BINDING_SET_SIZE_LIMIT');
  }
  const bindings = [];
  const keys = new Set();

  for (let index = 0; index < effectiveSelections.length; index += 1) {
    const selection = effectiveSelections[index];
    if (!isPlainObject(selection)) {
      throw new WorkflowBindingError('参数选择格式无效', 'INVALID_BINDING_SELECTION');
    }
    assertNoDangerousKeys(selection);
    const allowedSelectionKeys = new Set([
      'candidateId',
      'key',
      'label',
      'description',
      'controlKind',
      'section',
      'advanced',
    ]);
    if (Object.keys(selection).some((key) => !allowedSelectionKeys.has(key))) {
      throw new WorkflowBindingError(
        '客户端不能覆盖参数目标或节点能力',
        'INVALID_BINDING_SELECTION',
      );
    }
    const candidate = candidateById.get(String(selection.candidateId || ''));
    if (!candidate) {
      throw new WorkflowBindingError('参数候选不存在或已变化', 'INVALID_BINDING_TARGET', 409);
    }
    const key = assertSafeKey(selection.key || `input_${index + 1}`);
    if (keys.has(key)) {
      throw new WorkflowBindingError('参数 key 重复', 'INVALID_BINDING_KEY');
    }
    keys.add(key);
    const requestedKind = selection.controlKind || defaultControl(candidate);
    if (!compatibleControlKinds(candidate).has(requestedKind)) {
      throw new WorkflowBindingError('控件类型与节点参数不兼容', 'INVALID_BINDING_CONTROL');
    }
    const defaultValue = bindingDefault(candidate, requestedKind);
    const variableAssetGroup = candidate.variableAssetGroup;
    const control = {
      kind: requestedKind,
      mediaKind: candidate.mediaKind,
      required: requestedKind === 'asset'
        ? variableAssetGroup
          ? candidate.required && variableAssetGroup.minimumItems > 0
          : candidate.required
        : candidate.required,
      minimum: candidate.minimum,
      maximum: candidate.maximum,
      step: candidate.step,
      options: candidate.options,
      multiple: Boolean(variableAssetGroup),
      minimumItems: variableAssetGroup?.minimumItems,
      maximumItems: variableAssetGroup?.maximumItems || 1,
      capacity: variableAssetGroup?.capacity,
    };
    if (defaultValue !== undefined) control.defaultValue = defaultValue;
    bindings.push({
      id: crypto.randomUUID(),
      key,
      label: assertSafeText(
        selection.label,
        '参数名称',
        120,
        `${candidate.nodeTitle} · ${candidate.fieldName}`,
      ) || `${candidate.nodeTitle} · ${candidate.fieldName}`,
      description: assertSafeText(selection.description, '参数说明', 1_000),
      target: {
        nodeId: String(candidate.nodeId),
        expectedClassType: candidate.classType,
        fieldName: candidate.fieldName,
        expectedValueType: candidate.valueType,
      },
      ...(variableAssetGroup ? { variableAssetGroup: cloneNullPrototype(variableAssetGroup) } : {}),
      control,
      presentation: {
        section: assertSafeText(selection.section, '参数分组', 120, '基础参数') || '基础参数',
        order: index,
        advanced: Boolean(selection.advanced),
      },
    });
  }
  return bindings;
}

function isConnection(value) {
  return Array.isArray(value)
    && value.length === 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && Number.isInteger(value[1])
    && value[1] >= 0;
}

function validateNumber(value, binding, integer) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new WorkflowBindingError(`${binding.label}必须是${integer ? '整数' : '数字'}`, 'INVALID_BINDING_VALUE');
  }
  const { minimum, maximum, step } = binding.control;
  if (Number.isFinite(minimum) && value < minimum) {
    throw new WorkflowBindingError(`${binding.label}低于最小值`, 'INVALID_BINDING_VALUE');
  }
  if (Number.isFinite(maximum) && value > maximum) {
    throw new WorkflowBindingError(`${binding.label}超过最大值`, 'INVALID_BINDING_VALUE');
  }
  if (Number.isFinite(step) && step > 0) {
    const origin = Number.isFinite(minimum) ? minimum : 0;
    const quotient = (value - origin) / step;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-8) {
      throw new WorkflowBindingError(`${binding.label}不符合步长`, 'INVALID_BINDING_VALUE');
    }
  }
  return value;
}

function validateAssetReference(value, binding, projectId) {
  if (!isPlainObject(value)) {
    throw new WorkflowBindingError(`${binding.label}必须选择项目素材`, 'INVALID_BINDING_ASSET');
  }
  const allowed = new Set(['assetId', 'projectId', 'type']);
  if (Object.keys(value).some((key) => !allowed.has(key) || DANGEROUS_KEYS.has(key))) {
    throw new WorkflowBindingError(`${binding.label}素材引用含非法字段`, 'INVALID_BINDING_ASSET');
  }
  const assetId = String(value.assetId || '');
  const assetProjectId = String(value.projectId || '');
  const type = String(value.type || '');
  if (!assetId || assetId.length > 200 || assetProjectId !== projectId) {
    throw new WorkflowBindingError(`${binding.label}素材不属于当前项目`, 'ASSET_PROJECT_MISMATCH');
  }
  if (binding.control.mediaKind && type !== binding.control.mediaKind) {
    throw new WorkflowBindingError(`${binding.label}素材类型不匹配`, 'INVALID_BINDING_ASSET');
  }
  return { assetId, projectId: assetProjectId, type };
}

function validateScalarValue(value, binding) {
  const { kind, options } = binding.control;
  if (kind === 'select') {
    if (!Array.isArray(options) || !options.some((option) => Object.is(option, value))) {
      throw new WorkflowBindingError(`${binding.label}选项无效`, 'INVALID_BINDING_VALUE');
    }
    return value;
  }
  if (kind === 'toggle') {
    if (typeof value !== 'boolean') {
      throw new WorkflowBindingError(`${binding.label}必须是开关值`, 'INVALID_BINDING_VALUE');
    }
    return value;
  }
  if (kind === 'number' || kind === 'slider') {
    return validateNumber(value, binding, binding.target.expectedValueType === 'INT');
  }
  if (kind === 'text' || kind === 'textarea') {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > REQUEST_LIMITS.maxStringBytes || value.includes('\0')) {
      throw new WorkflowBindingError(`${binding.label}文本无效或超过限制`, 'INVALID_BINDING_VALUE');
    }
    return value;
  }
  throw new WorkflowBindingError(`${binding.label}控件类型不受支持`, 'INVALID_BINDING_CONTROL');
}

function randomInteger(minimum, maximum) {
  const lower = Math.ceil(minimum);
  const upper = Math.floor(maximum);
  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || lower > upper) {
    throw new WorkflowBindingError('随机种子范围无效', 'INVALID_BINDING_VALUE');
  }
  const span = BigInt(upper) - BigInt(lower) + 1n;
  const sampleSpace = 1n << 53n;
  if (span > sampleSpace) {
    throw new WorkflowBindingError('随机种子范围超过安全整数限制', 'INVALID_BINDING_VALUE');
  }
  const acceptedUpperBound = sampleSpace - (sampleSpace % span);
  let sample;
  do {
    const bytes = crypto.randomBytes(7);
    sample = BigInt(`0x${bytes.toString('hex')}`) & (sampleSpace - 1n);
  } while (sample >= acceptedUpperBound);
  return Number(BigInt(lower) + (sample % span));
}

function resolveSeedValue(value, binding, randomIntegerGenerator, resolutionCache) {
  const policy = typeof value === 'number' ? { mode: 'fixed', value } : value;
  if (!isPlainObject(policy) || !['fixed', 'random', 'increment', 'decrement'].includes(policy.mode)) {
    throw new WorkflowBindingError(`${binding.label}随机种子格式无效`, 'INVALID_BINDING_VALUE');
  }
  // ComfyUI may declare uint64 bounds; JS/JSON seed values must remain exact integers.
  const minimum = Math.max(Number.MIN_SAFE_INTEGER, Math.ceil(Number.isFinite(binding.control.minimum) ? binding.control.minimum : 0));
  const maximum = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.isFinite(binding.control.maximum)
    ? binding.control.maximum
    : 2_147_483_647));
  const cacheFingerprint = sha256Json({
    mode: policy.mode,
    value: policy.value,
    step: policy.step,
    minimum,
    maximum,
  });
  const cached = resolutionCache.get(binding.key);
  if (cached?.fingerprint === cacheFingerprint) return cached.resolution;

  let resolvedSeed;
  let advancement;
  if (policy.mode === 'random') {
    resolvedSeed = validateNumber(
      randomIntegerGenerator(minimum, maximum),
      binding,
      true,
    );
    if (!Number.isSafeInteger(resolvedSeed)) {
      throw new WorkflowBindingError(`${binding.label}必须是安全整数`, 'INVALID_BINDING_VALUE');
    }
  } else {
    resolvedSeed = validateNumber(policy.value, binding, true);
    if (!Number.isSafeInteger(resolvedSeed)) {
      throw new WorkflowBindingError(`${binding.label}必须是安全整数`, 'INVALID_BINDING_VALUE');
    }
    if (policy.mode === 'increment' || policy.mode === 'decrement') {
      const declaredStep = Number.isFinite(binding.control.step) && binding.control.step > 0
        ? Number(binding.control.step)
        : 1;
      const step = policy.step === undefined ? declaredStep : Number(policy.step);
      if (!Number.isSafeInteger(step) || step <= 0 || step !== declaredStep) {
        throw new WorkflowBindingError(`${binding.label}种子步长无效`, 'INVALID_BINDING_VALUE');
      }
      const candidate = policy.mode === 'increment'
        ? resolvedSeed + step
        : resolvedSeed - step;
      const nextValue = Math.min(maximum, Math.max(minimum, candidate));
      validateNumber(nextValue, binding, true);
      advancement = {
        bindingKey: binding.key,
        mode: policy.mode,
        previousValue: resolvedSeed,
        nextValue,
        step,
      };
    }
  }
  const resolution = {
    resolvedSeed,
    metadata: {
      bindingKey: binding.key,
      seedPolicy: policy.mode,
      resolvedSeed,
    },
    ...(advancement ? { advancement } : {}),
  };
  resolutionCache.set(binding.key, { fingerprint: cacheFingerprint, resolution });
  return resolution;
}

function nextNumericNodeId(workflow) {
  const maximum = Object.keys(workflow).reduce((current, key) => {
    const value = Number(key);
    return Number.isSafeInteger(value) && value >= 0 ? Math.max(current, value) : current;
  }, 0);
  let next = maximum + 1;
  while (Object.hasOwn(workflow, String(next))) next += 1;
  return String(next);
}

function assertVariableGroupIntegrity(compiled, binding) {
  const group = binding.variableAssetGroup;
  const target = compiled[group.targetNodeId];
  if (!target || target.class_type !== group.targetClassType) {
    throw new WorkflowBindingError(`${binding.label}动态素材目标已经变化`, 'INVALID_BINDING_TARGET', 409);
  }
  for (const branch of group.branches) {
    const source = compiled[branch.sourceNodeId];
    if (
      !source
      || source.class_type !== branch.sourceClassType
      || !Object.hasOwn(source.inputs || {}, branch.assetFieldName)
      || isConnection(source.inputs[branch.assetFieldName])
    ) {
      throw new WorkflowBindingError(`${binding.label}素材加载分支已经变化`, 'INVALID_BINDING_TARGET', 409);
    }
    for (const connection of branch.connections) {
      const current = target.inputs?.[connection.targetFieldName];
      if (
        !isConnection(current)
        || String(current[0]) !== branch.sourceNodeId
        || current[1] !== connection.outputIndex
      ) {
        throw new WorkflowBindingError(`${binding.label}素材连线已经变化`, 'INVALID_BINDING_TARGET', 409);
      }
    }
  }
  return target;
}

function compileVariableAssetGroup(compiled, binding, resolvedAssets) {
  const group = binding.variableAssetGroup;
  const target = assertVariableGroupIntegrity(compiled, binding);
  const syntheticTemplate = group.syntheticTemplate;
  const template = group.templateSourceNodeId
    ? compiled[group.templateSourceNodeId]
    : syntheticTemplate?.node;
  for (let index = 0; index < group.branches.length; index += 1) {
    const branch = group.branches[index];
    if (index < resolvedAssets.length) {
      define(
        compiled[branch.sourceNodeId].inputs,
        branch.assetFieldName,
        cloneNullPrototype(resolvedAssets[index].value),
      );
      continue;
    }
    for (const connection of branch.connections) {
      delete target.inputs[connection.targetFieldName];
    }
    delete compiled[branch.sourceNodeId];
  }
  if (resolvedAssets.length <= group.branches.length) return;
  if (!group.extendable || !template) {
    throw new WorkflowBindingError(
      `${binding.label}超过当前工作流可安全扩展的容量`,
      'VARIABLE_ASSET_GROUP_CAPACITY_EXCEEDED',
    );
  }
  const connectionTemplates = group.branches[0]?.connections || syntheticTemplate?.connections;
  const assetFieldName = group.branches[0]?.assetFieldName || syntheticTemplate?.assetFieldName;
  if (!Array.isArray(connectionTemplates) || !assetFieldName) {
    throw new WorkflowBindingError(
      `${binding.label}缺少可验证的加载器模板`,
      'VARIABLE_ASSET_GROUP_TEMPLATE_MISSING',
      409,
    );
  }
  let nextId = nextNumericNodeId(compiled);
  for (let index = group.branches.length; index < resolvedAssets.length; index += 1) {
    while (Object.hasOwn(compiled, nextId)) nextId = String(Number(nextId) + 1);
    const source = cloneNullPrototype(template);
    define(source.inputs, assetFieldName, resolvedAssets[index].value);
    define(compiled, nextId, source);
    for (const connection of connectionTemplates) {
      define(
        target.inputs,
        `${connection.groupName}.${connection.prefix}${index}`,
        [nextId, connection.outputIndex],
      );
    }
    nextId = String(Number(nextId) + 1);
  }
}

function objectInfoWithAssetValues(nodeDefinitions, compiledAssets) {
  const cloned = cloneNullPrototype(nodeDefinitions);
  for (const asset of compiledAssets) {
    const definition = cloned[asset.binding.target.expectedClassType];
    const fieldName = asset.binding.target.fieldName;
    const specification = definition?.input?.required?.[fieldName]
      || definition?.input?.optional?.[fieldName];
    if (!Array.isArray(specification) || !Array.isArray(specification[0])) continue;
    const values = Array.isArray(asset.compiledValue) ? asset.compiledValue : [asset.compiledValue];
    specification[0] = [...new Set([...specification[0], ...values])];
  }
  return cloned;
}

function assertReferences({ executionPlanHash, bindingSet, deployment, projectId }) {
  if (
    !projectId
    || projectId === '.'
    || projectId === '..'
    || String(projectId).length > 200
    || /[\\/\0\r\n]/.test(String(projectId))
  ) {
    throw new WorkflowBindingError('项目标识无效', 'INVALID_PROJECT_REFERENCE');
  }
  const expected = [
    bindingSet.executionPlanHash,
    deployment.executionPlanHash,
    executionPlanHash,
  ];
  if (new Set(expected).size !== 1 || bindingSet.definitionId !== deployment.definitionId) {
    throw new WorkflowBindingError('工作流配置引用冲突', 'WORKFLOW_REFERENCE_CONFLICT', 409);
  }
  if (bindingSet.definitionRevision !== deployment.definitionRevision) {
    throw new WorkflowBindingError('工作流定义版本不一致', 'WORKFLOW_REFERENCE_CONFLICT', 409);
  }
}

export function isBindingRequiredForDeployment(binding, deployment) {
  if (deployment?.runner !== 'runninghub-webapp') {
    return Boolean(binding?.control?.required);
  }
  const classType = String(binding?.target?.expectedClassType || '');
  const fieldName = String(binding?.target?.fieldName || '');
  const definition = deployment?.relevantCapabilities?.[classType];
  const required = definition?.input?.required;
  const optional = definition?.input?.optional;
  if (required && Object.hasOwn(required, fieldName)) return true;
  if (optional && Object.hasOwn(optional, fieldName)) return false;
  return Boolean(binding?.control?.required);
}

export async function compileWorkflowBindings({
  executionPlan,
  bindingSet,
  deployment,
  projectId,
  values = {},
  resolveAsset,
  generateRandomInteger = randomInteger,
  seedResolutionCache = new Map(),
}) {
  assertRequestBudgets(values);
  const normalizedSource = normalizeApiWorkflow(executionPlan);
  const executionPlanHash = sha256Json(normalizedSource);
  assertReferences({ executionPlanHash, bindingSet, deployment, projectId: String(projectId || '') });
  const bindingByKey = new Map(bindingSet.bindings.map((binding) => [binding.key, binding]));
  for (const key of Object.keys(values)) {
    if (!bindingByKey.has(key)) {
      throw new WorkflowBindingError(`未授权的参数：${key}`, 'UNKNOWN_BINDING_VALUE');
    }
  }

  const compiled = cloneNullPrototype(normalizedSource);
  const emptyMedia = new Map();
  if (isCloudDeployment(deployment)) {
    const boundTargets = new Set(bindingSet.bindings.map(binding => `${binding.target.nodeId}\n${binding.target.fieldName}`));
    for (const candidate of deriveBindingCandidates({ executionPlan: normalizedSource, nodeDefinitions: deployment.relevantCapabilities })) {
      if (candidate.control === 'asset' && !candidate.variableAssetGroup
        && !boundTargets.has(`${candidate.nodeId}\n${candidate.fieldName}`)) {
        throw new WorkflowBindingError(`云端素材输入「${candidate.fieldName}」尚未映射到画布，请重新导入或补齐输入映射。`, 'BINDING_MEDIA_UNMAPPED');
      }
    }
    // Validate every absent media input before resolving/uploading any asset.
    for (const binding of bindingSet.bindings) {
      if (binding.control.kind !== 'asset' || binding.variableAssetGroup) continue;
      const value = Object.hasOwn(values, binding.key) ? values[binding.key] : binding.control.defaultValue;
      if (!isAbsentMediaInput(value)) continue;
      if (isBindingRequiredForDeployment(binding, deployment)) {
        throw new WorkflowBindingError(`${binding.label}为必填素材，请连接后再运行。`, 'MISSING_BINDING_VALUE');
      }
      const contract = cloudMediaEmptyValue(deployment, binding, normalizedSource);
      if (!Object.hasOwn(contract, 'emptyValue')) {
        throw new WorkflowBindingError(`云端未提供「${binding.label}」的空值规则，无法确认如何清除内置素材。请连接该素材；旧导入可重新导入以更新字段信息。`, 'BINDING_MEDIA_EMPTY_UNSUPPORTED');
      }
      emptyMedia.set(binding.key, contract.emptyValue);
    }
  }
  const compiledAssets = [];
  const resolvedValues = Object.create(null);
  const resolvedSeeds = [];
  const seedAdvancements = [];
  for (const binding of bindingSet.bindings) {
    assertSafeKey(binding.key);
    const supplied = Object.hasOwn(values, binding.key);
    let value = supplied ? values[binding.key] : binding.control.defaultValue;
    const clearingAsset = emptyMedia.has(binding.key);
    if (clearingAsset) value = emptyMedia.get(binding.key);
    if (value === undefined && binding.variableAssetGroup) value = [];
    if (value === undefined) {
      if (isBindingRequiredForDeployment(binding, deployment)) {
        throw new WorkflowBindingError(`${binding.label}为必填参数`, 'MISSING_BINDING_VALUE');
      }
      continue;
    }

    if (binding.control.kind === 'asset' && !clearingAsset) {
      if (typeof resolveAsset !== 'function') {
        throw new WorkflowBindingError('素材解析器未配置', 'ASSET_RESOLVER_UNAVAILABLE', 500);
      }
      const references = binding.control.multiple
        ? (Array.isArray(value) ? value : [value])
        : [value];
      if (!binding.control.multiple && Array.isArray(value)) {
        throw new WorkflowBindingError(`${binding.label}不支持多素材`, 'INVALID_BINDING_ASSET');
      }
      if (references.length > (binding.control.maximumItems || 1)) {
        throw new WorkflowBindingError(`${binding.label}素材数量超过限制`, 'INVALID_BINDING_ASSET');
      }
      const minimumItems = Math.max(0, Number(binding.control.minimumItems || 0));
      if (references.length < minimumItems) {
        throw new WorkflowBindingError(
          `${binding.label}至少需要 ${minimumItems} 个素材`,
          'MISSING_BINDING_VALUE',
        );
      }
      const resolved = [];
      for (const candidate of references) {
        const reference = validateAssetReference(candidate, binding, String(projectId));
        const asset = await resolveAsset(reference, { binding, projectId: String(projectId) });
        if (!asset || !Object.hasOwn(asset, 'value')) {
          throw new WorkflowBindingError(`${binding.label}素材不存在`, 'ASSET_NOT_FOUND', 404);
        }
        resolved.push(asset);
      }
      value = binding.control.multiple
        ? resolved.map((asset) => asset.value)
        : resolved[0].value;
      compiledAssets.push({ binding, assets: resolved, compiledValue: value });
      if (binding.variableAssetGroup) {
        compileVariableAssetGroup(compiled, binding, resolved);
        define(resolvedValues, binding.key, cloneNullPrototype(value));
        continue;
      }
    } else if (binding.control.kind === 'seed') {
      const seed = resolveSeedValue(
        value,
        binding,
        generateRandomInteger,
        seedResolutionCache,
      );
      value = seed.resolvedSeed;
      resolvedSeeds.push(seed.metadata);
      if (seed.advancement) seedAdvancements.push(seed.advancement);
    } else if (!clearingAsset) {
      value = validateScalarValue(value, binding);
    }

    const node = compiled[binding.target.nodeId];
    if (!node || node.class_type !== binding.target.expectedClassType) {
      throw new WorkflowBindingError(`${binding.label}目标节点已变化`, 'INVALID_BINDING_TARGET', 409);
    }
    if (!Object.hasOwn(node.inputs, binding.target.fieldName)
      || isConnection(node.inputs[binding.target.fieldName])) {
      throw new WorkflowBindingError(`${binding.label}目标字段已变化或已连接`, 'INVALID_BINDING_TARGET', 409);
    }
    define(node.inputs, binding.target.fieldName, cloneNullPrototype(value));
    define(resolvedValues, binding.key, cloneNullPrototype(value));
  }

  const analysisObjectInfo = objectInfoWithAssetValues(
    deployment.relevantCapabilities,
    compiledAssets,
  );
  const apiJson = normalizeApiWorkflow(compiled);
  const analysis = analyzeWorkflow(apiJson, 'comfy-api', { objectInfo: analysisObjectInfo });
  if (sha256Json(normalizedSource) !== executionPlanHash) {
    throw new WorkflowBindingError('源执行计划被意外修改', 'EXECUTION_PLAN_MUTATED', 500);
  }
  return {
    apiJson,
    compiledPromptHash: sha256Json(apiJson),
    resolvedValues,
    resolvedSeeds,
    seedAdvancements,
    assets: compiledAssets.flatMap((item) => item.assets),
    analysis,
  };
}

export function toBindingCandidateDto(candidate) {
  const opaqueSuffix = String(candidate.id || '').slice(0, 10) || 'unknown';
  return {
    id: candidate.id,
    nodeId: safePublicText(candidate.nodeId, `node-${opaqueSuffix}`, 160),
    classType: safePublicText(candidate.classType, '本机节点', 160),
    nodeTitle: safePublicText(candidate.nodeTitle, '本机节点', 120),
    fieldName: safePublicText(candidate.fieldName, `input-${opaqueSuffix}`, 160),
    valueType: candidate.valueType,
    required: candidate.required,
    control: candidate.control,
    mediaKind: candidate.mediaKind,
    hasDefault: candidate.control !== 'asset',
    optionCount: Array.isArray(candidate.options) ? candidate.options.length : 0,
    minimum: candidate.minimum,
    maximum: candidate.maximum,
    step: candidate.step,
    minimumItems: candidate.variableAssetGroup?.minimumItems,
    maximumItems: candidate.variableAssetGroup?.maximumItems,
    capacity: candidate.variableAssetGroup?.capacity,
  };
}

function publicOptionId(bindingId, value) {
  return sha256Json({ bindingId, value });
}

function looksSensitiveString(value) {
  const text = String(value || '');
  return /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/)[^\s"'<>]+)/i.test(text)
    || /https?:\/\/[^\s"'<>]+/i.test(text)
    || /(?:api[_ -]?key|authorization|bearer|token|secret|password)\s*[:=]/i.test(text);
}

function safePublicText(value, fallback, maximum) {
  const text = String(value ?? '').trim();
  if (
    !text
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    || /[\0\r\n\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text)
    || looksSensitiveString(text)
  ) return fallback;
  return text.slice(0, maximum);
}

function safeOptionLabel(value, index) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return `选项 ${index + 1}`;
  }
  const text = String(value);
  if (looksSensitiveString(text)) return `本机选项 ${index + 1}`;
  return text.slice(0, 512);
}

export function toBindingSetDto(record) {
  return {
    id: record.id,
    definitionId: record.definitionId,
    definitionRevision: record.definitionRevision,
    executionPlanHash: record.executionPlanHash,
    revision: record.revision,
    previousBindingSetId: record.previousBindingSetId,
    name: safePublicText(record.name, '参数配置', 120),
    bindingSetHash: record.bindingSetHash,
    createdAt: record.createdAt,
    bindings: record.bindings.map((binding) => {
      const options = Array.isArray(binding.control.options)
        ? binding.control.options.map((value, index) => ({
          id: publicOptionId(binding.id, value),
          label: safeOptionLabel(value, index),
        }))
        : [];
      const defaultValue = binding.control.defaultValue;
      const publicDefaultValue = binding.control.kind === 'select'
        ? publicOptionId(binding.id, defaultValue)
        : typeof defaultValue === 'string' && looksSensitiveString(defaultValue)
          ? undefined
          : defaultValue;
      return {
        id: binding.id,
        key: binding.key,
        label: safePublicText(binding.label, binding.key, 120),
        description: safePublicText(binding.description, '', 1_000),
        control: {
          kind: binding.control.kind,
          mediaKind: binding.control.mediaKind,
          required: binding.control.required,
          minimum: binding.control.minimum,
          maximum: binding.control.maximum,
          step: binding.control.step,
          multiple: binding.control.multiple,
          minimumItems: binding.control.minimumItems,
          maximumItems: binding.control.maximumItems,
          capacity: binding.control.capacity,
          options,
          hasDefault: defaultValue !== undefined,
          ...(publicDefaultValue !== undefined ? { defaultValue: publicDefaultValue } : {}),
        },
        presentation: {
          section: safePublicText(binding.presentation?.section, '基础参数', 120),
          order: binding.presentation?.order,
          advanced: Boolean(binding.presentation?.advanced),
        },
      };
    }),
  };
}

export function resolvePublicBindingValues(bindingSet, values) {
  if (!isPlainObject(values)) return values;
  const resolved = cloneNullPrototype(values);
  for (const binding of bindingSet.bindings) {
    if (binding.control.kind !== 'select' || !Object.hasOwn(resolved, binding.key)) continue;
    const requestedId = resolved[binding.key];
    const option = binding.control.options?.find(
      (value) => publicOptionId(binding.id, value) === requestedId,
    );
    if (option === undefined) {
      throw new WorkflowBindingError(`${binding.label}选项无效`, 'INVALID_BINDING_VALUE');
    }
    define(resolved, binding.key, option);
  }
  return resolved;
}

export { REQUEST_LIMITS as BINDING_VALUE_LIMITS };
