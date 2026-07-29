import { describe, expect, it } from 'vitest';
import { finaliseConfidence, scoreEvidence } from '../../../src/core/score/score.js';
import type { WeightModel } from '../../../src/core/score/index.js';
import type { ConfidenceState, Evidence, EvidenceType } from '../../../src/core/types.js';

// Fixed model so ranking-score expectations are explicit and independent of config values.
const WEIGHTS: WeightModel = {
  provisional: true,
  evidenceWeights: {
    dependency_api: 0.9,
    object_binding: 0.7,
    flow_xml_static: 0.6,
    apex_static: 0.6,
    config_link: 0.5,
    heuristic: 0.2,
  },
  thresholds: { confirmed: 0.8, inferred: 0.4 },
};

function ev(types: EvidenceType[]): Evidence[] {
  return types.map((type) => ({ type, ref: 'r' }));
}

// Ranking score is a sum of weights; it never selects state.
describe('ranking score table', () => {
  const cases: { name: string; evidence: EvidenceType[]; score: number }[] = [
    { name: 'no evidence', evidence: [], score: 0 },
    { name: 'heuristic only', evidence: ['heuristic'], score: 0.2 },
    { name: 'config link', evidence: ['config_link'], score: 0.5 },
    { name: 'dependency api', evidence: ['dependency_api'], score: 0.9 },
    {
      name: 'flow plus config clamps to one',
      evidence: ['flow_xml_static', 'config_link'],
      score: 1,
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(scoreEvidence(ev(testCase.evidence), WEIGHTS)).toBeCloseTo(testCase.score, 5);
    });
  }
});

// State is the assigned state kept through finalisation, regardless of score.
describe('confidence table', () => {
  const cases: {
    name: string;
    assigned: ConfidenceState;
    evidence: EvidenceType[];
    excludeReason?: string;
    state: ConfidenceState;
  }[] = [
    {
      name: 'confirmed kept',
      assigned: 'confirmed',
      evidence: ['dependency_api'],
      state: 'confirmed',
    },
    { name: 'inferred kept', assigned: 'inferred', evidence: ['apex_static'], state: 'inferred' },
    {
      name: 'unresolved kept',
      assigned: 'unresolved',
      evidence: ['heuristic'],
      state: 'unresolved',
    },
    {
      name: 'no evidence falls to unresolved',
      assigned: 'confirmed',
      evidence: [],
      state: 'unresolved',
    },
    {
      name: 'scope exclusion wins',
      assigned: 'confirmed',
      evidence: ['dependency_api'],
      excludeReason: 'inactive',
      state: 'excluded',
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        finaliseConfidence(testCase.assigned, ev(testCase.evidence), testCase.excludeReason),
      ).toBe(testCase.state);
    });
  }
});
