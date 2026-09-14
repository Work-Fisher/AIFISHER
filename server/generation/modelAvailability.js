/**
 * modelAvailability.js
 *
 * 把「模型目录」和「哪些来源的密钥已配置」合成一份前端可直接渲染的数据。
 *
 * 画布里一级选模型、二级选来源，所以前端需要知道：
 * 同一个 canonicalModel 下有哪些来源、各自多少钱、哪些现在能用。
 *
 * 可用性完全由密钥决定，没有额外的启用开关——多一个开关就多两种矛盾态
 * （配了密钥没启用 / 启用了没密钥），对用户没有价值。
 * 官方是逐家独立的：填了 ARK_API_KEY 只点亮豆包，不会连带点亮 Gemini。
 */

import { GENERATION_PROVIDER_CONTRACTS } from './generationProviderCatalog.js';
import { loadModelCatalog, normalizeModelDuration } from '../config/modelCatalog.js';
import { relayPromotionFor } from './relayPromotion.js';
import { relayRetailAdjustment } from './relayRetailAdjustment.js';
import {
  RELAY_PRICE_INSUFFICIENT_NOTE,
  relayPriceFor,
  relayPriceHasCurrentParameterEvidence,
} from './relayPricing.js';

const SECRETS_BY_PROVIDER = new Map(
  GENERATION_PROVIDER_CONTRACTS.map((contract) => [contract.name, contract.requiredSecrets]),
);

/** 低价渠道分辨率不可控、稳定性不保证，和官方稳定不是一个档次，排序时先分组。 */
const TIER_ORDER = { standard: 0, budget: 1 };

function isConfigured(secrets, readSecret) {
  if (!secrets || secrets.length === 0) return true;
  return secrets.every((key) => String(readSecret(key) ?? '').trim().length > 0);
}

function isProviderConfigured(model, secrets, readSecret, providerConfiguration) {
  if (['dreamina_cli', 'libtv_cli'].includes(model.source)) {
    return providerConfiguration[model.provider] === true;
  }
  if (typeof providerConfiguration[model.provider] === 'boolean') {
    return providerConfiguration[model.provider];
  }
  if (model.source === 'relay' && providerConfiguration.relayAccountManaged === true) {
    return providerConfiguration.relayAccountBound === true;
  }
  return isConfigured(secrets, readSecret);
}

/**
 * 二级来源的展示名。
 *
 * 「官方」属于一级——一级用的就是官方模型名（Nano Banana 2）。
 * 二级只回答"从哪买"，绝不再出现「官方」二字：RunningHub 自己把标准档叫
 * 「官方稳定版」，照搬过来会让用户以为自己在直连厂商，其实付的是转售价。
 * 标准档不加后缀，低价渠道只标「低价」。
 */
/**
 * RH 的两个站要分开写。它们是各自注册、各自充值、各自密钥的两个账号——
 * 「全能图片」整个标准模型系列已从 CN 站下线迁到 AI 站，只写「RunningHub」
 * 会让用户以为充了 CN 站的钱就能用 AI 站的模型。
 */
export const SOURCE_LABELS = Object.freeze({
  official: '官方大语言模型',
  relay: 'AIFISHER API',
  runninghub_global: 'RH AI站',
  runninghub: 'RH CN站',
  dreamina_cli: '即梦 CLI',
  libtv_cli: 'LibTV CLI',
});

const TIER_SUFFIX = Object.freeze({ standard: '', budget: ' 低价' });

/**
 * 厂商直连不参与比价。
 *
 * AIFISHER API与 RunningHub 的单价是从各自的定价接口/价格页逐条取来的（实测成交价、官网牌价），
 * 而画布里那份厂商价格是历史遗留的写死值，没有依据能证明它和 Google / OpenAI 的
 * 真实账单一致——三个数字并排显示会让用户以为可信度相同。
 * 宁可不显示，也不显示一个担保不了的数字。
 *
 * 注意：节点自己的生成前预估仍然照常读 cost，那是既有行为，与本处比价无关。
 */
export const DEFERRED_PRICE_NOTE = '以官方价为准';
const PRICE_DEFERRED_NOTES = Object.freeze({
  official: DEFERRED_PRICE_NOTE,
  dreamina_cli: '以即梦积分账单为准',
  libtv_cli: '以 LibTV 积分账单为准',
});
export const MODE_REQUIRED_PRICE_NOTE = '请先选择生成模式';
export const MODE_UNVERIFIED_PRICE_NOTE = '该模式暂无实测账单';
export const RESOLUTION_UNVERIFIED_PRICE_NOTE = '该分辨率暂无实测账单';
export const MODE_UNSUPPORTED_PRICE_NOTE = '不支持当前模式';

const EQUIVALENT_MODES = Object.freeze({
  'text-to-video': ['text-to-video', 'omni-text-to-video'],
  'first-frame': ['first-frame', 'image-to-video', 'omni-image-to-video'],
  'i2v-first-last-frame': ['i2v-first-last-frame', 'omni-first-last-frame'],
  'reference-video': ['reference-video', 'omni-video-ref'],
  'video-edit': ['video-edit', 'omni-video-edit'],
  multimodal: ['multimodal'],
});

