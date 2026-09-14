// User-approved launch offer. The live retail ratio must confirm the offer;
// this module never changes billing or applies a second discount to live quotes.
import { endpointForMode } from './relayPricing.js';
import { relayRetailAdjustment } from './relayRetailAdjustment.js';

export const RELAY_LAUNCH_OFFER = Object.freeze({
  startsAt: '2026-09-11T00:00:00+08:00',
  endsAt: '2026-09-19T00:00:00+08:00',
});

const RULES = [
  [/^seedance-2\.0-(?:global-)?mini-(?:t2v|i2v|multi)$/, 0.5],
  [/^seedance-2\.0-(?:global-)?fast-(?:t2v|i2v|multi)$/, 0.85],
  [/^seedance-2\.[05]-standard-(?:t2v|i2v|multi)$/, 0.9],
  [/^seedance-2\.[05]-global-standard-(?:t2v|i2v|multi)$/, 0.95],
  [/^workfisher-image-g-v2\.5-(?:lowprice|flare|sunburst)$/, 0.9],
];

export function relayPromotionFor(model, snapshot, mode, now = Date.now()) {
  if (model.source !== 'relay' || model.customModelId || !Number.isFinite(now)
    || now < Date.parse(RELAY_LAUNCH_OFFER.startsAt)
    || now >= Date.parse(RELAY_LAUNCH_OFFER.endsAt)) return null;
  const modelId = endpointForMode(model, mode)?.model;
  const rule = RULES.find(([pattern]) => pattern.test(modelId || ''));
  if (!rule || !Array.isArray(snapshot?.data)) return null;
  const [, factor] = rule;
  const adjustment = relayRetailAdjustment(model, snapshot, mode);
  // A lower current markup also reduces the live ratio. Do not pin the offer
  // to a duplicated global markup; the relay owns that editable number.
  if (!adjustment || adjustment.factor > factor + 1e-8) return null;
  return {
    factor,
    label: `限时 ${Number((factor * 10).toFixed(1))} 折`,
    endsAt: RELAY_LAUNCH_OFFER.endsAt,
    note: '发布优惠至 9 月 18 日（北京时间）；最终以本次任务账单为准',
  };
}
