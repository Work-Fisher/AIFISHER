/** Compact model catalog, source selection and parameter-aware pricing. */

import { filterCanvasModelGroups, type ModelGroupFilter } from './canvasModelCatalogPolicy';
import { createStableTextElement as textElement } from '../design/dom';
import type {
  ModelGroup,
  ModelPricingContext,
  ModelVariant,
  SourceSettingsClient,
} from './sourceSettingsClient';
import { preferenceStorage } from '../persistence/preferenceStore';

const PANEL_ATTRIBUTE = 'data-fisherai-model-picker';
/**
 * 稳定版把比例和分辨率画在同一个按钮上（「1:1 · 1K」），所以不能整串匹配，
 * 要从里面把档位摘出来。前后必须是非字母数字，否则 "GPT-4K..." 这类名字会误命中。
 */
const RESOLUTION_PATTERN =
  /(?:^|[^0-9A-Za-z])(480p|540p|720p|1080p|512|1K|2K|4K|8K)(?:$|[^0-9A-Za-z])/i;
const ASPECT_RATIO_PATTERN = /(?:^|[^0-9])(21:9|16:9|4:3|1:1|3:4|9:16)(?:$|[^0-9])/;
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(?:s|秒)$/i;
const SPEED_PATTERN = /^(relax|fast|turbo)$/i;
const MIN_VIDEO_DURATION_SECONDS = 2;

const MODE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Imagine$/i, 'text-to-image'],
  [/文生图/, 'text-to-image'],
  [/图生图/, 'image-to-image'],
  [/首尾帧/, 'i2v-first-last-frame'],
  [/文生(?:音)?视频/, 'text-to-video'],
  [/首帧/, 'first-frame'],
  [/多图参考|视频参考/, 'reference-video'],
  [/视频编辑/, 'video-edit'],
  [/全能参考|多模态视频/, 'multimodal'],
];
/**
 * 「更多渠道」开关，记在账号界面偏好里（ADR-0035）。
 *
 * 同一个模型在同一个站往往有好几条渠道。全铺开会把下拉撑成一堵墙，
 * 所以默认只留主推的那几条：**各站的官方档**（用户用的就是官方版，
 * 这样跨站比价才是同一个东西比同一个东西），把低价渠道和同站更贵的那档收起来。
 * 想看全部就按这个开关——它是偏好不是可用性，存本地就够，不占服务端配置项。
 */
const PREMIUM_STORAGE_KEY = 'fisherai.model-picker.premium';

type ModelPricingLoader = (
  resolution: string | null,
  mode: string | null,
  context: ModelPricingContext,
) => Promise<ModelGroup[]>;

type StableModelPricingBridge = {
  subscribe: (listener: () => void) => () => void;
  version: () => number;
  setLoader: (loader: ModelPricingLoader) => void;
  ensure: (
    resolution: string | null,
    mode: string | null,
    context: ModelPricingContext,
  ) => Promise<void>;
  remember: (
    groups: ModelGroup[],
    resolution: string | null,
    mode: string | null,
    context: ModelPricingContext,
  ) => void;
  priceFor: (
    modelName: string,
    mode: string | null,
    resolution: string | null,
    aspectRatio: string | null,
    duration?: number | null,
    speed?: string | null,
    generateAudio?: boolean | null,
    inputImageCount?: number | null,
  ) => number | null;
};

declare global {
  interface Window {
    __FISHERAI_MODEL_PRICING__?: StableModelPricingBridge;
  }
}

function normalizedPricePart(value: string | number | boolean | null | undefined): string {
  return value == null ? '' : String(value).trim().toLowerCase();
}

function pricingContextKey(
  mode: string | null,
  resolution: string | null,
  aspectRatio: string | null,
  duration: number | null = null,
  speed: string | null = null,
  generateAudio: boolean | null = null,
  inputImageCount: number | null = null,
): string {
  return [mode, resolution, aspectRatio, duration, speed, generateAudio, inputImageCount]
    .map(normalizedPricePart)
    .join('|');
}

