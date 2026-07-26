import { describe, expect, it } from 'vitest';
import {
  loadWeights,
  resolveState,
  scoreEvidence,
  validateWeights,
} from '../../../src/core/score/index.js';
import type { WeightModel } from '../../../src/core/score/index.js';
import type { Evidence } from '../../../src/core/types.js';

const WEIGHTS = loadWeights();

function ev(type: Evidence['type']): Evidence {
  return { type, ref: 'x' };
}

describe('scoreEvidence', () => {
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

describe('resolveState', () => {
  it('returns excluded whenever a reason is present, ignoring score', () => {
    expect(resolveState(1, WEIGHTS, 'async post-commit')).toBe('excluded');
  });

  it('maps score bands onto confirmed / inferred / unresolved', () => {
    expect(resolveState(WEIGHTS.thresholds.confirmed, WEIGHTS)).toBe('confirmed');
    expect(resolveState(WEIGHTS.thresholds.inferred, WEIGHTS)).toBe('inferred');
    expect(resolveState(WEIGHTS.thresholds.inferred - 0.01, WEIGHTS)).toBe('unresolved');
  });

  it('treats blank reason as no exclusion', () => {
    expect(resolveState(1, WEIGHTS, '   ')).toBe('confirmed');
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
    expect(WEIGHTS.provisional).toBe(true);
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

  it('rejects confirmed threshold below inferred', () => {
    const bad = { ...good, thresholds: { confirmed: 0.3, inferred: 0.4 } };
    expect(() => {
      validateWeights(bad);
    }).toThrow(/confirmed threshold/);
  });
});
