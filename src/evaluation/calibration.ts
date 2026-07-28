// Calibration. Searches weight and threshold candidates on pilot subset and picks set with
// best mean F1, so scoring is fit to data rather than hand-set - hand-setting would make chapter-5
// metrics self-confirming. Deterministic: F1 is deterministic, ties break by candidate order. Pure.

import type { PhaseModel, WeightModel } from '../core/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';
import { runScenario } from './runScenario.js';
import type { GroundTruth } from './groundTruth.js';
import type { Scenario } from './scenario.js';

export interface CalibrationCase {
  scenario: Scenario;
  snapshot: OrgSnapshot;
  truth: GroundTruth;
}

export interface CandidateScore {
  index: number;
  meanF1: number;
}

export interface CalibrationResult {
  best: WeightModel;
  bestIndex: number;
  bestMeanF1: number;
  ranking: CandidateScore[]; // by candidate order, mean F1 each
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Evaluate each candidate over all cases, pick highest mean F1. Empty cases or candidates is
// error - calibration needs both.
export function calibrate(
  cases: CalibrationCase[],
  candidates: WeightModel[],
  model: PhaseModel,
): CalibrationResult {
  if (cases.length === 0 || candidates.length === 0) {
    throw new Error('calibrate: needs at least one case and one candidate');
  }

  const ranking: CandidateScore[] = candidates.map((weights, index) => {
    const f1s = cases.map(
      (item) => runScenario(item.scenario, item.snapshot, item.truth, model, weights).metrics.f1,
    );
    const meanF1 = f1s.reduce((sum, value) => sum + value, 0) / f1s.length;
    return { index, meanF1: round(meanF1) };
  });

  let bestIndex = 0;
  for (let i = 1; i < ranking.length; i += 1) {
    if ((ranking[i]?.meanF1 ?? 0) > (ranking[bestIndex]?.meanF1 ?? 0)) {
      bestIndex = i;
    }
  }

  return {
    best: candidates[bestIndex] as WeightModel,
    bestIndex,
    bestMeanF1: ranking[bestIndex]?.meanF1 ?? 0,
    ranking,
  };
}