export function installStableModelPricingBridge(target: Window = window): StableModelPricingBridge {
  if (target.__FISHERAI_MODEL_PRICING__) return target.__FISHERAI_MODEL_PRICING__;

  const pricesByContext = new Map<string, Map<string, number>>();
  const refreshedAt = new Map<string, number>();
  const PRICE_REFRESH_MS = 5 * 60 * 1000;
  const pendingByContext = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let loader: ModelPricingLoader | null = null;
  let version = 0;
  const bridge: StableModelPricingBridge = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version() {
      return version;
    },
    setLoader(nextLoader) {
      loader = nextLoader;
    },
    async ensure(resolution, mode, context) {
      const key = pricingContextKey(
        mode,
        resolution,
        context.aspectRatio ?? null,
        context.duration ?? null,
        context.speed ?? null,
        context.generateAudio ?? null,
        context.inputImageCount ?? null,
      );
      const fresh =
        pricesByContext.has(key) && Date.now() - (refreshedAt.get(key) ?? 0) < PRICE_REFRESH_MS;
      if (fresh || !loader) return;
      const pending = pendingByContext.get(key);
      if (pending) return pending;
      const request = loader(resolution, mode, context)
        .then((groups) => bridge.remember(groups, resolution, mode, context))
        // 节点价格拉取失败时保留目录基准，不能产生未处理 Promise 或阻断生成。
        .catch(() => undefined)
        .finally(() => pendingByContext.delete(key));
      pendingByContext.set(key, request);
      return request;
    },
    remember(groups, resolution, mode, context) {
      const prices = new Map<string, number>();
      for (const group of groups) {
        for (const variant of group.variants) {
          if (variant.price == null || !Number.isFinite(variant.price)) continue;
          prices.set(normalizedPricePart(variant.name), variant.price);
        }
      }
      pricesByContext.set(
        pricingContextKey(
          mode,
          resolution,
          context.aspectRatio ?? null,
          context.duration ?? null,
          context.speed ?? null,
          context.generateAudio ?? null,
          context.inputImageCount ?? null,
        ),
        prices,
      );
      refreshedAt.set(
        pricingContextKey(
          mode,
          resolution,
          context.aspectRatio ?? null,
          context.duration ?? null,
          context.speed ?? null,
          context.generateAudio ?? null,
          context.inputImageCount ?? null,
        ),
        Date.now(),
      );
      version += 1;
      for (const listener of listeners) listener();
    },
    priceFor(
      modelName,
      mode,
      resolution,
      aspectRatio,
      duration = null,
      speed = null,
      generateAudio = null,
      inputImageCount = null,
    ) {
      const prices = pricesByContext.get(
        pricingContextKey(
          mode,
          resolution,
          aspectRatio,
          duration,
          speed,
          generateAudio,
          inputImageCount,
        ),
      );
      return prices?.get(normalizedPricePart(modelName)) ?? null;
    },
  };
  target.__FISHERAI_MODEL_PRICING__ = bridge;
  return bridge;
}

export function premiumEnabled(
  storage: Pick<Storage, 'getItem'> | undefined = preferenceStorage(),
): boolean {
  try {
    return storage?.getItem(PREMIUM_STORAGE_KEY) === 'on';
  } catch {
    // 隐私模式下读 localStorage 会抛。开关读不到就当没开，不能因此让下拉整个挂掉。
    return false;
  }
}

