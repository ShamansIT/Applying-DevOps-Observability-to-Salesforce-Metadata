import { describe, expect, it } from 'vitest';
import {
  finaliseConfidence,
  loadWeights,
  scoreEvidence,
  strongerState,
  validateWeights,
} from '../../../src/core/score/index.js';
import type { WeightModel } from '../../../src/core/score/index.js';
import type { Evidence } from '../../../src/core/types.js';

const WEIGHTS = loadWeights();

function ev(type: Evidence['type']): Evidence {
  return { type, ref: 'x' };
}

describe('scoreEvidence (ranking only)', () => {
  it('sums weights of present evidence', () => {
    const score = scoreEvidence([ev('object_binding')], WEIGHTS);
    expect(score).toBeCloseTo(WEIGHTS.evidenceWeights.object_binding);
  });

  it('clamps combined evidence to at most 1', () => {
    const score = scoreEvidence(
      [ev('dependency_api'), ev('object_binding'), ev('flow_xml_static')],
      WEIGHTS,
    );
    expect(score).toBe(1);
  });

  it('scores empty evidence as zero', () => {
    expect(scoreEvidence([], WEIGHTS)).toBe(0);
  });
});

describe('finaliseConfidence (rule-based, not score-derived)', () => {
  it('returns excluded whenever a scope reason is present', () => {
    expect(finaliseConfidence('confirmed', [ev('dependency_api')], 'inactive')).toBe('excluded');
  });

  it('keeps the assigned state when evidence is present', () => {
    expect(finaliseConfidence('confirmed', [ev('dependency_api')])).toBe('confirmed');
    expect(finaliseConfidence('inferred', [ev('apex_static')])).toBe('inferred');
    expect(finaliseConfidence('unresolved', [ev('heuristic')])).toBe('unresolved');
  });

  it('falls to unresolved when there is no evidence', () => {
    expect(finaliseConfidence('confirmed', [])).toBe('unresolved');
  });

  it('treats blank reason as no exclusion', () => {
    expect(finaliseConfidence('confirmed', [ev('dependency_api')], '   ')).toBe('confirmed');
  });
});

describe('strongerState', () => {
  it('ranks confirmed over inferred over unresolved', () => {
    expect(strongerState('confirmed', 'inferred')).toBe('confirmed');
    expect(strongerState('unresolved', 'inferred')).toBe('inferred');
    expect(strongerState('unresolved', 'unresolved')).toBe('unresolved');
  });
});

describe('validateWeights', () => {
  const good: WeightModel = {
    provisional: true,
    evidenceWeights: {
      dependency_api: 0.9,
      flow_xml_static: 0.6,
      apex_static: 0.6,
      object_binding: 0.7,
      config_link: 0.5,
      heuristic: 0.2,
    },
    thresholds: { confirmed: 0.8, inferred: 0.4 },
  };

  it('accepts the pinned config file', () => {
    expect(() => {
      validateWeights(WEIGHTS);
    }).not.toThrow();
  });

  it('rejects out-of-range weight', () => {
    const bad = { ...good, evidenceWeights: { ...good.evidenceWeights, heuristic: 2 } };
    expect(() => {
      validateWeights(bad);
    }).toThrow(/heuristic/);
  });
});
