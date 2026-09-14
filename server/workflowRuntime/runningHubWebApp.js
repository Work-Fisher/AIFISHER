import { normalizeApiWorkflow, sha256Json } from './workflowFormat.js';
import { decodeFieldData, fieldDataSettings, uploadMediaKind, mediaEmptyContract } from './cloudMediaInputs.js';

export const RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID = 'fisherai_webapp_output';

const SAFE_REMOTE_ID = /^[A-Za-z0-9._-]{1,200}$/;
const SAFE_FIELD = /^[A-Za-z0-9._-]{1,160}$/;
const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

export class RunningHubWebAppError extends Error {
  constructor(message, code = 'RUNNINGHUB_WEBAPP_ERROR', status = 400) {
    super(message);
    this.name = 'RunningHubWebAppError';
    this.code = code;
    this.status = status;
  }
}

function safeText(value, maximum = 240) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    .replace(/[\0\r\n\u0001-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function remoteId(value, label) {
  const normalized = String(value || '').trim();
  if (!SAFE_REMOTE_ID.test(normalized)) {
    throw new RunningHubWebAppError(`${label}无效`, 'INVALID_RUNNINGHUB_WEBAPP_REFERENCE');
  }
  return normalized;
}

function optionsFor(field) {
  const decodedFieldData = decodeFieldData(field?.fieldData);
  const fieldDataOptions = Array.isArray(decodedFieldData)
    && decodedFieldData.length >= 2
    && decodedFieldData[1]
    && typeof decodedFieldData[1] === 'object'
    && !Array.isArray(decodedFieldData[1])
    ? decodedFieldData[1]
    : decodedFieldData;
  const sources = [
    field?.options,
    field?.choices,
    field?.values,
    field?.list,
    fieldDataOptions?.options,
    fieldDataOptions?.choices,
    fieldDataOptions?.values,
    fieldDataOptions?.list,
    Array.isArray(fieldDataOptions) ? fieldDataOptions : null,
    Array.isArray(decodedFieldData?.[0]) ? decodedFieldData[0] : null,
  ];
  const raw = sources.find((value) => Array.isArray(value));
  if (!raw) return [];
  const values = raw
    .slice(0, 500)
    .map((value) => {
      if (['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (value && typeof value === 'object') return value.value ?? value.id ?? value.label;
      return undefined;
    })
    .filter((value) => ['string', 'number', 'boolean'].includes(typeof value));
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

function fieldKind(field) {
  const uploadKind = uploadMediaKind(field);
  if (uploadKind) return uploadKind;
  const declared = `${field?.fieldType || ''} ${field?.valueType || ''}`.toLowerCase();
  const name = String(field?.fieldName || '').toLowerCase();
  if (/image|picture|photo|mask/.test(declared)) return 'image';
  if (/video|movie/.test(declared)) return 'video';
  if (/audio|sound|voice|music/.test(declared)) return 'audio';
  if (/boolean|bool|toggle/.test(declared)) return 'boolean';
  if (/int|integer/.test(declared)) return 'int';
  if (/float|double|number/.test(declared)) return 'float';
  if (/combo|select|list|enum/.test(declared) || optionsFor(field).length) return 'select';
  if (/image|picture|photo|mask/.test(name)) return 'image';
  if (/video|movie/.test(name)) return 'video';
  if (/audio|sound|voice|music/.test(name)) return 'audio';
  return 'text';
}

function defaultValue(field, kind, options) {
  const value = field?.fieldValue ?? field?.defaultValue ?? field?.value;
  if (kind === 'select') return options.some((option) => Object.is(option, value))
    ? value
    : options[0];
  if (kind === 'boolean') return typeof value === 'boolean' ? value : false;
  if (kind === 'int') return Number.isInteger(Number(value)) ? Number(value) : 0;
  if (kind === 'float') return Number.isFinite(Number(value)) ? Number(value) : 0;
  return typeof value === 'string' ? value.slice(0, 64 * 1024) : '';
}

function specification(field, kind, value, options) {
  if (kind === 'select') return [options, { default: value }];
  if (MEDIA_KINDS.has(kind)) return [kind.toUpperCase(), {
    [`${kind}_upload`]: true, fisheraiMediaInput: field.mediaInput,
  }];
  if (kind === 'boolean') return ['BOOLEAN', { default: value }];
  if (kind === 'int' || kind === 'float') {
    const spec = { default: value };
    for (const key of ['min', 'max', 'step']) {
      const candidate = Number(field?.[key] ?? field?.fieldData?.[key]);
      if (Number.isFinite(candidate)) spec[key] = candidate;
    }
    return [kind === 'int' ? 'INT' : 'FLOAT', spec];
  }
  return ['STRING', {
    default: value,
    multiline: value.length > 80 || /prompt|text|description/i.test(field.fieldName),
  }];
}

function classTypeFor(nodeId) {
  return `RunningHubWebApp_${sha256Json(String(nodeId)).slice(0, 12)}`;
}

function categoryText(value) {
  if (Array.isArray(value)) return value.map(categoryText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return categoryText(value.name ?? value.label ?? value.value ?? value.id);
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLowerCase()
    : '';
}

function categoryFromText(value) {
  const text = categoryText(value);
  if (!text) return null;
  if (/action|motion|pose|动作|迁移|姿态|驱动/u.test(text)) return 'motion';
  if (/video|movie|film|视频|影片|成片|图生视频|文生视频/u.test(text)) return 'video';
  if (/audio|sound|voice|speech|music|音频|声音|语音|配音|音乐/u.test(text)) return 'audio';
  if (/image|picture|photo|draw|图像|图片|绘图|主图|海报/u.test(text)) return 'image';
  return null;
}

export function inferRunningHubWebAppCategory(rawInfo) {
  const explicitAttributes = [
    rawInfo?.category,
    rawInfo?.categoryName,
    rawInfo?.appCategory,
    rawInfo?.appType,
    rawInfo?.type,
    rawInfo?.sceneType,
    rawInfo?.workflowType,
    rawInfo?.tags,
    rawInfo?.labels,
  ];
  for (const value of explicitAttributes) {
    const category = categoryFromText(value);
    if (category) return category;
  }
  const nameCategory = categoryFromText(
    rawInfo?.appName || rawInfo?.webappName || rawInfo?.name || rawInfo?.title,
  );
  if (nameCategory) return nameCategory;
  const fieldCategory = categoryFromText((rawInfo?.nodeInfoList || []).flatMap((field) => [
    field?.fieldName,
    field?.fieldType,
    field?.label,
    field?.name,
    field?.description,
  ]));
  return fieldCategory || 'image';
}

export function createRunningHubWebAppProjection(webAppIdValue, rawInfo) {
  const webAppId = remoteId(webAppIdValue, 'RunningHub WebApp ID');
  const rawFields = Array.isArray(rawInfo?.nodeInfoList) ? rawInfo.nodeInfoList : [];
  if (rawFields.length > 256) {
    throw new RunningHubWebAppError(
      'RunningHub WebApp 开放字段超过 256 个',
      'RUNNINGHUB_WEBAPP_FIELDS_LIMIT',
      413,
    );
  }
  const seen = new Set();
  const fields = [];
  for (const raw of rawFields) {
    const nodeId = String(raw?.nodeId || '').trim();
    const fieldName = String(raw?.fieldName || '').trim();
    if (!SAFE_REMOTE_ID.test(nodeId) || !SAFE_FIELD.test(fieldName)) continue;
    const identity = `${nodeId}\n${fieldName}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const kind = fieldKind(raw);
    const options = optionsFor(raw);
    const value = defaultValue(raw, kind, options);
    fields.push({
      nodeId,
      fieldName,
      fieldType: safeText(raw?.fieldType || kind.toUpperCase(), 80),
      kind,
      value,
      required: raw?.required === true || fieldDataSettings(raw?.fieldData)?.required === true,
      ...(MEDIA_KINDS.has(kind) ? { mediaInput: mediaEmptyContract(raw, options) } : {}),
      label: safeText(raw?.label || raw?.name || raw?.description || fieldName, 120) || fieldName,
      description: safeText(raw?.description, 600),
      options,
      minimum: Number.isFinite(Number(raw?.min ?? raw?.fieldData?.min))
        ? Number(raw?.min ?? raw?.fieldData?.min)
        : null,
      maximum: Number.isFinite(Number(raw?.max ?? raw?.fieldData?.max))
        ? Number(raw?.max ?? raw?.fieldData?.max)
        : null,
      step: Number.isFinite(Number(raw?.step ?? raw?.fieldData?.step))
        ? Number(raw?.step ?? raw?.fieldData?.step)
        : null,
    });
  }
  if (!fields.length) {
    throw new RunningHubWebAppError(
      'RunningHub WebApp 没有返回可用字段',
      'RUNNINGHUB_WEBAPP_FIELDS_MISSING',
      409,
    );
  }

  const executionPlan = Object.create(null);
  const nodeDefinitions = Object.create(null);
  for (const field of fields) {
    const classType = classTypeFor(field.nodeId);
    executionPlan[field.nodeId] ||= {
      class_type: classType,
      inputs: Object.create(null),
      _meta: { title: '云端应用参数' },
    };
    const section = field.required ? 'required' : 'optional';
    nodeDefinitions[classType] ||= {
      display_name: '云端应用参数',
      input: { required: Object.create(null), optional: Object.create(null) },
      input_order: { required: [], optional: [] },
      output: [],
      output_name: [],
      output_node: false,
    };
    executionPlan[field.nodeId].inputs[field.fieldName] = field.value;
    nodeDefinitions[classType].input[section][field.fieldName] = specification(
      field,
      field.kind,
      field.value,
      field.options,
    );
    nodeDefinitions[classType].input_order[section].push(field.fieldName);
  }
  executionPlan[RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID] = {
    class_type: 'RunningHubWebAppOutput',
    inputs: {},
    _meta: { title: '云端输出' },
  };
  nodeDefinitions.RunningHubWebAppOutput = {
    display_name: '云端输出',
    input: { required: {}, optional: {} },
    input_order: { required: [], optional: [] },
    output: ['ANY'],
    output_name: ['output'],
    output_node: true,
  };

  const snapshot = {
    schemaVersion: 1,
    webAppId,
    appName: safeText(rawInfo?.appName || rawInfo?.webappName || rawInfo?.name, 120)
      || `RH WebApp ${webAppId}`,
    categoryId: inferRunningHubWebAppCategory(rawInfo),
    fields,
  };
  const normalizedPlan = normalizeApiWorkflow(executionPlan);
  return {
    snapshot,
    schemaHash: sha256Json(snapshot),
    executionPlan: normalizedPlan,
    executionPlanHash: sha256Json(normalizedPlan),
    nodeDefinitions: JSON.parse(JSON.stringify(nodeDefinitions)),
  };
}