function setPremiumEnabled(
  on: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = preferenceStorage(),
) {
  try {
    storage?.setItem(PREMIUM_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* 存不下就只在本次下拉里生效，不值得为此报错。 */
  }
}

/**
 * 按开关滤掉收起来的次要渠道。
 *
 * 兜底一条：某个模型的全部来源都是高价版时不做过滤——宁可多列一行，
 * 也不能让一个明明配了密钥的模型从下拉里整个消失。
 */
export function applyPremiumFilter(variants: ModelVariant[], showPremium: boolean): ModelVariant[] {
  if (showPremium) return variants;
  const cheap = variants.filter((variant) => !variant.premium);
  return cheap.length ? cheap : variants;
}

/**
 * 找出节点当前选的分辨率。
 *
 * 必须按当前档比价：各模型支持的档位不一致，拿"所有档最低价"排序会得出相反结论
 * （官方 512 档 ¥0.15 比中转站 512 档便宜，但用户选的 2K 上中转站便宜 38%）。
 * 找不到就回 null，让后端把价格标成近似值，而不是假装精确。
 */
export function currentResolution(panel: HTMLElement): string | null {
  let scope: HTMLElement | null = panel.parentElement;
  while (scope && scope !== document.body) {
    for (const button of scope.querySelectorAll('button')) {
      if (panel.contains(button)) continue;
      const matched = RESOLUTION_PATTERN.exec(button.textContent?.trim() ?? '');
      if (matched) {
        const value = matched[1];
        return /p$/i.test(value) ? value.toLowerCase() : value.toUpperCase();
      }
    }
    scope = scope.parentElement;
  }
  return null;
}

/** 当前生成模式和分辨率一起决定视频价格；找不到时后端明确显示“请先选择生成模式”。 */
export function currentGenerationMode(panel: HTMLElement): string | null {
  const modeElement =
    panel.closest<HTMLElement>(
      '[data-fisherai-effective-image-mode], [data-fisherai-effective-video-mode]',
    ) ??
    panel
      .closest<HTMLElement>('[data-node-id]')
      ?.querySelector<HTMLElement>(
        '[data-fisherai-effective-image-mode], [data-fisherai-effective-video-mode]',
      );
  const effectiveImageMode = modeElement?.dataset.fisheraiEffectiveImageMode?.trim();
  if (effectiveImageMode) return effectiveImageMode;
  const effectiveVideoMode = modeElement?.dataset.fisheraiEffectiveVideoMode?.trim();
  if (effectiveVideoMode) return effectiveVideoMode;

  let scope: HTMLElement | null = panel.parentElement;
  while (scope && scope !== document.body) {
    for (const button of scope.querySelectorAll('button')) {
      if (panel.contains(button)) continue;
      const text = button.textContent?.trim() ?? '';
      const matched = MODE_PATTERNS.find(([pattern]) => pattern.test(text));
      if (matched) return matched[1];
    }
    scope = scope.parentElement;
  }
  return null;
}

/** Token 视频必须带当前比例，否则 1:1 与 16:9 的像素数不同，报价会漂。 */
export function currentAspectRatio(panel: HTMLElement): string | null {
  let scope: HTMLElement | null = panel.parentElement;
  while (scope && scope !== document.body) {
    for (const button of scope.querySelectorAll('button')) {
      if (panel.contains(button)) continue;
      const matched = ASPECT_RATIO_PATTERN.exec(button.textContent?.trim() ?? '');
      if (matched) return matched[1];
    }
    scope = scope.parentElement;
  }
  return null;
}

/** 当前时长用于把抽象的 ¥/秒或 token 单价换成用户真正关心的一次任务总价。 */
export function currentDuration(panel: HTMLElement): number | null {
  let scope: HTMLElement | null = panel.parentElement;
  while (scope && scope !== document.body) {
    for (const input of scope.querySelectorAll<HTMLInputElement>('input')) {
      if (panel.contains(input)) continue;
      const ownLabel = [input.name, input.id, input.getAttribute('aria-label')]
        .filter(Boolean)
        .join(' ');
      const context = `${ownLabel} ${input.closest('label')?.textContent ?? ''}`;
      if (!/(?:时长|duration)/i.test(context)) continue;
      const value = Number(input.value);
      if (Number.isFinite(value) && value > 0) return value;
    }
    // 稳定版节点把当前时长显示为 `span` （如 5s），不一定是按钮或 input。
    // 只读取当前节点附近的完整时长文本，避免把画布缩放 range 的 0.8 当成 0.8 秒。
    for (const element of scope.querySelectorAll<HTMLElement>('button, span, [role="button"]')) {
      if (panel.contains(element)) continue;
      const matched = DURATION_PATTERN.exec(element.textContent?.trim() ?? '');
      const value = Number(matched?.[1]);
      if (Number.isFinite(value) && value >= MIN_VIDEO_DURATION_SECONDS) return value;
    }
    scope = scope.parentElement;
  }
  return null;
}

/** Midjourney 的 Relax/Fast/Turbo 是独立价格档，不能拿最低档替代当前选项。 */
export function currentSpeed(panel: HTMLElement): string | null {
  let scope: HTMLElement | null = panel.parentElement;
  while (scope && scope !== document.body) {
    for (const button of scope.querySelectorAll<HTMLButtonElement>('button')) {
      if (panel.contains(button)) continue;
      const matched = SPEED_PATTERN.exec(button.textContent?.trim() ?? '');
      if (!matched) continue;
      const section = button.parentElement?.parentElement;
      if (!/(?:生成速度|speed)/i.test(section?.textContent ?? '')) continue;
      const selected =
        button.getAttribute('aria-pressed') === 'true' ||
        ((button.classList.contains('text-[var(--af-text)]') ||
          button.classList.contains('text-white')) &&
          button.className.includes('bg-'));
      if (selected) return matched[1].toLowerCase();
    }
    scope = scope.parentElement;
  }
  return null;
}

const PRICE_MINIMUM_DISCLAIMER = '（最低，以实际消耗为主）';

function withPriceMinimumDisclaimer(value: string) {
  if (!value.includes('¥') || value.includes(PRICE_MINIMUM_DISCLAIMER)) return value;
  return `${value}${PRICE_MINIMUM_DISCLAIMER}`;
}

/**
 * 金额和免责声明必须属于同一个语义节点，但不能占用同一条不可收缩的横向文本。
 * 模型选择器的品牌、版本和来源行都有固定宽度；把完整说明直接拼进 nowrap 摘要，
 * 会让右栏反向挤压型号名，最终出现逐字换行或两栏重叠。
 */
function priceStackElement(tag: keyof HTMLElementTagNameMap, value: string, className: string) {
  const disclaimerAt = value.indexOf(PRICE_MINIMUM_DISCLAIMER);
  if (disclaimerAt < 0) return textElement(tag, value, className);

  const container = textElement(tag, '', className);
  container.setAttribute('data-fisherai-price-stack', 'true');
  Object.assign(container.style, {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: '0',
  });

  const amount = textElement('span', value.slice(0, disclaimerAt), '');
  amount.style.whiteSpace = 'nowrap';
  const disclaimer = textElement('span', PRICE_MINIMUM_DISCLAIMER, '');
  disclaimer.setAttribute('data-fisherai-price-disclaimer', 'true');
  Object.assign(disclaimer.style, {
    color: 'var(--af-text-secondary)',
    fontSize: '9px',
    lineHeight: '11px',
    whiteSpace: 'nowrap',
  });
  container.append(amount, disclaimer);
  return container;
}

function priceText(variant: ModelVariant) {
  if (variant.priceRangeLabel) return withPriceMinimumDisclaimer(variant.priceRangeLabel);
  if (variant.priceLabel) return withPriceMinimumDisclaimer(variant.priceLabel);
  if (variant.price == null) {
    return withPriceMinimumDisclaimer(variant.priceNote ?? '价格未知');
  }
  return withPriceMinimumDisclaimer(`${variant.priceExact ? '' : '≈'}¥${variant.price}`);
}

function cheapest(group: ModelGroup) {
  const priced = group.variants.filter((variant) => variant.price != null);
  return priced.length ? Math.min(...priced.map((variant) => variant.price as number)) : null;
}

function cheapestVariant(group: ModelGroup) {
  return (
    group.variants
      .filter((variant) => variant.price != null)
      .sort((a, b) => (a.price as number) - (b.price as number))[0] ?? null
  );
}

function variantRow(
  variant: ModelVariant,
  select: () => void,
  isCurrent: boolean,
  isCheapest: boolean,
) {
  const configured = variant.configured;
  const row = document.createElement('button');
  row.type = 'button';
  row.setAttribute('data-fisherai-model-variant', variant.name);
  row.setAttribute('data-fisherai-source', variant.source);
  row.setAttribute('data-fisherai-configured', String(configured));
  row.setAttribute('aria-disabled', String(!configured));
  // 二级要一眼看出是"从属于上面那个模型"：更深的底、更小的字、更深的缩进。
  //
  // 缩进/边框一律写成内联样式，不用 Tailwind 类：稳定版的 CSS 是构建期按它自己的
  // 源码裁剪过的，`pl-7`/`ml-3`/`border-l-2` 这些它没用过的类在产物里压根没有规则，
  // 写上去计算值是 0，静默失效。只敢用产物里确实出现过的类（text-*、hover:bg-[var(--af-surface-raised)]）。
  row.className = `w-full flex items-center justify-between gap-3 pr-3 py-2 text-left text-xs transition-colors ${
    isCurrent
      ? 'text-[var(--af-text)]'
      : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)]'
  }`;
  row.style.paddingLeft = '14px';
  if (isCurrent) row.style.backgroundColor = 'var(--af-selected)';
  if (!configured) {
    row.disabled = true;
    row.title = '请先在设置中连接这个来源';
    row.style.cursor = 'not-allowed';
    row.style.opacity = '0.62';
  }

  const left = document.createElement('span');
  left.className = 'flex items-center gap-2 min-w-0';
  const label = textElement('span', variant.sourceLabel, '');
  label.style.whiteSpace = 'nowrap';
  left.append(label);

  if (!configured) {
    const badge = textElement('span', '未连接', '');
    Object.assign(badge.style, {
      flexShrink: '0',
      fontSize: '10px',
      lineHeight: '14px',
      padding: '0 5px',
      borderRadius: '4px',
      color: 'var(--af-text-secondary)',
      backgroundColor: 'var(--af-hover)',
    });
    badge.setAttribute('data-fisherai-unconfigured-badge', 'true');
    left.append(badge);
  }

  // 低价渠道便宜得反常（Grok / Nano Banana 1 都是一次 ¥0.07），
  // RH 自己的说明是「价格远低于官方稳定版，不稳定」。只写价格不写代价，
  // 等于引导用户去选一个会翻车的渠道。
  // 只有标准档需要这个牌子：同一个「AIFISHER API」会出现两条、价格差一倍，
  // 不标一下分不出哪条是贵的。低价档自己的标签里已经写着「低价」并挂着
  // 「不保证质量」，再加一个只会更吵。
  if (variant.premium && variant.tier !== 'budget') {
    const badge = textElement('span', '可选渠道', '');
    Object.assign(badge.style, {
      flexShrink: '0',
      fontSize: '10px',
      lineHeight: '14px',
      padding: '0 5px',
      borderRadius: '4px',
      color: 'var(--af-text-secondary)',
      backgroundColor: 'var(--af-hover)',
    });
    badge.setAttribute('data-fisherai-premium-badge', 'true');
    left.append(badge);
  }

  if (variant.tier === 'budget') {
    const caveat = textElement('span', '不保证质量', '');
    Object.assign(caveat.style, {
      flexShrink: '0',
      fontSize: '10px',
      lineHeight: '14px',
      padding: '0 5px',
      borderRadius: '4px',
      color: 'var(--af-warning)',
      backgroundColor: 'var(--af-warning-bg)',
    });
    caveat.setAttribute('data-fisherai-budget-caveat', 'true');
    left.append(caveat);
  }

  // 最便宜的那个标出来——二级存在的意义就是比价，让眼睛不用逐行读数字。
  const price = priceStackElement(
    'span',
    priceText(variant),
    isCheapest ? 'text-[var(--af-success)] font-semibold' : 'text-[var(--af-text-muted)]',
  );
  price.style.flexShrink = '0';
  if (isCheapest) price.title = '当前分辨率下最便宜的来源';
  if (!variant.priceExact && variant.price != null) {
    price.title = variant.priceNote ?? '近似价格，最终以任务账单为准';
  }
  const activePromotion =
    variant.promotionLabel && Date.now() < Date.parse(variant.promotionEndsAt || '');
  if (
    variant.discountPercent != null &&
    variant.discountPercent > 0 &&
    (!variant.promotionLabel || activePromotion)
  ) {
    const discount = textElement(
      'span',
      activePromotion ? variant.promotionLabel! : `-${variant.discountPercent}%`,
      '',
    );
    if (activePromotion) discount.title = variant.priceNote ?? '发布限时优惠';
    Object.assign(discount.style, {
      marginLeft: '6px',
      color: 'var(--af-success)',
      fontSize: '10px',
      fontWeight: '700',
      whiteSpace: 'nowrap',
    });
    price.append(discount);
  }

  row.append(left, price);
  row.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (configured) select();
  });
  return row;
}