/**
 * Seedance 2.5 的 token 不是文字 token，而是输出视频像素时序：
 * width × height × 24fps × seconds ÷ 1024。这里的尺寸来自上游公开 API 规格。
 * 1080p/2K/4K 在 RH 是先生成 720p 再超分，所以 token 基数仍按 720p，另加每秒附加费。
 */
const SEEDANCE_TOKEN_DIMENSIONS = Object.freeze({
  '480p': Object.freeze({
    '21:9': [992, 432], '16:9': [864, 496], '4:3': [752, 560],
    '1:1': [640, 640], '3:4': [560, 752], '9:16': [496, 864],
  }),
  '720p': Object.freeze({
    '21:9': [1470, 630], '16:9': [1280, 720], '4:3': [1112, 834],
    '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280],
  }),
});

const VIDEO_MODES = new Set([
  'text-to-video', 'first-frame', 'i2v-first-last-frame',
  'reference-video', 'video-edit', 'multimodal',
]);
const VIDEO_PRICE_MAXIMUM_MULTIPLIER = 1.2;

function roundPrice(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function priceLabelForUnitPrice(price, duration, mode) {
  if (typeof price !== 'number' || !VIDEO_MODES.has(mode)) return null;
  if (Number.isFinite(duration) && duration > 0) {
    return `≈¥${(price * duration).toFixed(2)}/${duration}秒`;
  }
  return `¥${price}/秒`;
}

function videoPriceRange(price, duration) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  const priceMaximum = roundPrice(price * VIDEO_PRICE_MAXIMUM_MULTIPLIER);
  if (Number.isFinite(duration) && duration > 0) {
    return {
      priceMaximum,
      priceRangeLabel:
        `¥${(price * duration).toFixed(2)}–¥${(price * VIDEO_PRICE_MAXIMUM_MULTIPLIER * duration).toFixed(2)}/${duration}秒`,
    };
  }
  return {
    priceMaximum,
    priceRangeLabel: `¥${price}–¥${priceMaximum}/秒`,
  };
}

/**
 * 有完全相同参数的中转站实单时，优先显示实单总价。
 * 新键在模式/分辨率/时长后继续锁定 images/audio；旧三段键保持兼容。
 * 格式刻意保持扁平，便携包目录解析不必为了少量样本引入多层对象协议。
 */
function inferredInputImageCount(mode) {
  if (mode === 'text-to-video') return 0;
  if (mode === 'first-frame') return 1;
  if (mode === 'i2v-first-last-frame') return 2;
  return null;
}

function observedTaskPrice(model, resolution, mode, duration, {
  generateAudio = null,
  inputImageCount = null,
} = {}) {
  if (!model.observedTaskCost || !mode || !resolution) return null;
  const selectedDuration = Number(duration);
  if (!Number.isFinite(selectedDuration) || selectedDuration <= 0) return null;
  const signature = `${mode}|${String(resolution).toLowerCase()}|${selectedDuration}`
    .toLowerCase();
  const parsedInputCount = inputImageCount == null ? null : Number(inputImageCount);
  const selectedInputCount = Number.isInteger(parsedInputCount) && parsedInputCount >= 0
    ? parsedInputCount
    : inferredInputImageCount(mode);
  const matchesScope = (candidate) => {
    const parts = candidate.toLowerCase().split('|');
    if (parts.slice(0, 3).join('|') !== signature) return false;
    return parts.slice(3).every((constraint) => {
      const [key, value] = constraint.split('=');
      if (key === 'images') {
        return selectedInputCount != null && String(selectedInputCount) === value;
      }
      if (key === 'audio') {
        if (value === 'omitted') return generateAudio == null;
        return typeof generateAudio === 'boolean' && String(generateAudio) === value;
      }
      return false;
    });
  };
  // 新证据优先使用带 images/audio 的完整签名；旧三段键继续兼容。
  const matchedKey = Object.keys(model.observedTaskCost)
    .filter(matchesScope)
    .sort((left, right) => right.split('|').length - left.split('|').length)[0];
  const total = matchedKey ? Number(model.observedTaskCost[matchedKey]) : NaN;
  if (!Number.isFinite(total)) return null;
  return {
    price: roundPrice(total / selectedDuration),
    priceLabel: `≈¥${roundPrice(total, 2).toFixed(2)}/${selectedDuration}秒`,
    priceNote: '同模式、分辨率与时长的中转站实测账单',
    priceExact: true,
  };
}

