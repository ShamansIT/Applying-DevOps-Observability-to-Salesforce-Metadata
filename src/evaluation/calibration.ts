// Ranking calibration. Confidence state is rule-based, so weights never move a pass-or-fail metric:
// tuning weights on evaluation outcome would be both self-confirming and inert. Weights
// affect ranking only, so calibration has one honest job - pick the weight set whose evidence score
// best orders the output, ranking confirmed above inferred above unresolved. It reads reconstruction
// state and score, never ground truth, and runs on validation scenarios held out from evaluation.
// Deterministic: concordance is deterministic, ties break by candidate order. Pure.

import { reconstruct } from '../core/index.js';
import type {
  ConfidenceState,
  PhaseModel,
  ReconstructResult,
  SourceResolver,
  WeightModel,
} from '../core/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';
import type { Scenario } from './scenario.js';

// Validation case for ranking calibration: no ground truth, since calibration never scores against
// truth. Must be held out from the evaluation scenario set by the caller.
export interface RankingCase {
  scenario: Scenario;
  snapshot: OrgSnapshot;
}

export interface CandidateScore {
  index: number;
  concordance: number; // share of tier-ordered pairs the score ranks the right way
}

export interface CalibrationResult {
  best: WeightModel;
  bestIndex: number;
  bestConcordance: number;
  ranking: CandidateScore[]; // by candidate order, concordance each
}

const TIER: Record<Exclude<ConfidenceState, 'excluded'>, number> = {
  confirmed: 3,
  inferred: 2,
  unresolved: 1,
};

const snapshotSource: SourceResolver = (component) => component.source;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Concordance between confidence tier and score across one reconstruction. Over every pair whose
// tiers differ, count the pairs whose score ranks the higher tier at least as high. Excluded elements
// carry no claim, so they are left out. No ordered pair means nothing to rank: concordance is 1.
function concordanceOf(result: ReconstructResult): number {
  const ranked = [...result.nodes, ...result.edges]
    .filter((element) => element.state !== 'excluded')
    .map((element) => ({
      tier: TIER[element.state as Exclude<ConfidenceState, 'excluded'>],
      score: element.score,
    }));

  let pairs = 0;
  let concordant = 0;
  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      const a = ranked[i];
      const b = ranked[j];
      if (!a || !b || a.tier === b.tier) {
        continue;
      }
      pairs += 1;
      const higher = a.tier > b.tier ? a : b;
      const lower = a.tier > b.tier ? b : a;
      if (higher.score >= lower.score) {
        concordant += 1;
      }
    }
  }
  return pairs === 0 ? 1 : concordant / pairs;
}

function meanConcordance(cases: RankingCase[], model: PhaseModel, weights: WeightModel): number {
  const values = cases.map((item) => {
    const result = reconstruct(
      item.snapshot,
      { object: item.scenario.object, event: item.scenario.event },
      model,
      {
        weights,
        sourceResolver: snapshotSource,
        depthLimit: item.scenario.depthLimit,
        ...(item.snapshot.dependencies
          ? { dependencies: { records: item.snapshot.dependencies } }
          : {}),
      },
    );
    return concordanceOf(result);
  });
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Evaluate each candidate over all validation cases, pick highest mean concordance. Empty cases or
// candidates is error - calibration needs both.
export function rankingCalibrate(
  cases: RankingCase[],
  candidates: WeightModel[],
  model: PhaseModel,
): CalibrationResult {
  if (cases.length === 0 || candidates.length === 0) {
    throw new Error('rankingCalibrate: needs at least one case and one candidate');
  }

  const ranking: CandidateScore[] = candidates.map((weights, index) => ({
    index,
    concordance: round(meanConcordance(cases, model, weights)),
  }));

  let bestIndex = 0;
  for (let i = 1; i < ranking.length; i += 1) {
    if ((ranking[i]?.concordance ?? 0) > (ranking[bestIndex]?.concordance ?? 0)) {
      bestIndex = i;
    }
  }

  return {
    best: candidates[bestIndex] as WeightModel,
    bestIndex,
    bestConcordance: ranking[bestIndex]?.concordance ?? 0,
    ranking,
  };
}
