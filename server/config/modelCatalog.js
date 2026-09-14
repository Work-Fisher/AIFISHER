/**
 * 产品模型目录的运行读取入口。
 *
 * src/config/modelConfig.ts 是唯一源码；build:model-catalog 由 TypeScript
 * 工具链求值一次并生成 JSON 快照。开发和便携运行时均只读快照，
 * 不再用正则二次解析 TypeScript 源码。
 */

import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_PATHS } from '../workspace/runtimePaths.js';
import { isLikelyProviderApiKey, modelOverrideKey } from '../../src/shared/modelOverrideKey.js';

export const DEFAULT_SNAPSHOT_PATH = path.join(
  RUNTIME_PATHS.SERVER_DIR,
  'config',
  'modelCatalog.generated.json',
);

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonEmptyObject(value) {
  return value && typeof value === 'object' && Object.keys(value).length ? value : null;
}

function isParameterValue(value) {
  return typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

// Project capability data, not arbitrary provider/client objects. The source remains
// modelConfig.ts; consumers must not infer vision or parameters from model names.
function capabilityMetadata(model) {
  const result = {};
  for (const modesKey of ['languageModes', 'imageModes', 'videoModes', 'audioModes']) {
    if (!Array.isArray(model[modesKey])) continue;
    result[modesKey] = model[modesKey].filter((mode) => typeof mode?.value === 'string' && mode.value).map((mode) => ({
      ...(typeof mode.label === 'string' ? { label: mode.label } : {}), value: mode.value,
      allowedInputs: Object.fromEntries(['text', 'image', 'video', 'audio'].filter((kind) =>
        Number.isInteger(mode.allowedInputs?.[kind]) && mode.allowedInputs[kind] >= 0,
      ).map((kind) => [kind, mode.allowedInputs[kind]])),
    }));
  }
  for (const key of ['supportedReferenceTypes', 'supportedImageFormats']) {
    if (Array.isArray(model[key])) result[key] = model[key].filter((value) => typeof value === 'string' && value);
  }
  const maxImageSizeMb = finiteNumber(model.maxImageSizeMb);
  if (maxImageSizeMb != null && maxImageSizeMb >= 0) result.maxImageSizeMb = maxImageSizeMb;
  if (Array.isArray(model.advancedParams)) {
    result.advancedParams = model.advancedParams.filter((parameter) => typeof parameter?.key === 'string' && parameter.key).map((parameter) => {
      const projected = { key: parameter.key };
      for (const key of ['label', 'type', 'unit']) if (typeof parameter[key] === 'string') projected[key] = parameter[key];
      if (isParameterValue(parameter.default)) projected.default = parameter.default;
      for (const key of ['min', 'max', 'step']) {
        if (typeof parameter[key] === 'number' && Number.isFinite(parameter[key])) projected[key] = parameter[key];
      }
      if (Array.isArray(parameter.options)) projected.options = parameter.options.filter((option) => isParameterValue(option?.value)).map((option) => ({
        ...(typeof option.label === 'string' ? { label: option.label } : {}), value: option.value,
      }));
      return projected;
    });
  }
  return result;
}

function durationRangeFromModel(model) {
  const duration = Array.isArray(model?.advancedParams)
    ? model.advancedParams.find((entry) => entry?.key === 'duration')
    : null;
  if (!duration) return null;

  const range = {
    default: finiteNumber(duration.default),
    min: finiteNumber(duration.min),
    max: finiteNumber(duration.max),
  };
  return Object.values(range).every((value) => value != null) ? range : null;
}

function normalizeCatalogModel(model) {
  const modelName = model?.name;
  if (typeof modelName !== 'string' || !modelName) return null;

  const observedTaskCost = nonEmptyObject(model.observedTaskCost);
  const fixedDuration = finiteNumber(model.fixedDuration);
  const durationRange = durationRangeFromModel(model);

  return {
    name: modelName,
    ...(model.selectable === false ? { selectable: false } : {}),
    ...(typeof model.displayName === 'string' ? { displayName: model.displayName } : {}),
    timeEstimate: typeof model.timeEstimate === 'string' ? model.timeEstimate : '2min',
    provider: typeof model.provider === 'string' ? model.provider : '',
    useProxy: model.useProxy === true,
    maxConcurrent: finiteNumber(model.maxConcurrent) ?? 1,
    source: typeof model.source === 'string' ? model.source : 'official',
    canonicalModel: typeof model.canonicalModel === 'string' ? model.canonicalModel : modelName,
    tier: typeof model.tier === 'string' ? model.tier : 'standard',
    variantLabel: typeof model.variantLabel === 'string' ? model.variantLabel : null,
    brand: typeof model.brand === 'string' ? model.brand : null,
    premium: model.premium === true,
    cost: model.cost ?? null,
    costByMode: nonEmptyObject(model.costByMode),
    rhPriceRules: nonEmptyObject(model.rhPriceRules),
    estimatedCostByMode: Array.isArray(model.estimatedCostByMode)
      && model.estimatedCostByMode.length
      ? model.estimatedCostByMode
      : null,
    ...(observedTaskCost ? { observedTaskCost } : {}),
    ...(fixedDuration != null ? { fixedDuration } : {}),
    ...(durationRange ? { durationRange } : {}),
    priceNoteByMode: nonEmptyObject(model.priceNoteByMode),
    priceTextByMode: nonEmptyObject(model.priceTextByMode),
    priceFormula: typeof model.priceFormula === 'string' ? model.priceFormula : null,
    tokenPricePerMillion: finiteNumber(model.tokenPricePerMillion),
    tokenVideoPricePerMillion: finiteNumber(model.tokenVideoPricePerMillion),
    resolutionSurcharge: nonEmptyObject(model.resolutionSurcharge),
    ...capabilityMetadata(model),
    endpoint: model.endpoint && typeof model.endpoint === 'object' ? model.endpoint : {},
  };
}

/** 从已经由 TypeScript 工具链求值的模型列表生成后端运行快照。 */
export function createModelCatalog(modelLists) {
  const registry = {};
  for (const models of Object.values(modelLists ?? {})) {
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      const normalized = normalizeCatalogModel(model);
      if (normalized) registry[normalized.name] = normalized;
    }
  }
  return registry;
}