function seedanceTokenPrice(model, resolution, mode, aspectRatio, duration, {
  inputImageCount = null,
} = {}) {
  if (model.priceFormula !== 'seedance-output-tokens') return null;
  // 多模态中参考视频的输入 token 仍受每段时长影响，无法在模型下拉里精确预知。
  // 但输出视频 token 是必然发生的，因此可以严格作为当前任务的最低价；
  // 不再返回 null 让画布误用通用每秒价，参考视频输入仍在说明中单独提醒。
  if (!['text-to-video', 'first-frame', 'multimodal'].includes(mode)) return null;

  const normalizedResolution = String(resolution ?? '').toLowerCase();
  const nativeResolution = normalizedResolution === '480p' ? '480p' : '720p';
  const dimensionsByRatio = SEEDANCE_TOKEN_DIMENSIONS[nativeResolution];
  const normalizedRatio = dimensionsByRatio[aspectRatio] ? aspectRatio : '16:9';
  const [width, height] = dimensionsByRatio[normalizedRatio];
  const tokensPerSecond = width * height * 24 / 1024;
  const parsedInputImageCount = Number(inputImageCount);
  const hasReferenceImage = mode === 'multimodal'
    && Number.isInteger(parsedInputImageCount)
    && parsedInputImageCount > 0;
  const referenceTokenRate = Number(model.tokenVideoPricePerMillion);
  const tokenRate = hasReferenceImage && Number.isFinite(referenceTokenRate)
    ? referenceTokenRate
    : Number(model.tokenPricePerMillion);
  if (!Number.isFinite(tokenRate)) return null;
  const surchargeKey = Object.keys(model.resolutionSurcharge ?? {}).find(
    (candidate) => candidate.toLowerCase() === normalizedResolution,
  );
  const surcharge = surchargeKey ? Number(model.resolutionSurcharge[surchargeKey]) : 0;
  const price = roundPrice(tokensPerSecond * tokenRate / 1_000_000 + surcharge);
  const selectedDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
  const ratioSuffix = aspectRatio && dimensionsByRatio[aspectRatio] ? '' : '（按16:9）';
  return {
    price,
    priceLabel: selectedDuration
      ? `≈¥${(price * selectedDuration).toFixed(2)}/${selectedDuration}秒${ratioSuffix}`
      : `≈¥${price}/秒${ratioSuffix}`,
    priceNote: mode === 'multimodal'
      ? `按最低输出 ¥${tokenRate}/百万 tokens${surcharge ? ` + ¥${surcharge}/秒` : ''} 估算；参考视频输入另计`
      : `按 ¥${tokenRate}/百万 tokens${surcharge ? ` + ¥${surcharge}/秒` : ''} 估算`,
    priceExact: false,
  };
}

const RH_CANVAS_PRICE_NOTE = 'RH当前画布价；最终以实际消耗为准';

function rhRuleParts(entry) {
  const [billing, mode, resolution, duration, audio, images] = entry.split('|');
  return { billing, mode, resolution, duration, audio, images };
}

function rhRuleFieldMatches(expected, actual) {
  if (expected === '*') return true;
  if (actual == null) return false;
  return String(expected).toLowerCase() === String(actual).toLowerCase();
}

function rhImageCountMatches(expected, actual) {
  if (expected === '*') return true;
  if (actual == null) return false;
  if (expected === '1+') return actual >= 1;
  return Number(expected) === actual;
}

function rhRuleSpecificity(rule) {
  return [rule.mode, rule.resolution, rule.duration, rule.audio, rule.images]
    .filter((value) => value !== '*').length;
}

/**
 * RH 价格页已经把它自己的 token、固定任务和条件价算成用户价。
 * 产品目录只保存这些最终数字；本函数严格匹配当前参数，不复制 RH 内部计费引擎。
 *
 * 规则格式：billing|mode|resolution|duration|audio|images。
 * billing 支持 rate（每输出秒）、total（整个任务）、input-video-rate
 * （每输入视频秒）和 image-surcharge（超过包含张数后每图附加）。
 */