function chevronElement(visible: boolean) {
  const chevron = textElement('span', visible ? '›' : '', 'text-[var(--af-text-muted)]');
  Object.assign(chevron.style, {
    flexShrink: '0',
    width: '10px',
    display: 'inline-block',
    transition: 'transform 150ms',
  });
  return chevron;
}

/** 版本行上那排「文生视频 / 首尾帧 / 视频编辑」小标签，也是顶部筛选的同一套取值。 */
function capabilityChips(capabilities: string[]) {
  const row = document.createElement('span');
  row.setAttribute('data-fisherai-capabilities', capabilities.join(','));
  Object.assign(row.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginTop: '4px',
  });
  for (const label of capabilities) {
    const chip = textElement('span', label, '');
    Object.assign(chip.style, {
      fontSize: '10px',
      lineHeight: '15px',
      padding: '0 5px',
      borderRadius: '4px',
      color: 'var(--af-text-secondary)',
      backgroundColor: 'var(--af-hover)',
    });
    row.append(chip);
  }
  return row;
}

/**
 * 二级：一个版本。右侧写「N 个来源 · 最低 ¥x」，来源在第三级飞出层里。
 *
 * 价格留在这一行是刻意的：用户挑版本时最想知道的就是"这档大概多少钱"，
 * 要再飞出一层才看得到价，等于每个版本都得划过去一遍才能比。
 */