export function loadModelCatalog({
  snapshotPath = DEFAULT_SNAPSHOT_PATH,
  fileSystem = fs,
  logger = console,
} = {}) {
  try {
    const snapshot = JSON.parse(fileSystem.readFileSync(snapshotPath, 'utf8'));
    if (snapshot && typeof snapshot === 'object') return applyModelIdOverrides(snapshot);
    logger.error('[ModelCatalog] 快照格式非法，云端模型将全部不可用：', snapshotPath);
  } catch (error) {
    logger.error(
      '[ModelCatalog] 读不到构建期快照，所有云端模型将返回 '
      + 'UNSUPPORTED_GENERATION_PROVIDER。请检查是否执行了 build:model-catalog。',
      error.message,
    );
  }
  return {};
}

// Reuse the account-scoped configuration keys also consumed by canvas generation.
// Only model IDs change; endpoints, credentials and provider contracts stay trusted.
export function applyModelIdOverrides(catalog, environment = process.env) {
  return Object.fromEntries(Object.entries(catalog).map(([name, model]) => {
    if (!model.endpoint) return [name, model];
    const key = `MODEL_ID_${name.replace(/[\s.-]/g, '_').toUpperCase()}`;
    const configuredCommon = String(environment[modelOverrideKey(name)] ?? environment[key] ?? '').trim();
    // Never let a pasted provider credential replace the real model ID.
    const common = isLikelyProviderApiKey(configuredCommon) ? '' : configuredCommon;
    const endpoint = Object.fromEntries(Object.entries(model.endpoint || {}).map(([mode, entry]) => {
      const modeKey = `${key}_${mode.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
      const configuredOverride = String(environment[modeKey] || common).trim();
      const override = isLikelyProviderApiKey(configuredOverride) ? '' : configuredOverride;
      if (typeof entry === 'string') return [mode, override ? { url: entry, model: override } : entry];
      if (!entry || typeof entry !== 'object') return [mode, entry];
      return [mode, override ? { ...entry, model: override } : entry];
    }));
    return [name, { ...model, endpoint, ...(common ? { customModelId: common } : {}) }];
  }));
}

export function loadModelNames(options = {}) {
  return Object.keys(loadModelCatalog(options));
}

export function normalizeModelDuration(model, requestedDuration) {
  const fixedDuration = Number(model?.fixedDuration);
  if (Number.isFinite(fixedDuration) && fixedDuration > 0) return fixedDuration;

  const duration = Number(requestedDuration);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const min = Number(model?.durationRange?.min);
  const max = Number(model?.durationRange?.max);
  const lowerBound = Number.isFinite(min) && min > 0 ? min : duration;
  const upperBound = Number.isFinite(max) && max >= lowerBound ? max : duration;
  return Math.min(Math.max(duration, lowerBound), upperBound);
}