function rhCanvasPrice(model, resolution, mode, duration, {
  generateAudio = null,
  inputImageCount = null,
} = {}) {
  if (!model.rhPriceRules) return null;
  if (!mode) return { price: null, priceNote: MODE_REQUIRED_PRICE_NOTE, priceExact: false };

  const normalizedResolution = resolution == null ? null : String(resolution).toLowerCase();
  const normalizedDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
    ? Number(duration)
    : null;
  const normalizedAudio = typeof generateAudio === 'boolean' ? String(generateAudio) : null;
  const parsedImages = inputImageCount == null ? null : Number(inputImageCount);
  const normalizedImages = Number.isInteger(parsedImages) && parsedImages >= 0
    ? parsedImages
    : inferredInputImageCount(mode);

  const entries = Object.entries(model.rhPriceRules)
    .map(([key, value]) => ({ ...rhRuleParts(key.toLowerCase()), value: Number(value) }))
    .filter((rule) => Number.isFinite(rule.value));
  const baseRules = entries.filter((rule) => (
    ['rate', 'floor-rate', 'total', 'input-video-rate'].includes(rule.billing)
  ));
  const modeRules = baseRules.filter((rule) => rhRuleFieldMatches(rule.mode, mode));
  const resolutionRules = modeRules.filter(
    (rule) => rhRuleFieldMatches(rule.resolution, normalizedResolution),
  );
  const matchingRules = resolutionRules.filter((rule) => (
    rhRuleFieldMatches(rule.duration, normalizedDuration)
    && rhRuleFieldMatches(rule.audio, normalizedAudio)
    && rhImageCountMatches(rule.images, normalizedImages)
  ));
  matchingRules.sort((left, right) => rhRuleSpecificity(right) - rhRuleSpecificity(left));
  const base = matchingRules[0];
  if (!base) {
    return {
      price: null,
      priceNote: modeRules.length && !resolutionRules.length
        ? RESOLUTION_UNVERIFIED_PRICE_NOTE
        : MODE_UNVERIFIED_PRICE_NOTE,
      priceExact: false,
    };
  }

  if (base.billing === 'input-video-rate') {
    const priceMaximum = roundPrice(base.value * VIDEO_PRICE_MAXIMUM_MULTIPLIER);
    return {
      price: roundPrice(base.value),
      priceLabel: `¥${base.value}/输入视频秒`,
      priceMaximum,
      priceRangeLabel: `¥${base.value.toFixed(2)}–¥${priceMaximum.toFixed(2)}/输入视频秒`,
      priceNote: RH_CANVAS_PRICE_NOTE,
      priceExact: true,
      // 按输入视频秒计价，不能拿输出时长生成通用区间；这里已经保留原单位生成区间。
      skipVideoRange: true,
    };
  }

  const imageSurcharge = entries
    .filter((rule) => rule.billing === 'image-surcharge')
    .filter((rule) => rhRuleFieldMatches(rule.mode, mode))
    .filter((rule) => rhRuleFieldMatches(rule.resolution, normalizedResolution))
    .filter((rule) => rhRuleFieldMatches(rule.audio, normalizedAudio))
    .filter((rule) => rhImageCountMatches(rule.images, normalizedImages))
    .reduce((total, rule) => {
      const included = Number(rule.duration);
      if (!Number.isInteger(normalizedImages) || !Number.isFinite(included)) return total;
      return total + Math.max(normalizedImages - included, 0) * rule.value;
    }, 0);

  const matchingSupplement = (billing) => entries
    .filter((rule) => rule.billing === billing)
    .filter((rule) => rhRuleFieldMatches(rule.mode, mode))
    .filter((rule) => rhRuleFieldMatches(rule.resolution, normalizedResolution))
    .filter((rule) => rhRuleFieldMatches(rule.duration, normalizedDuration))
    .filter((rule) => rhRuleFieldMatches(rule.audio, normalizedAudio))
    .filter((rule) => rhImageCountMatches(rule.images, normalizedImages))
    .sort((left, right) => rhRuleSpecificity(right) - rhRuleSpecificity(left))[0];
  const floorDuration = base.billing === 'floor-rate'
    ? matchingSupplement('floor-duration')?.value ?? normalizedDuration
    : normalizedDuration;
  const perGeneratedSecondSurcharge = matchingSupplement('surcharge-rate')?.value ?? 0;

  const total = base.billing === 'total'
    ? base.value + imageSurcharge
    : normalizedDuration == null
    ? null
    : base.value * floorDuration
      + perGeneratedSecondSurcharge * normalizedDuration
      + imageSurcharge;
  const price = total != null && normalizedDuration != null
    ? roundPrice(total / normalizedDuration)
    : roundPrice(base.value + imageSurcharge);
  return {
    price,
    priceLabel: total != null && normalizedDuration != null
      ? `¥${total.toFixed(2)}/${normalizedDuration}秒`
      : `¥${price.toFixed(2)}/次`,
    priceNote: RH_CANVAS_PRICE_NOTE,
    priceExact: true,
  };
}

/**
 * variantLabel 区分同一来源下的不同线路（如「宽审核」海外线路）。
 * 少了它，Seedream 在二级里会出现两条都叫「AIFISHER API」、价格差 4 倍的选项。
 */
export function sourceLabelFor(source, tier, variantLabel = null) {
  const base = SOURCE_LABELS[source] ?? source;
  const variant = variantLabel
    ? source === 'relay' && variantLabel === '宽审核'
      ? `（${variantLabel}）`
      : ` ${variantLabel}`
    : '';
  return `${base}${variant}${TIER_SUFFIX[tier] ?? ''}`;
}

/**
 * 取该模型在指定分辨率下的单价。
 *
 * 必须按用户当前选中的分辨率比价，不能取"所有档里的最低价"——
 * 各模型支持的分辨率档并不一致，拿官方的 512 档去比AIFISHER API的 512 档，
 * 会得出"官方更便宜"，而用户实际选的 2K 上AIFISHER API便宜 38%。
 */
export function costAt(cost, resolution) {
  if (typeof cost === 'number') return cost;
  if (!cost || typeof cost !== 'object') return null;
  if (resolution) {
    const key = Object.keys(cost).find(
      (candidate) => candidate.toLowerCase() === String(resolution).toLowerCase(),
    );
    if (key && typeof cost[key] === 'number') return cost[key];
    return null;
  }
  // 尚未选择分辨率时可展示起价；已选择但缺档时不跨分辨率借价。
  const values = Object.values(cost).filter((value) => typeof value === 'number');
  return values.length ? Math.min(...values) : null;
}

function hasResolution(cost, resolution) {
  if (typeof cost !== 'object' || cost === null) return true;
  if (!resolution) return false;
  return Object.keys(cost).some(
    (candidate) => candidate.toLowerCase() === String(resolution).toLowerCase(),
  );
}

function supportsMode(model, mode) {
  if (!mode) return true;
  const endpoints = Object.keys(model.endpoint ?? {});
  // 测试桩/旧快照没有 endpoint 时不能武断判死；真实目录都有 endpoint。
  if (!endpoints.length) return true;
  const candidates = EQUIVALENT_MODES[mode] ?? [mode];
  return candidates.some((candidate) => endpoints.includes(candidate));
}

