// Scoring and state resolution. Score is sum of weights of present evidence, clamped to [0, 1].
// Thresholds turn score into state. Scope exclusion wins over any score: node deliberately out of
// scope stays excluded no matter how strong its evidence. Weights and thresholds come from loaded
// model, never hand-set here, or metrics become self-confirming. Pure.

import type { ConfidenceState, Evidence } from '../types.js';
import type { WeightModel } from './weights.js';

// Sum evidence weights, clamped to [0, 1]. Unknown evidence type contributes nothing.
export function scoreEvidence(evidence: Evidence[], weights: WeightModel): number {
  let total = 0;
  for (const item of evidence) {
    total += weights.evidenceWeights[item.type] ?? 0;
  }
  return Math.min(1, Math.max(0, total));
}

// Resolve state from score and scope. Exclusion is decided before any threshold: excludeReason set
// means excluded, whatever score. Otherwise score at or above confirmed threshold is confirmed,
// at or above inferred threshold is inferred, else unresolved.
export function resolveState(
  score: number,
  weights: WeightModel,
  excludeReason?: string,
): ConfidenceState {
  if (typeof excludeReason === 'string' && excludeReason.trim().length > 0) {
    return 'excluded';
  }
  if (score >= weights.thresholds.confirmed) {
    return 'confirmed';
  }
  if (score >= weights.thresholds.inferred) {
    return 'inferred';
  }
  return 'unresolved';
}
