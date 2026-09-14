/**
 * AiFisher 中转站的价格不是一张固定单价表。
 *
 * `/api/pricing` 同时包含当前路由、历史结算样本和按参数训练的估价档案。
 * 这里仅消费只读估价档案，并严格回答“当前参数有没有动态证据”。没有足够历史时
 * 返回空证据；是否显示目录里的画布基准价，由上层价格合成负责。
 */

const DEFAULT_BASE_URL = 'https://api.work-fisher.com';
const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export const RELAY_PRICE_UNAVAILABLE_NOTE = '中转站实时估价暂不可用';
export const RELAY_PRICE_INSUFFICIENT_NOTE = '当前参数暂无可靠历史估价';

const MODE_ALIASES = Object.freeze({
  'text-to-video': ['text-to-video', 'omni-text-to-video'],
  'first-frame': ['first-frame', 'image-to-video', 'omni-image-to-video'],
  'i2v-first-last-frame': ['i2v-first-last-frame', 'omni-first-last-frame'],
  'reference-video': ['reference-video', 'omni-video-ref'],
  'video-edit': ['video-edit', 'omni-video-edit'],
  multimodal: ['multimodal'],
});

const VIDEO_MODES = new Set([
  'text-to-video', 'first-frame', 'i2v-first-last-frame',
  'reference-video', 'video-edit', 'multimodal',
]);

const IMAGE_MODES = new Set([
  'text-to-image', 'image-to-image', 'image-inpainting', 'layer-decomposition',
]);

const PRICING_FEATURE_KINDS = new Set([
  'speed', 'resolution', 'duration', 'aspectRatio', 'inputImageCount', 'generateAudio',
]);

function roundPrice(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function endpointForMode(model, mode) {
  const endpoints = model?.endpoint ?? {};
  const keys = Object.keys(endpoints);
  let selectedKey = null;
  if (mode) {
    selectedKey = (MODE_ALIASES[mode] ?? [mode]).find((candidate) => endpoints[candidate]);
  } else if (keys.length === 1) {
    [selectedKey] = keys;
  }
  if (!selectedKey) return null;
  const endpoint = endpoints[selectedKey];
  return Array.isArray(endpoint) ? endpoint[0] : endpoint;
}

function featureKind(feature) {
  const normalized = String(feature || '').toLowerCase();
  if (normalized === 'speed' || normalized.endsWith('.speed')) return 'speed';
  if (normalized.includes('resolution')) return 'resolution';
  if (normalized === 'duration' || normalized.endsWith('.duration')
      || normalized === 'duration_seconds' || normalized.endsWith('.duration_seconds')
      || normalized === 'seconds' || normalized.endsWith('.seconds')) {
    return 'duration';
  }
  if (normalized.includes('ratio') || normalized.includes('aspect')) return 'aspectRatio';
  if (normalized.includes('input_image_count') || normalized.includes('inputimagecount')) {
    return 'inputImageCount';
  }
  if (normalized.includes('generate_audio') || normalized.includes('generateaudio')) {
    return 'generateAudio';
  }
  return normalized;
}

function inputImageCountForMode(mode) {
  if (mode === 'text-to-video') return 0;
  if (mode === 'first-frame') return 1;
  if (mode === 'i2v-first-last-frame') return 2;
  return null;
}

function desiredFeatureValue(kind, context) {
  if (kind === 'speed') return context.speed == null
    ? null : String(context.speed).toLowerCase();
  if (kind === 'resolution') return context.resolution == null
    ? null : String(context.resolution).toLowerCase();
  if (kind === 'duration') {
    const duration = Number(context.duration);
    return Number.isFinite(duration) && duration > 0 ? String(duration) : null;
  }
  if (kind === 'aspectRatio') return context.aspectRatio == null
    ? null : String(context.aspectRatio).toLowerCase();
  if (kind === 'inputImageCount') {
    const parsedInputImageCount = context.inputImageCount == null
      ? null : Number(context.inputImageCount);
    const inputImageCount = Number.isInteger(parsedInputImageCount) && parsedInputImageCount >= 0
      ? parsedInputImageCount
      : inputImageCountForMode(context.mode);
    return inputImageCount == null ? null : String(inputImageCount);
  }
  if (kind === 'generateAudio') {
    return typeof context.generateAudio === 'boolean' ? String(context.generateAudio) : null;
  }
  return null;
}

function entryFeatureValue(params, kind) {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (featureKind(key) !== kind || value == null) continue;
    return String(value).toLowerCase();
  }
  return null;
}