function versionRow(
  group: ModelGroup,
  currentName: string,
  select: (variant: ModelVariant) => void,
  onOpenSources: (group: ModelGroup, header: HTMLElement) => void,
) {
  const header = document.createElement('button');
  header.type = 'button';
  header.setAttribute('data-fisherai-model-header', group.canonicalModel);
  header.setAttribute('data-fisherai-model-group', group.canonicalModel);
  const holdsCurrent = group.variants.some((variant) => variant.name === currentName);
  header.className = `w-full flex items-start px-3 py-2 text-left transition-colors ${
    holdsCurrent
      ? 'bg-[var(--af-surface-raised)] text-[var(--af-text)]'
      : 'text-[var(--af-text)] hover:bg-[var(--af-surface-raised)]'
  }`;

  const title = document.createElement('span');
  Object.assign(title.style, {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: '0',
  });
  const line = document.createElement('span');
  line.className = 'flex items-center gap-1.5 min-w-0';
  line.style.whiteSpace = 'nowrap';
  const chevron = chevronElement(group.variants.length > 1);
  // 型号名必须完整并保持一行；飞出层专门加宽来容纳长型号和右侧来源/价格摘要。
  const name = textElement('span', group.canonicalModel, 'text-sm font-medium');
  name.setAttribute('data-fisherai-model-name', group.canonicalModel);
  Object.assign(name.style, { flexShrink: '0', whiteSpace: 'nowrap', wordBreak: 'normal' });
  line.append(chevron, name);
  title.append(line);
  if (group.capabilities.length) title.append(capabilityChips(group.capabilities));

  const low = cheapestVariant(group);
  const configuredCount = group.variants.filter((variant) => variant.configured).length;
  const connectionSummary = configuredCount === 0 ? ' · 未连接' : '';
  const summary =
    group.variants.length > 1
      ? `${group.variants.length} 个来源${connectionSummary}${low == null ? '' : ` · 最低 ${priceText(low)}`}`
      : `${group.variants[0].sourceLabel}${connectionSummary} · ${priceText(group.variants[0])}`;
  const summaryElement = priceStackElement(
    'span',
    summary,
    'text-[11px] text-[var(--af-text-muted)] tabular-nums',
  );
  summaryElement.setAttribute('data-fisherai-model-version-summary', 'true');
  Object.assign(summaryElement.style, {
    alignItems: 'flex-start',
    marginTop: '3px',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
  title.append(summaryElement);
  header.append(title);

  // 只有一个来源就没有"从哪买"可选，点一下直接选中，不让用户白点第二次。
  if (group.variants.length === 1) {
    if (!group.variants[0].configured) {
      header.disabled = true;
      header.setAttribute('aria-disabled', 'true');
      header.title = '请先在设置中连接这个来源';
      header.style.cursor = 'not-allowed';
      header.style.opacity = '0.7';
      return header;
    }
    header.addEventListener('mouseenter', () => onOpenSources(group, header));
    header.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      select(group.variants[0]);
    });
    return header;
  }

  const open = () => onOpenSources(group, header);
  header.addEventListener('mouseenter', open);
  header.addEventListener('focus', open);
  header.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  return header;
}

/** 三级：这个版本能从哪几个站买、各多少钱。 */
function sourceList(
  group: ModelGroup,
  currentName: string,
  select: (variant: ModelVariant) => void,
) {
  const content = document.createDocumentFragment();
  const low = cheapest(group);
  for (const variant of group.variants) {
    content.append(
      variantRow(
        variant,
        () => select(variant),
        variant.name === currentName,
        low != null && variant.price === low,
      ),
    );
  }
  return content;
}

/** 飞出层给完整型号名和右侧价格摘要留足同一行空间。 */
const FLYOUT_WIDTH = 384;
const FLYOUT_GAP = 6;
const VIEWPORT_MARGIN = 12;

/**
 * 一级：一个品牌。版本不在这儿展开，鼠标移上去在右边飞出。
 *
 * 为什么不做成就地展开的手风琴：一级列表会随着展开/收起上下跳，
 * 想对比两个品牌得反复滚；飞出式的左栏始终不动，右栏专心显示版本。
 */