function priceTextAt(priceText, resolution) {
  if (typeof priceText === 'string') return priceText;
  if (!priceText || typeof priceText !== 'object') return null;
  if (resolution) {
    const key = Object.keys(priceText).find(
      (candidate) => candidate.toLowerCase() === String(resolution).toLowerCase(),
    );
    if (key && typeof priceText[key] === 'string') return priceText[key];
  }
  return typeof priceText.default === 'string' ? priceText.default : null;
}

/**
 * 模式价是严格数据：缺了某个模式/分辨率表示没有可靠账单，不能拿别档最低价冒充。
 * 普通 cost 同样严格匹配已选分辨率。
 */
function priceFor(model, resolution, mode, {
  aspectRatio = null,
  duration = null,
  includeObservedTask = true,
  generateAudio = null,
  inputImageCount = null,
} = {}) {
  const observedPrice = includeObservedTask
    ? observedTaskPrice(model, resolution, mode, duration, { generateAudio, inputImageCount })
    : null;
  if (observedPrice) return observedPrice;
  const tokenPrice = seedanceTokenPrice(model, resolution, mode, aspectRatio, duration, {
    inputImageCount,
  });
  if (tokenPrice) return tokenPrice;
  const rhPrice = rhCanvasPrice(model, resolution, mode, duration, {
    generateAudio,
    inputImageCount,
  });
  if (rhPrice) return rhPrice;
  if (model.priceTextByMode) {
    if (!mode) {
      return { price: null, priceNote: MODE_REQUIRED_PRICE_NOTE, priceExact: false };
    }
    const modePriceText = model.priceTextByMode[mode];
    if (modePriceText) {
      const priceText = priceTextAt(modePriceText, resolution);
      return priceText
        ? { price: null, priceNote: priceText, priceExact: true }
        : { price: null, priceNote: RESOLUTION_UNVERIFIED_PRICE_NOTE, priceExact: false };
    }
  }
  if (!model.costByMode) {
    const price = costAt(model.cost, resolution);
    return {
      price,
      priceLabel: priceLabelForUnitPrice(price, duration, mode),
      priceNote: null,
      priceExact: hasResolution(model.cost, resolution),
    };
  }
  if (!mode) {
    return { price: null, priceNote: MODE_REQUIRED_PRICE_NOTE, priceExact: false };
  }
  const modeCost = model.costByMode[mode];
  if (!modeCost) {
    return {
      price: null,
      priceNote: model.priceNoteByMode?.[mode] ?? MODE_UNVERIFIED_PRICE_NOTE,
      priceExact: false,
    };
  }
  if (typeof modeCost === 'object' && resolution && !hasResolution(modeCost, resolution)) {
    return { price: null, priceNote: RESOLUTION_UNVERIFIED_PRICE_NOTE, priceExact: false };
  }
  const price = costAt(modeCost, resolution);
  return {
    price,
    priceLabel: priceLabelForUnitPrice(price, duration, mode),
    priceNote: model.priceNoteByMode?.[mode] ?? null,
    priceExact:
      hasResolution(modeCost, resolution) && !model.estimatedCostByMode?.includes(mode),
  };
}

const RELAY_CANVAS_BASELINE_NOTE = '近似价格，最终以任务账单为准';

/**
 * 中转动态层没有同参数证据时，只读当前目录项自己的画布基准价。
 *
 * 这里刻意跳过 observedTaskCost：它属于历史证据，不是展示基准；同时也绝不从
 * 其它模式的 costByMode 借价。若所选模式尚无细分基准，但目录仍有通用 cost，
 * 该数字可以作为画布基准显示，不过必须标成近似值。
 */
function relayCanvasBaselineFor(model, resolution, mode, { aspectRatio, duration }) {
  const modeBaseline = priceFor(model, resolution, mode, {
    aspectRatio,
    duration,
    includeObservedTask: false,
  });
  if (modeBaseline.price != null) return modeBaseline;

  const price = costAt(model.cost, resolution);
  if (price == null) return null;
  return {
    price,
    priceLabel: priceLabelForUnitPrice(price, duration, mode),
    priceNote: modeBaseline.priceNote ?? null,
    priceExact: false,
  };
}

