import { describe, expect, it } from 'vitest';
import { resolveState, scoreEvidence } from '../../../src/core/score/score.js';
import type { WeightModel } from '../../../src/core/score/index.js';
import type { ConfidenceState, Evidence, EvidenceType } from '../../../src/core/types.js';

// Fixed model so expectations are explicit and independent of config values.
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

interface Case {
  name: string;
  evidence: EvidenceType[];
  excludeReason?: string;
  score: number;
  state: ConfidenceState;
}

const CASES: Case[] = [
  { name: 'no evidence', evidence: [], score: 0, state: 'unresolved' },
  { name: 'heuristic only', evidence: ['heuristic'], score: 0.2, state: 'unresolved' },
  {
    name: 'two heuristics hit inferred boundary',
    evidence: ['heuristic', 'heuristic'],
    score: 0.4,
    state: 'inferred',
  },
  { name: 'config link', evidence: ['config_link'], score: 0.5, state: 'inferred' },
  { name: 'object binding', evidence: ['object_binding'], score: 0.7, state: 'inferred' },
  {
    name: 'dependency api hits confirmed',
    evidence: ['dependency_api'],
    score: 0.9,
    state: 'confirmed',
  },
  {
    name: 'flow plus config clamps to one',
    evidence: ['flow_xml_static', 'config_link'],
    score: 1,
    state: 'confirmed',
  },
  {
    name: 'apex plus flow clamps to one',
    evidence: ['apex_static', 'flow_xml_static'],
    score: 1,
    state: 'confirmed',
  },
  {
    name: 'exclusion wins over strong evidence',
    evidence: ['dependency_api'],
    excludeReason: 'inactive',
    score: 0.9,
    state: 'excluded',
  },
];

describe('scoring table', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const score = scoreEvidence(ev(testCase.evidence), WEIGHTS);
      expect(score).toBeCloseTo(testCase.score, 5);
      expect(resolveState(score, WEIGHTS, testCase.excludeReason)).toBe(testCase.state);
    });
  }

  it('resolves exactly on each threshold boundary', () => {
    expect(resolveState(0.8, WEIGHTS)).toBe('confirmed');
    expect(resolveState(0.799, WEIGHTS)).toBe('inferred');
    expect(resolveState(0.4, WEIGHTS)).toBe('inferred');
    expect(resolveState(0.399, WEIGHTS)).toBe('unresolved');
  });

  it('treats blank exclude reason as no exclusion', () => {
    expect(resolveState(0.9, WEIGHTS, '   ')).toBe('confirmed');
  });
});