function brandRow(
  brand: string,
  groups: ModelGroup[],
  currentName: string,
  onOpen: (brand: string, groups: ModelGroup[], header: HTMLElement) => void,
) {
  const holdsCurrent = groups.some((group) => group.variants.some((v) => v.name === currentName));
  const header = document.createElement('button');
  header.type = 'button';
  header.setAttribute('data-fisherai-model-brand-header', brand);
  header.className = `w-full px-3 py-2.5 text-left transition-colors ${
    holdsCurrent
      ? 'bg-[var(--af-surface-raised)] text-[var(--af-text)]'
      : 'text-[var(--af-text)] hover:bg-[var(--af-surface-raised)]'
  }`;

  const title = document.createElement('span');
  title.className = 'flex min-w-0 items-center justify-between gap-2';
  Object.assign(title.style, { display: 'flex', minWidth: '0', width: '100%' });
  const name = textElement('span', brand, 'text-sm font-medium');
  name.setAttribute('data-fisherai-model-brand-name', brand);
  Object.assign(name.style, {
    flexShrink: '0',
    whiteSpace: 'nowrap',
    wordBreak: 'normal',
  });
  title.append(name, textElement('span', '›', 'shrink-0 text-[var(--af-text-muted)]'));

  const pricedVariants = groups
    .flatMap((group) => group.variants)
    .filter((variant) => variant.price != null)
    .sort((left, right) => (left.price as number) - (right.price as number));
  const cheapestSource = pricedVariants[0] ?? null;
  const hasConfiguredSource = groups.some((group) =>
    group.variants.some((variant) => variant.configured),
  );
  const low = cheapestSource?.price ?? null;
  const lowRange =
    low == null
      ? null
      : cheapestSource?.priceMaximum != null
        ? `¥${low}–¥${cheapestSource.priceMaximum}`
        : `¥${low}`;
  const count = groups.length > 1 ? `${groups.length} 个版本` : groups[0].canonicalModel;
  const meta = document.createElement('span');
  meta.className =
    'flex min-w-0 items-center justify-between gap-2 text-[11px] text-[var(--af-text-muted)] tabular-nums';
  Object.assign(meta.style, { display: 'flex', marginTop: '3px', minWidth: '0', width: '100%' });
  const detail = textElement(
    'span',
    `${count}${hasConfiguredSource ? '' : ' · 未连接'}`,
    'min-w-0',
  );
  detail.setAttribute('data-fisherai-model-brand-detail', 'true');
  Object.assign(detail.style, {
    flex: '1',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
  meta.append(detail);
  if (lowRange != null) {
    const price = priceStackElement(
      'span',
      `最低 ${withPriceMinimumDisclaimer(lowRange)}`,
      'shrink-0',
    );
    price.setAttribute('data-fisherai-model-brand-price', 'true');
    meta.append(price);
  }
  header.append(title, meta);

  const open = () => onOpen(brand, groups, header);
  // 悬停就出，和图 3 一样；点击也留着，键盘和触屏没有 hover。
  header.addEventListener('mouseenter', open);
  header.addEventListener('focus', open);
  header.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  return header;
}

/**
 * 右侧飞出层。
 *
 * **必须挂在下拉面板的外面**：稳定版那个面板是
 * `absolute … max-h-80 overflow-y-auto overflow-hidden`，
 * 既会滚也会裁，飞出层挂在里面会被切掉半截、还跟着一起滚。
 * 它的父级 `div.relative` 不滚不裁，正好当定位祖先——
 * 而且它就是稳定版判定「点外面就关下拉」的那个容器，
 * 挂在里面点飞出层才不会把下拉关掉。
 */
function createFlyout(host: HTMLElement, zIndex: number) {
  const flyout = host.ownerDocument.createElement('div');
  flyout.setAttribute('data-fisherai-model-picker-flyout', 'true');
  Object.assign(flyout.style, {
    position: 'absolute',
    width: `${FLYOUT_WIDTH}px`,
    maxHeight: '320px',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '6px 0',
    borderRadius: '8px',
    border: '1px solid var(--af-border)',
    backgroundColor: 'var(--af-surface-raised)',
    boxShadow: 'var(--af-shadow)',
    zIndex: String(zIndex),
    display: 'none',
  });
  host.append(flyout);
  return flyout;
}

/**
 * 把飞出层贴在它的锚（上一层面板）右边，纵向对齐悬停那一行。
 * 两层飞出共用：二级的锚是下拉面板，三级的锚是二级飞出层。
 */
function placeFlyout(flyout: HTMLElement, anchor: HTMLElement, row: HTMLElement) {
  // 右边放不下就翻到左边。画布上的节点常常贴着窗口右缘，不翻就只剩一条缝。
  const box = anchor.getBoundingClientRect();
  const view = anchor.ownerDocument.defaultView;
  const toLeft = (view?.innerWidth ?? 0) - box.right < FLYOUT_WIDTH + VIEWPORT_MARGIN;
  flyout.style.left = toLeft
    ? `${anchor.offsetLeft - FLYOUT_WIDTH - FLYOUT_GAP}px`
    : `${anchor.offsetLeft + anchor.offsetWidth + FLYOUT_GAP}px`;
  // 顶部跟着悬停的那一行走，但夹在锚的范围内，免得飞到画布外面去。
  const raw = anchor.offsetTop + row.offsetTop - anchor.scrollTop;
  const max = anchor.offsetTop + anchor.offsetHeight - 60;
  flyout.style.top = `${Math.max(anchor.offsetTop, Math.min(raw, max))}px`;
  flyout.style.display = '';
}

/**
 * 三级来源菜单永远贴在二级版本菜单右边。
 *
 * 以前复用了 placeFlyout：右侧空间不足时三级会整块翻到最左边，视觉上像和二级断开。
 * 这里把二、三级当成一组；放不下时整体左移二级，再把三级固定接在它右侧。
 */
function placeSourceFlyout(flyout: HTMLElement, versionFlyout: HTMLElement, row: HTMLElement) {
  const view = versionFlyout.ownerDocument.defaultView;
  const box = versionFlyout.getBoundingClientRect();
  const hostBox = versionFlyout.parentElement?.getBoundingClientRect();
  const screenWidth = box.width > 0 ? box.width : FLYOUT_WIDTH;
  const scale = screenWidth / FLYOUT_WIDTH || 1;
  const viewportWidth = view?.innerWidth ?? box.right + screenWidth;
  const desiredRight = box.right + FLYOUT_GAP * scale + screenWidth;
  const overflow = Math.max(0, desiredRight - (viewportWidth - VIEWPORT_MARGIN));
  const parsedLeft = Number.parseFloat(versionFlyout.style.left);
  let versionLeft = Number.isFinite(parsedLeft) ? parsedLeft : versionFlyout.offsetLeft;

  if (overflow > 0) {
    const minimumLeft = hostBox ? (VIEWPORT_MARGIN - hostBox.left) / scale : 0;
    versionLeft = Math.max(minimumLeft, versionLeft - overflow / scale);
    versionFlyout.style.left = `${versionLeft}px`;
  }

  flyout.style.left = `${versionLeft + FLYOUT_WIDTH + FLYOUT_GAP}px`;
  const raw = versionFlyout.offsetTop + row.offsetTop - versionFlyout.scrollTop;
  const max = versionFlyout.offsetTop + versionFlyout.offsetHeight - 60;
  flyout.style.top = `${Math.max(versionFlyout.offsetTop, Math.min(raw, max))}px`;
  flyout.style.display = '';
  flyout.setAttribute('data-fisherai-flyout-side', 'right');
}

/**
 * 列表末尾那一行开关。
 *
 * 放末尾而不是开头：它是"还想看更多"的出口，不该在每次开下拉时先挡住模型。
 * 关着的时候顺带说清楚被收起来的是什么，否则用户只会觉得模型莫名其妙少了。
 */
function premiumToggle(on: boolean, onChange: (next: boolean) => void) {
  const row = document.createElement('button');
  row.type = 'button';
  row.setAttribute('data-fisherai-premium-toggle', on ? 'on' : 'off');
  row.setAttribute('role', 'switch');
  row.setAttribute('aria-checked', String(on));
  row.className =
    'w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-xs text-[var(--af-text-secondary)] hover:bg-[var(--af-surface-raised)] transition-colors';
  // 结构性样式一律内联：稳定版没用过的 Tailwind 类在产物里被裁掉了，写了也是 0。
  Object.assign(row.style, {
    marginTop: '4px',
    borderTop: '1px solid var(--af-border)',
  });

  const label = textElement('span', '更多渠道', '');
  label.style.whiteSpace = 'nowrap';

  const state = textElement('span', on ? '已开启' : '已隐藏', '');
  Object.assign(state.style, {
    flexShrink: '0',
    fontSize: '10px',
    lineHeight: '16px',
    padding: '0 6px',
    borderRadius: '9999px',
    color: on ? 'var(--af-info)' : 'var(--af-text-muted)',
    backgroundColor: on ? 'var(--af-info-bg)' : 'var(--af-hover)',
  });

  row.title = on
    ? '关掉后每个模型只留主推的那几条渠道'
    : '低价渠道和同站更贵的官方档已收起，点开显示';
  row.append(label, state);
  row.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onChange(!on);
  });
  return row;
}