function relayPriceWithCanvasFallback(model, relayPricing, context) {
  const promotion = relayPromotionFor(model, relayPricing, context.mode, context.pricingNow);
  const adjustment = relayRetailAdjustment(model, relayPricing, context.mode);
  const withPromotion = (priced, baseline = false) => {
    if (priced.price == null || (!promotion && (!baseline || !adjustment))) return priced;
    const price = baseline && adjustment ? roundPrice(priced.price * adjustment.factor, 6) : priced.price;
    return {
      ...priced,
      price,
      ...(baseline ? { priceLabel: priceLabelForUnitPrice(price, context.duration, context.mode) } : {}),
      priceExact: false,
      priceNote: [baseline ? '按实时计费倍率换算的参考价' : priced.priceNote, promotion?.note].filter(Boolean).join('；'),
      ...(promotion ? {
        discountPercent: Math.round((1 - promotion.factor) * 100),
        promotionLabel: promotion.label,
        promotionEndsAt: promotion.endsAt,
      } : {}),
    };
  };
  const dynamicPrice = relayPriceFor(model, relayPricing, context);
  const observedPrice = observedTaskPrice(
    model, context.resolution, context.mode, context.duration, context,
  );
  const isVideoContext = mediaKindOf(model) === 'video';
  const hasCurrentParameterEvidence = !isVideoContext
    || relayPriceHasCurrentParameterEvidence(model, relayPricing, context);
  if (dynamicPrice.price != null && hasCurrentParameterEvidence) {
    return withPromotion(dynamicPrice);
  }
  if (observedPrice) return withPromotion(observedPrice, true);

  const baseline = relayCanvasBaselineFor(model, context.resolution, context.mode, context);
  if (baseline?.price == null) {
    if (dynamicPrice.price != null && isVideoContext && !hasCurrentParameterEvidence) {
      return { price: null, priceNote: RELAY_PRICE_INSUFFICIENT_NOTE, priceExact: false };
    }
    return withPromotion(dynamicPrice);
  }

  const dynamicNote = dynamicPrice.price != null && isVideoContext && !hasCurrentParameterEvidence
    ? RELAY_PRICE_INSUFFICIENT_NOTE
    : dynamicPrice.priceNote;
  const notes = [dynamicNote, baseline.priceNote, RELAY_CANVAS_BASELINE_NOTE]
    .filter((note, index, all) => note && all.indexOf(note) === index);
  return withPromotion({
    ...baseline,
    priceNote: notes.join('；'),
    priceExact: false,
  }, true);
}

/**
 * 推出模型的媒体类型。
 *
 * Provider 后缀是目录里最可靠的结构信息：Vidu Q3 Reference 只有 reference-video，
 * 单看模式名会被误判成文本。未带媒体后缀的共用 Provider 才退回模式名判断。
 */
export function mediaKindOf(model) {
  const providerKind = String(model?.provider || '').match(/(Text|Image|Audio|Video)Provider$/)?.[1];
  if (providerKind) return providerKind.toLowerCase();

  const modes = Object.keys(model?.endpoint ?? {});
  if (modes.some((mode) => /-to-video$|^video-/.test(mode))) return 'video';
  if (modes.some((mode) => /-to-image$|^image-|layer-decomposition/.test(mode))) return 'image';
  if (modes.some((mode) => /audio|music|speech|tts/.test(mode))) return 'audio';
  return 'text';
}

/**
 * 品牌 = 下拉的一级。
 *
 * 「Nano Banana 1 / 2 / 2 Lite / Pro」是同一个品牌的四个版本，平铺成四行既占地方
 * 又看不出它们的关系；折成「Nano Banana → 选版本」才对得上用户脑子里的模型谱系。
 *
 * 用规则表按前缀推，而不是给 50 个条目逐个加字段：品牌是从版本名里读得出来的，
 * 多存一份就多一处会漂移。目录里写了 `brand:` 的以它为准（新模型名字不合规律时用）。
 * 推不出来就拿版本名当品牌，退化成一级一行——和现在一样，不会更差。
 */
const BRAND_RULES = [
  ['Nano Banana', 'Nano Banana'],
  ['GPT Image', 'GPT Image'],
  ['Midjourney', 'MJ'],
  ['Qwen Image', 'Qwen Image'],
  ['Seedream', 'Seedream'],
  ['Grok', 'Grok'],
  ['即梦图片', '即梦'],
  ['豆包图片', '豆包图片'],
  ['Seedance', 'Seedance'],
  ['Kling', 'Kling'],
  ['MiniMax', 'MiniMax'],
  ['谷歌OMNI', '谷歌OMNI'],
  ['Vidu', 'Vidu'],
  ['Veo', 'Veo'],
  ['豆包大语言', '豆包大语言'],
  ['可灵', '可灵'],
  ['Mureka', 'Mureka'],
  ['GPT-', 'GPT'],
  ['DeepSeek', 'DeepSeek'],
  ['Gemini', 'Gemini'],
];

export function brandOf(model) {
  if (model.brand) return model.brand;
  const canonical = model.canonicalModel ?? model.name ?? '';
  for (const [prefix, brand] of BRAND_RULES) {
    if (canonical.startsWith(prefix)) return brand;
  }
  return canonical;
}

/**
 * 能力标签 = 这个版本能干什么，从 endpoint 的模式名推出来。
 *
 * 目录里本来就按模式记着（`text-to-video` / `i2v-first-last-frame` …），
 * 不需要新数据；它同时也是下拉顶部那排筛选的取值来源。
 * 认不出来的模式直接丢掉，不猜——标错能力会让用户连一个不支持首尾帧的模型。
 */
const CAPABILITY_LABELS = Object.freeze({
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'image-inpainting': '局部重绘',
  'layer-decomposition': '图层分解',
  'text-to-video': '文生视频',
  'omni-text-to-video': '文生视频',
  'first-frame': '首帧',
  'image-to-video': '首帧',
  'omni-image-to-video': '首帧',
  'i2v-first-last-frame': '首尾帧',
  'omni-first-last-frame': '首尾帧',
  // 「多图参考」是 RunningHub 自己的叫法，跟着它——用户对着 RH 的界面挑模型时
  // 两边词对不上会以为是两个不同的能力。
  'reference-video': '多图参考',
  'omni-video-ref': '视频参考',
  'video-extend': '视频延长',
  'video-edit': '视频编辑',
  'omni-video-edit': '视频编辑',
  multimodal: '全能参考',
  'motion-control': '动作控制',
  'lyrics-to-music': '词生曲',
  instrumental: '纯音乐',
  'multimodal-chat': '多模态对话',
});

