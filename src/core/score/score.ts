// Scoring and confidence finalisation. Score is sum of weights of present evidence, clamped to
// [0, 1], and drives ranking only - it never selects state. State is assigned by extraction and
// scope rules that create node or edge; finalisation keeps that state, with scope exclusion first
// and no-evidence falling to unresolved. Pure.

import type { ConfidenceState, Evidence } from '../types.js';
import type { WeightModel } from './weights.js';

// Sum evidence weights, clamped to [0, 1]. Ranking signal only. Unknown type contributes nothing.
export function scoreEvidence(evidence: Evidence[], weights: WeightModel): number {
  let total = 0;
  for (const item of evidence) {
    total += weights.evidenceWeights[item.type] ?? 0;
  }
  return Math.min(1, Math.max(0, total));
}

// Rank of each non-excluded state, so deduplication and merge keep strongest.
const STATE_RANK: Record<Exclude<ConfidenceState, 'excluded'>, number> = {
  confirmed: 3,
  inferred: 2,
  unresolved: 1,
};

// Strongest of two non-excluded states. Excluded is handled by scope, not here.
export function strongerState(
  a: Exclude<ConfidenceState, 'excluded'>,
  b: Exclude<ConfidenceState, 'excluded'>,
): Exclude<ConfidenceState, 'excluded'> {
  return STATE_RANK[a] >= STATE_RANK[b] ? a : b;
}

// Finalise confidence for one node or edge. Scope exclusion wins first; claim with no evidence is
// unresolved; otherwise state assigned at creation is kept. State is never derived from score.
export function finaliseConfidence(
  assigned: ConfidenceState,
  evidence: Evidence[],
  excludeReason?: string,
): ConfidenceState {
  if (typeof excludeReason === 'string' && excludeReason.trim().length > 0) {
    return 'excluded';
  }
  if (evidence.length === 0) {
    return 'unresolved';
  }
  return assigned === 'excluded' ? 'unresolved' : assigned;
}
