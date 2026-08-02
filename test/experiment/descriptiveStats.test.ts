import { describe, expect, it } from 'vitest';
import { descriptiveSummary } from '../../src/experiment/descriptiveStats.js';
import type { ComparisonMetrics } from '../../src/evaluation/compare.js';
import type { ScenarioResult } from '../../src/evaluation/metrics.js';

function metrics(f1: number): ComparisonMetrics {
  return {
    scenarioId: 's',
    expectedNodes: 1,
    claimedNodes: 1,
    nodeTruePositives: 1,
    nodePrecision: 1,
    nodeRecall: 1,
    phaseAccuracy: 1,
    expected: 1,
    claimed: 1,
    truePositives: 1,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1,
    f1,
    relationshipAccuracy: 1,
    orderedPathCoverage: 1,
    finalEdgeNoiseRate: 0,
    finalExpectedEdgeOmissionRate: 0,
    runtimeOnlyExpected: 0,
    runtimeOnlyHandled: 0,
    boundaryTotal: 0,
    boundaryAccuracy: 1,
    ambiguousExcluded: 0,
    distribution: { confirmed: 1, inferred: 0, unresolved: 0, excluded: 0 },
  };
}

const results: ScenarioResult[] = [0.2, 0.4, 0.6, 0.8, 1.0].map((f1) => ({
  cluster: 'programmatic',
  metrics: metrics(f1),
}));

describe('descriptiveSummary', () => {
  it('reports median, IQR and a bootstrap CI, with hypotheses not_run', () => {
    const summary = descriptiveSummary({
      results,
      deterministic: [true, true, true, true, true],
      latenciesMs: [1, 2, 3, 4, 5],
    });
    const f1 = summary.metrics['f1'];
    expect(f1?.median).toBe(0.6);
    expect(f1?.iqr).toBeCloseTo(0.4, 5);
    expect(f1?.ci95Low).toBeLessThanOrEqual(f1?.median ?? 0);
    expect(f1?.ci95High).toBeGreaterThanOrEqual(f1?.median ?? 0);
    expect(summary.hypotheses).toBe('not_run');
    expect(summary.determinism.allDeterministic).toBe(true);
    expect(summary.latency.medianMs).toBe(3);
  });

  it('is deterministic: same input gives an identical bootstrap interval', () => {
    const input = {
      results,
      deterministic: [true, true, true, true, true],
      latenciesMs: [1, 2, 3, 4, 5],
    };
    expect(JSON.stringify(descriptiveSummary(input))).toBe(
      JSON.stringify(descriptiveSummary(input)),
    );
  });
});