export function capabilitiesOf(model) {
  const labels = [];
  for (const mode of Object.keys(model?.endpoint ?? {})) {
    // All text providers use the stable `multimodal-chat` route key. The
    // actual capability comes from its declared input contract: only a model
    // that accepts image/video/audio inputs is multimodal; text-only models
    // must not advertise visual support in the picker.
    const label = mode === 'multimodal-chat'
      ? (() => {
        const chatMode = Array.isArray(model?.languageModes)
          ? model.languageModes.find((entry) => entry?.value === 'multimodal-chat')
          : null;
        if (!chatMode?.allowedInputs) return CAPABILITY_LABELS[mode];
        const acceptsNonText = ['image', 'video', 'audio']
          .some((kind) => Number(chatMode.allowedInputs[kind]) > 0);
        return acceptsNonText ? '多模态对话' : '文本对话';
      })()
      : CAPABILITY_LABELS[mode];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

export const SOURCE_ORDER = ['relay', 'runninghub_global', 'runninghub', 'official', 'dreamina_cli', 'libtv_cli'];
const MEDIA_ORDER = ['image', 'video', 'text', 'audio'];

/**
 * 设置页用的切法：按站分块 → 块内按媒体类型 → 模型。
 *
 * 网关模式下 AIFISHER API 读取当前账号在 Identity 的绑定状态；
 * 非网关开发模式仍可以回退到本机 RELAY_API_KEY。RunningHub 仍是单密钥站点；
 * 官方是每家一个密钥，所以它的 requiredSecrets 是各家密钥的并集，
 * 且 configured 只在全部填齐时为真——界面要按家分别显示，不能只给一个总开关。
 */
export function buildSourceSettings({
  catalog = loadModelCatalog(),
  readSecret = (key) => process.env[key],
  providerConfiguration = {},
} = {}) {
  const blocks = new Map();

  for (const model of Object.values(catalog)) {
    if (model.selectable === false) continue;
    // 来源目录也供助手发现模型与准备生成使用；卡片去重由设置页负责。
    const secrets = SECRETS_BY_PROVIDER.get(model.provider) ?? [];
    const block = blocks.get(model.source) ?? {
      source: model.source,
      label: SOURCE_LABELS[model.source] ?? model.source,
      secrets: new Set(),
      media: new Map(),
    };
    for (const key of secrets) block.secrets.add(key);

    const kind = mediaKindOf(model);
    const list = block.media.get(kind) ?? [];
    list.push({
      name: model.name,
      tier: model.tier,
      customModelId: model.customModelId || '',
      ...(kind === 'text' ? { vision: model.customModelId ? 'unknown'
        : model.supportedReferenceTypes?.includes('image') ? 'supported'
          : model.source !== 'relay' && model.supportedReferenceTypes?.includes('text') ? 'unsupported' : 'unknown' } : {}),
      modelIds: Object.values(model.endpoint || {}).filter((entry) => entry && typeof entry === 'object').map((entry) => entry.model).filter(Boolean),
      variantLabel: model.variantLabel,
      requiredSecrets: [...secrets],
      configured: isProviderConfigured(model, secrets, readSecret, providerConfiguration),
    });
    block.media.set(kind, list);
    blocks.set(model.source, block);
  }

  return SOURCE_ORDER
    .filter((source) => blocks.has(source))
    .map((source) => {
      const block = blocks.get(source);
      const secrets = [...block.secrets].sort();
      const accountManaged = source === 'relay'
        && providerConfiguration.relayAccountManaged === true;
      return {
        source: block.source,
        label: block.label,
        ...(accountManaged ? { accountManaged: true } : {}),
        // 该站需要的全部密钥，以及各自填没填——官方那块要逐家显示。
        secrets: secrets.map((key) => ({
          key,
          configured: accountManaged
            ? providerConfiguration.relayAccountBound === true
            : Boolean(String(readSecret(key) ?? '').trim()),
        })),
        singleKey: secrets.length === 1,
        media: MEDIA_ORDER
          .filter((kind) => block.media.has(kind))
          .map((kind) => ({ kind, models: block.media.get(kind) })),
      };
    });
}

export function buildModelAvailability({
  catalog = loadModelCatalog(),
  readSecret = (key) => process.env[key],
  resolution = null,
  mode = null,
  aspectRatio = null,
  duration = null,
  speed = null,
  generateAudio = null,
  inputImageCount = null,
  relayPricing = undefined,
  providerConfiguration = {},
  pricingNow = Date.now(),
} = {}) {
  const groups = new Map();

  for (const model of Object.values(catalog)) {
    if (model.selectable === false) continue;
    const secrets = SECRETS_BY_PROVIDER.get(model.provider) ?? [];
    const deferredNote = PRICE_DEFERRED_NOTES[model.source] ?? null;
    const parsedFixedDuration = Number(model.fixedDuration);
    const fixedDuration = Number.isFinite(parsedFixedDuration) && parsedFixedDuration > 0
      ? parsedFixedDuration
      : null;
    const effectiveDuration = normalizeModelDuration(model, duration);
    // AiFisher 中转站是动态路由：同参数估价优先；证据不足或接口离线时，
    // 保留用户提供的画布基准价并明确标成近似值。动态 null 只表示“没有动态证据”，
    // 不能抹掉目录里的展示基准。文本模型仍保留 token 计费说明。
    const useRelayPricing = model.source === 'relay'
      && relayPricing !== undefined
      && !model.priceTextByMode;
    const priced = model.customModelId
      ? { price: null, priceNote: `自定义模型 ${model.customModelId}，按服务商实际账单计费`, priceExact: false }
      : !supportsMode(model, mode)
      ? { price: null, priceNote: MODE_UNSUPPORTED_PRICE_NOTE, priceExact: false }
      : deferredNote
      ? { price: null, priceNote: deferredNote, priceExact: true }
      : useRelayPricing
      ? relayPriceWithCanvasFallback(
        model,
        relayPricing,
        {
          resolution,
          mode,
          aspectRatio,
          duration: effectiveDuration,
          speed,
          generateAudio,
          inputImageCount,
          pricingNow,
        },
      )
      : priceFor(model, resolution, mode, {
        aspectRatio,
        duration: effectiveDuration,
        generateAudio,
        inputImageCount,
      });
    const visibleVideoRange = mediaKindOf(model) !== 'video'
      ? null
      : priced.skipVideoRange
      ? Number.isFinite(priced.priceMaximum) && priced.priceRangeLabel
        ? {
          priceMaximum: priced.priceMaximum,
          priceRangeLabel: priced.priceRangeLabel,
        }
        : null
      : videoPriceRange(priced.price, effectiveDuration);
    const variant = {
      name: model.name,
      source: model.source,
      sourceLabel: sourceLabelFor(model.source, model.tier, model.variantLabel),
      variantLabel: model.variantLabel ?? null,
      tier: model.tier,
      // 同站已有更便宜的等价渠道，这条只是贵一档的官方稳定版。前端默认折起来。
      premium: Boolean(model.premium),
      provider: model.provider,
      requiredSecrets: [...secrets],
      configured: isProviderConfigured(model, secrets, readSecret, providerConfiguration),
      price: priced.price,
      priceLabel: priced.priceLabel ?? null,
      ...(visibleVideoRange ?? {}),
      priceNote: priced.priceNote,
      // 该来源不支持当前分辨率时，价格是回退的近似值，界面必须标出来，
      // 不能让用户以为是这一档的实价。
      priceExact: priced.priceExact,
      ...(priced.discountPercent == null ? {} : { discountPercent: priced.discountPercent }),
      ...(priced.promotionLabel ? { promotionLabel: priced.promotionLabel, promotionEndsAt: priced.promotionEndsAt } : {}),
      ...(fixedDuration != null ? { fixedDuration } : {}),
      ...(effectiveDuration != null ? { effectiveDuration } : {}),
      ...(model.durationRange ? { durationRange: { ...model.durationRange } } : {}),
    };
    const group = groups.get(model.canonicalModel) ?? {
      canonicalModel: model.canonicalModel,
      brand: brandOf(model),
      capabilities: [],
      variants: [],
    };
    // 同一版本的各来源支持的模式可能略有出入（低价渠道常砍掉视频编辑之类），
    // 取并集：一级要回答的是"这个版本能干什么"，具体某个来源能不能干由它自己报错。
    for (const label of capabilitiesOf(model)) {
      if (!group.capabilities.includes(label)) group.capabilities.push(label);
    }
    group.variants.push(variant);
    groups.set(model.canonicalModel, group);
  }

  for (const group of groups.values()) {
    group.variants.sort((a, b) => {
      const tier = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
      if (tier !== 0) return tier;
      // 同一模型的来源按站点成组；同站内标准线路在前，宽审核/Pro 等变体紧跟其后。
      // 这样「AIFISHER API（宽审核）」不会因为价格更低而跑到普通 API 上面。
      const source = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
      if (source !== 0) return source;
      const variant = Number(Boolean(a.variantLabel)) - Number(Boolean(b.variantLabel));
      if (variant !== 0) return variant;
      // 报得出价的一律排在报不出价的前面（厂商直连、缺价数据都算报不出）。
      // 这一条必须先于 priceExact 判断：否则一个"精确但没有数字"的条目
      // 会排到"近似但有数字"的前面，比价就没意义了。
      const aPriced = a.price != null;
      const bPriced = b.price != null;
      if (aPriced !== bPriced) return aPriced ? -1 : 1;
      if (!aPriced) return 0;
      // 都有价：不支持当前分辨率的（价格是回退近似值）排后面。
      if (a.priceExact !== b.priceExact) return a.priceExact ? -1 : 1;
      return a.price - b.price;
    });
    // 只要有一个来源可用，这个模型在一级列表里就是亮的。
    group.available = group.variants.some((variant) => variant.configured);
  }

  return [...groups.values()];
}