function historicalFeatureMatches(kind, actual, desired) {
  if (actual == null || desired == null) return false;
  if (kind !== 'duration') return actual === desired;
  const range = String(actual).match(/^\s*(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!range) return actual === desired;
  const value = Number(desired);
  const minimum = Number(range[1]);
  const maximum = Number(range[2]);
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function modelFixesCurrentDuration(model, context) {
  const fixedDuration = Number(model?.fixedDuration);
  const currentDuration = Number(context?.duration);
  return Number.isFinite(fixedDuration)
    && fixedDuration > 0
    && fixedDuration === currentDuration;
}

function weightedMedian(entries) {
  const sorted = [...entries].sort((left, right) => left.price_cny - right.price_cny);
  const totalWeight = sorted.reduce((total, entry) => total + Math.max(1, Number(entry.sample_count) || 1), 0);
  let current = 0;
  for (const entry of sorted) {
    current += Math.max(1, Number(entry.sample_count) || 1);
    if (current >= totalWeight / 2) return Number(entry.price_cny);
  }
  return Number(sorted.at(-1)?.price_cny);
}

function historicalEstimate(profile, context) {
  if (!profile || profile.status !== 'ready' || !Array.isArray(profile.entries)
      || profile.entries.length === 0) return null;

  const knownFeatures = (profile.active_features ?? [])
    .map(featureKind)
    .map((kind) => ({ kind, desired: desiredFeatureValue(kind, context) }))
    .filter((feature) => feature.desired != null);
  const candidates = profile.entries.filter((entry) => knownFeatures.every(({ kind, desired }) => {
    const actual = entryFeatureValue(entry.params, kind);
    return historicalFeatureMatches(kind, actual, desired);
  }));
  if (!candidates.length) return null;

  const price = weightedMedian(candidates);
  const low = Math.min(...candidates.map((entry) => Number(entry.low_cny ?? entry.price_cny)));
  const high = Math.max(...candidates.map((entry) => Number(entry.high_cny ?? entry.price_cny)));
  if (![price, low, high].every(Number.isFinite)) return null;
  return { price, low, high, evidence: 'estimate' };
}

function observedEstimate(observed, context, model) {
  if (!observed || !Array.isArray(observed.entries) || observed.entries.length === 0) return null;

  // observed_prices 没有 active_features，只能从实际账单参数中推断可比维度。
  // 只要该维度在账单里出现，就必须与用户当前选择完全一致；
  // 不允许拿 480p/10s 的历史价填给 720p/5s。
  // 视频任务如果没有时长证据，不能把一次固定总价外推到任意秒数。
  // 例如 Veo 的旧样本只记录了输入图数，曾被错当成文生视频价格。
  if (VIDEO_MODES.has(context.mode) && desiredFeatureValue('duration', context) != null
      && !modelFixesCurrentDuration(model, context)
      && !observed.entries.some((entry) => entryFeatureValue(entry.params, 'duration') != null)) {
    return null;
  }

  const observedFeatureValue = (entry, kind) => {
    const actual = entryFeatureValue(entry.params, kind);
    if (actual == null && kind === 'inputImageCount' && context.mode === 'text-to-video') {
      return '0';
    }
    return actual;
  };
  const comparableFeatures = [
    'speed', 'resolution', 'duration', 'aspectRatio', 'inputImageCount', 'generateAudio',
  ]
    .map((kind) => ({ kind, desired: desiredFeatureValue(kind, context) }))
    .filter(({ kind, desired }) => desired != null
      && observed.entries.some((entry) => observedFeatureValue(entry, kind) != null));
  const candidates = observed.entries.filter((entry) => comparableFeatures.every(({ kind, desired }) =>
    observedFeatureValue(entry, kind) === desired));
  if (!candidates.length) return null;

  const price = weightedMedian(candidates);
  const prices = candidates.map((entry) => Number(entry.price_cny)).filter(Number.isFinite);
  if (!Number.isFinite(price) || !prices.length) return null;
  return {
    price,
    low: Math.min(...prices),
    high: Math.max(...prices),
    evidence: 'observed',
  };
}

/**
 * 本地精确实单与实时动态价同时存在时，只有动态档案确实覆盖了当前视频参数，
 * 才允许它覆盖实单。空 active_features 或只按时长聚合的档案仍可作为近似价显示，
 * 但不能冒充同分辨率、同时长的当前参数证据。
 */
export function relayPriceHasCurrentParameterEvidence(model, snapshot, context = {}) {
  if (!VIDEO_MODES.has(context.mode) || !snapshot) return false;
  const modelId = endpointForMode(model, context.mode)?.model;
  if (!modelId) return false;

  const profile = snapshot.price_estimates?.[modelId];
  const historical = historicalEstimate(profile, context);
  if (historical) {
    const activeKinds = (profile.active_features ?? []).map(featureKind);
    return activeKinds.includes('duration')
      && activeKinds.includes('resolution')
      && activeKinds.every((kind) => desiredFeatureValue(kind, context) != null);
  }

  const observed = snapshot.observed_prices?.[modelId];
  if (!observedEstimate(observed, context, model)) return false;
  const observedKinds = new Set(
    (observed.entries ?? [])
      .flatMap((entry) => Object.keys(entry.params ?? {}).map(featureKind))
      .filter((kind) => PRICING_FEATURE_KINDS.has(kind)),
  );
  return (observedKinds.has('duration') || modelFixesCurrentDuration(model, context))
    && observedKinds.has('resolution')
    && [...observedKinds].every((kind) => desiredFeatureValue(kind, context) != null);
}

function money(value) {
  const numeric = Number(value);
  const absolute = Math.abs(numeric);
  if (absolute >= 1) return numeric.toFixed(2);
  const digits = absolute > 0 && absolute < 0.01 ? 4 : absolute < 1 ? 3 : 2;
  return numeric.toFixed(digits).replace(/\.?0+$/, '');
}

/**
 * 把当前参数映射到中转站的历史估价档案。
 * 返回的 price 只用于同一时长下的排序；priceLabel/priceNote 才是用户看到的语义。
 */
export function relayPriceFor(model, snapshot, context = {}) {
  if (!snapshot) {
    return { price: null, priceNote: RELAY_PRICE_UNAVAILABLE_NOTE, priceExact: false };
  }
  const endpoint = endpointForMode(model, context.mode);
  const modelId = endpoint?.model;
  if (!modelId) {
    return { price: null, priceNote: context.mode ? RELAY_PRICE_INSUFFICIENT_NOTE : '请先选择生成模式', priceExact: false };
  }
  // These usage-billed image routes vary by quality, output and reference tokens.
  // The current pricing context does not carry those dimensions; do not match an
  // unrelated historical bill just because its resolution happens to agree.
  if (/^(?:workfisher-image-g-v2\.5-|zhenzhen-image-g-v2\.5-)(flare|sunburst)$/.test(modelId)) {
    return { price: null, priceNote: '按实际用量计费，历史最低参考不代表当前任务费用', priceExact: false };
  }
  const estimate = historicalEstimate(snapshot.price_estimates?.[modelId], context)
    ?? observedEstimate(snapshot.observed_prices?.[modelId], context, model);
  if (!estimate) {
    return { price: null, priceNote: RELAY_PRICE_INSUFFICIENT_NOTE, priceExact: false };
  }

  const duration = Number(context.duration);
  const isTimedVideo = VIDEO_MODES.has(context.mode)
    && Number.isFinite(duration) && duration > 0;
  const isImageTask = IMAGE_MODES.has(context.mode);
  const comparablePrice = isTimedVideo ? estimate.price / duration : estimate.price;
  const hasRange = Math.abs(estimate.high - estimate.low) > 0.005;
  // The relay publishes this as an informational comparison to its normal
  // official price. The estimate above is already the billable current price;
  // never multiply it a second time in the canvas.
  const officialFactor = Number(snapshot.official_price_discounts?.[modelId]);
  const discountPercent = Number.isFinite(officialFactor) && officialFactor > 0 && officialFactor < 1
    ? Math.round((1 - officialFactor) * 100)
    : null;
  return {
    price: roundPrice(comparablePrice, isImageTask ? 2 : 4),
    priceLabel: isTimedVideo
      ? `≈¥${money(estimate.price)}/${duration}秒`
      : `≈¥${isImageTask ? Number(estimate.price).toFixed(2) : money(estimate.price)}/次`,
    priceNote: hasRange
      ? `历史${estimate.evidence === 'observed' ? '账单' : '估价'}区间 ¥${money(estimate.low)}–${money(estimate.high)}；最终以任务账单为准`
      : estimate.evidence === 'observed'
      ? '同参数历史账单；最终以本次任务账单为准'
      : '历史估价；最终以任务账单为准',
    priceExact: false,
    ...(discountPercent == null ? {} : { discountPercent }),
  };
}

export function createRelayPricingClient({
  fetchImpl = globalThis.fetch,
  baseUrl = process.env.RELAY_BASE_URL || DEFAULT_BASE_URL,
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
  logger = console,
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;

  async function load() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/api/pricing`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!body?.success || !body?.pricing_version) throw new Error('响应缺少定价版本');
      cached = body;
      expiresAt = now() + ttlMs;
      return cached;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async getSnapshot({ waitForFresh = true } = {}) {
      if (cached && now() < expiresAt) return cached;
      if (!pending) {
        pending = load()
          .catch((error) => {
            logger.warn?.('[RelayPricing] 读取实时定价失败：', error?.message || error);
            return null;
          })
          .finally(() => { pending = null; });
      }
      // 模型目录属于本机首屏，不能等待远端价格网络。调用方可先使用上次可信快照
      // （首次为空），当前刷新继续在后台进行；计费和真实提交仍走各自严格契约。
      return waitForFresh ? pending : cached;
    },
  };
}