export interface ModelPickerBinding {
  names: string[];
  currentName: string;
  onSelect(name: string): void;
}
export function mountModelPicker(
  panel: HTMLElement,
  client: Pick<SourceSettingsClient, 'getModelGroups'>,
  binding: ModelPickerBinding,
  filterGroups: ModelGroupFilter = filterCanvasModelGroups,
) {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  panel.setAttribute(PANEL_ATTRIBUTE, 'true');
  // 稳定版节点的原生下拉偏窄；品牌与价格摘要至少需要这一列宽才能保持横排。
  panel.style.minWidth = '280px';
  const byName = new Set(binding.names);
  const order = new Map(binding.names.map((name, index) => [name, index]));
  const resolution = currentResolution(panel);
  const mode = currentGenerationMode(panel);
  const aspectRatio = currentAspectRatio(panel);
  const duration = currentDuration(panel);
  const currentName = binding.currentName;
  // Fast 是目录声明的 Midjourney 默认值；高级设置已打开时以上面的真实选中值为准。
  const speed = currentSpeed(panel) ?? (currentName === 'Midjourney Imagine · API' ? 'fast' : null);
  const pricingContext = {
    aspectRatio,
    duration,
    ...(speed ? { speed } : {}),
  };
  const pricingBridge = installStableModelPricingBridge();

  const list = document.createElement('div');
  list.setAttribute('data-fisherai-model-list', 'true');
  const loading = textElement('div', '正在加载模型目录…', '');
  loading.setAttribute('data-fisherai-model-loading', 'true');
  Object.assign(loading.style, {
    padding: '12px 16px',
    color: 'var(--af-text-secondary)',
    fontSize: '13px',
    lineHeight: '20px',
    whiteSpace: 'nowrap',
  });
  list.append(loading);
  panel.prepend(list);

  void client
    .getModelGroups(resolution, mode, pricingContext)
    .then((groups) => {
      if (disposed) return;
      pricingBridge.remember(groups, resolution, mode, pricingContext);
      const selectableGroups = filterGroups(groups);
      const select = (variant: ModelVariant) => {
        if (!disposed && byName.has(variant.name)) binding.onSelect(variant.name);
      };

      // 四道过滤：
      // 1) 产品边界只留用户确认的常用模型；完整运行目录仍供旧画布兼容。
      // 2) 这个下拉只列本类模型（图片节点没有视频模型），按名字取交集；
      // 3) 只显示已经连接的来源；没填 API 的模型不占用创作下拉空间。
      // 4) 官方高价版默认收起来，见 applyPremiumFilter。
      const visibleGroups = (showPremium: boolean) =>
        selectableGroups
          .map((group) => ({
            ...group,
            variants: applyPremiumFilter(
              group.variants.filter((variant) => variant.configured && byName.has(variant.name)),
              showPremium,
            ),
          }))
          .filter((group) => group.variants.length > 0)
          .sort(
            (a, b) => (order.get(a.variants[0].name) ?? 0) - (order.get(b.variants[0].name) ?? 0),
          );

      if (!visibleGroups(true).length) {
        loading.textContent = '请先在设置中连接模型来源。';
        loading.setAttribute('data-fisherai-model-empty', 'true');
        return;
      }

      const host = panel.parentElement;
      // 两层飞出：二级列版本，三级列来源。都挂在下拉面板**外面**——
      // 面板是 `absolute … max-h-80 overflow-y-auto overflow-hidden`，
      // 既会滚也会裁，挂在里面会被切掉半截、还跟着一起滚。
      // 它父级 `div.relative` 不滚不裁，而且正是稳定版判定「点外面就关下拉」的容器，
      // 挂在里面点飞出层才不会顺手把下拉关掉。
      const versionFlyout = host ? createFlyout(host, 60) : null;
      const sourceFlyout = host ? createFlyout(host, 61) : null;

      const closeSources = () => {
        if (sourceFlyout) sourceFlyout.style.display = 'none';
      };
      const closeAll = () => {
        closeSources();
        if (versionFlyout) versionFlyout.style.display = 'none';
      };

      const openSources = (group: ModelGroup, header: HTMLElement) => {
        if (!sourceFlyout || !versionFlyout) return;
        if (group.variants.length === 1) {
          closeSources();
          return;
        }
        sourceFlyout.setAttribute('data-fisherai-model-sources', group.canonicalModel);
        sourceFlyout.replaceChildren(
          sourceList(group, currentName, (variant) => {
            closeAll();
            select(variant);
          }),
        );
        sourceFlyout.scrollTop = 0;
        placeSourceFlyout(sourceFlyout, versionFlyout, header);
      };

      const openVersions = (brand: string, versions: ModelGroup[], header: HTMLElement) => {
        if (!versionFlyout) return;
        closeSources();
        versionFlyout.setAttribute('data-fisherai-model-flyout', brand);
        const content = document.createDocumentFragment();
        for (const group of versions) {
          content.append(
            versionRow(
              group,
              currentName,
              (variant) => {
                closeAll();
                select(variant);
              },
              openSources,
            ),
          );
        }
        versionFlyout.replaceChildren(content);
        versionFlyout.scrollTop = 0;
        placeFlyout(versionFlyout, panel, header);
      };

      // 鼠标离开三栏才收，中间那 6px 缝隙不算离开。
      let leaveTimer: number | undefined;
      const view = panel.ownerDocument.defaultView;
      const scheduleClose = () => {
        if (leaveTimer != null) view?.clearTimeout(leaveTimer);
        leaveTimer = view?.setTimeout(closeAll, 260);
      };
      const cancelClose = () => {
        if (leaveTimer != null) view?.clearTimeout(leaveTimer);
      };
      for (const layer of [panel, versionFlyout, sourceFlyout]) {
        layer?.addEventListener('mouseleave', scheduleClose);
        layer?.addEventListener('mouseenter', cancelClose);
        cleanups.push(() => {
          layer?.removeEventListener('mouseleave', scheduleClose);
          layer?.removeEventListener('mouseenter', cancelClose);
        });
      }
      cleanups.push(() => {
        cancelClose();
        versionFlyout?.remove();
        sourceFlyout?.remove();
      });

      // 开关只改显示，不用重新请求接口——价格和可用性都没变。
      const render = () => {
        closeAll();
        const showPremium = premiumEnabled();
        const shown = visibleGroups(showPremium);

        const content = document.createDocumentFragment();
        // 按品牌折叠。visibleGroups 已按稳定版原列表排过序，Map 保持插入顺序，
        // 所以品牌的先后跟着它走，不另造一套排序。
        const byBrand = new Map<string, ModelGroup[]>();
        for (const group of shown) {
          const list_ = byBrand.get(group.brand) ?? [];
          list_.push(group);
          byBrand.set(group.brand, list_);
        }
        for (const [brand, versions] of byBrand) {
          content.append(brandRow(brand, versions, currentName, openVersions));
        }
        content.append(
          premiumToggle(showPremium, (next) => {
            setPremiumEnabled(next);
            render();
          }),
        );
        list.replaceChildren(content);
      };
      render();
    })
    .catch(() => {
      if (disposed) return;
      loading.textContent = '模型来源暂不可用，请稍后重试。';
      loading.setAttribute('data-fisherai-model-error', 'true');
    });
  return () => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
    list.remove();
    panel.removeAttribute(PANEL_ATTRIBUTE);
  };
}

export function installModelPricing(client: SourceSettingsClient): void {
  installStableModelPricingBridge().setLoader((resolution, mode, context) =>
    client.getModelGroups(resolution, mode, context),
  );
}
