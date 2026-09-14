import baselines from '../config/relayRetailBaselines.json' with { type: 'json' };
import { endpointForMode } from './relayPricing.js';

// Billing stays on the relay. Only historical canvas estimates need conversion:
// current estimate = historical estimate × live retail ratio / historical ratio.
export function relayRetailAdjustment(model, snapshot, mode) {
  if (model.source !== 'relay' || model.customModelId || !Array.isArray(snapshot?.data)) return null;
  const id = endpointForMode(model, mode)?.model;
  const reference = baselines.models[id];
  const live = snapshot.data.find(entry => entry.model_name === id);
  if (!reference || !live || !Number.isFinite(live.model_ratio) || live.model_ratio <= 0
    || (live.quota_type != null && live.quota_type !== reference.quotaType)) return null;
  return { factor: live.model_ratio / reference.ratio, referenceRatio: reference.ratio };
}
