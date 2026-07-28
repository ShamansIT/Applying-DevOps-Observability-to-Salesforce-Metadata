import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import type { WeightModel } from '../../src/core/score/index.js';
import type { OrgSnapshot } from '../../src/ingestion/index.js';
import {
  aggregate,
  calibrate,
  hashGroundTruth,
  runScenario,
  toAggregateCsv,
  toScenarioCsv,
  toTtfafCsv,
  ttfafSample,
  ttfafStats,
  validateGroundTruth,
  validateScenario,
} from '../../src/evaluation/index.js';
import type { GroundTruth } from '../../src/evaluation/groundTruth.js';
import type { ScenarioResult } from '../../src/evaluation/metrics.js';
import type { Scenario } from '../../src/evaluation/scenario.js';
import type { ComparisonMetrics } from '../../src/evaluation/compare.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

describe('validateScenario', () => {
  const good: Scenario = {
    id: 'S',
    object: 'Account',
    event: 'update',
    cluster: 'mixed',
    depthLimit: 0,
    snapshot: 's.json',
  };
  it('accepts a valid scenario', () => {
    expect(() => {
      validateScenario(good);
    }).not.toThrow();
  });
  it('rejects a non-DML event', () => {
    expect(() => {
      validateScenario({ ...good, event: 'before_save' as Scenario['event'] });
    }).toThrow(/DML event/);
  });
});

describe('validateGroundTruth', () => {
  it('rejects an unexpected expected state', () => {
    const bad = {
      id: 'T',
      edges: [{ from: 'a', to: 'b', phase: 'p', expected: 'unresolved' }],
    } as unknown as GroundTruth;
    expect(() => {
      validateGroundTruth(bad);
    }).toThrow(/confirmed or inferred/);
  });
});

describe('hashGroundTruth', () => {
  it('is stable regardless of key order', () => {
    const a = {
      id: 'T',
      edges: [{ from: 'a', to: 'b', phase: 'p', expected: 'confirmed' as const }],
    };
    const b = {
      edges: [{ expected: 'confirmed' as const, to: 'b', phase: 'p', from: 'a' }],
      id: 'T',
    };
    expect(hashGroundTruth(a)).toBe(hashGroundTruth(b));
  });
  it('changes when an edge changes', () => {
    const a: GroundTruth = {
      id: 'T',
      edges: [{ from: 'a', to: 'b', phase: 'p', expected: 'confirmed' }],
    };
    const b: GroundTruth = {
      id: 'T',
      edges: [{ from: 'a', to: 'c', phase: 'p', expected: 'confirmed' }],
    };
    expect(hashGroundTruth(a)).not.toBe(hashGroundTruth(b));
  });
});

function metricsWith(id: string, f1: number, precision: number): ComparisonMetrics {
  return {
    scenarioId: id,
    expected: 2,
    claimed: 2,
    truePositives: 2,
    falsePositives: 0,
    falseNegatives: 0,
    precision,
    recall: 1,
    f1,
    coverage: 1,
    noise: 0,
    falseOmissionRate: 0,
    phaseOrderingAccuracy: 1,
  };
}

describe('aggregate and CSV', () => {
  const results: ScenarioResult[] = [
    { cluster: 'programmatic', metrics: metricsWith('S01', 0.8, 0.9) },
    { cluster: 'declarative', metrics: metricsWith('S02', 1, 1) },
  ];

  it('aggregates overall and per cluster with confidence intervals', () => {
    const report = aggregate(results);
    expect(report.overall.n).toBe(2);
    expect(report.overall.stats.f1?.mean).toBe(0.9);
    expect(report.overall.stats.f1?.ciHalfWidth).toBeGreaterThan(0);
    expect(report.byCluster.programmatic?.n).toBe(1);
    expect(report.byCluster.mixed).toBeUndefined();
  });

  it('shapes per-scenario and aggregate csv deterministically', () => {
    expect(toScenarioCsv(results)).toBe(toScenarioCsv(results));
    expect(toScenarioCsv(results).split('\n')[0]).toContain('scenario,cluster');
    const agg = toAggregateCsv(aggregate(results));
    expect(agg.split('\n')[0]).toBe('group,n,metric,mean,ci_half_width');
    expect(agg).toContain('overall,2,precision');
  });
});

describe('ttfaf', () => {
  it('reads L1 timing as time to first actionable feedback', () => {
    const snapshot: OrgSnapshot = {
      meta: {
        apiVersion: '67.0',
        capturedAt: '2026-01-01T00:00:00.000Z',
        source: 'fixture',
        toolVersion: '0.0.1',
      },
      components: [
        {
          type: 'ValidationRule',
          fullName: 'Account.R',
          object: 'Account',
          attributes: { active: true },
        },
      ],
    };
    const scenario: Scenario = {
      id: 'S',
      object: 'Account',
      event: 'update',
      cluster: 'declarative',
      depthLimit: 0,
      snapshot: 's.json',
    };
    const truth: GroundTruth = { id: 'S', edges: [] };
    const run = runScenario(scenario, snapshot, truth, MODEL, WEIGHTS);
    const sample = ttfafSample(run.result, 1);
    expect(sample.ttfafMs).toBeGreaterThanOrEqual(0);
    expect(sample.source).toBe('prototype');
    const stats = ttfafStats([sample, ttfafSample(run.result, 2)]);
    expect(stats.ttfaf.n).toBe(2);
    expect(toTtfafCsv([sample]).split('\n')[0]).toBe('source,repeat,ttfaf_ms,full_ms');
  });
});

describe('calibrate', () => {
  it('picks the candidate with best mean F1', () => {
    const snapshot: OrgSnapshot = {
      meta: {
        apiVersion: '67.0',
        capturedAt: '2026-01-01T00:00:00.000Z',
        source: 'fixture',
        toolVersion: '0.0.1',
      },
      components: [
        {
          type: 'ApexTrigger',
          fullName: 'AccountTrigger',
          object: 'Account',
          attributes: { events: ['before update'], status: 'Active' },
          source:
            'trigger AccountTrigger on Account (before update) { AccountService.run(Trigger.new); }',
        },
      ],
      dependencies: [
        {
          componentName: 'AccountTrigger',
          componentType: 'ApexTrigger',
          refName: 'AccountService',
          refType: 'ApexClass',
        },
      ],
    };
    const scenario: Scenario = {
      id: 'S',
      object: 'Account',
      event: 'update',
      cluster: 'programmatic',
      depthLimit: 0,
      snapshot: 's.json',
    };
    const truth: GroundTruth = {
      id: 'S',
      edges: [
        {
          from: 'apex_trigger:Account:AccountTrigger:before_triggers',
          to: 'apex_class:AccountService',
          phase: 'before_triggers',
          expected: 'confirmed',
        },
      ],
    };

    // High confirmed threshold makes the edge fall short of confirmed but it stays a claim; both
    // candidates find the edge, so F1 is 1 either way, and the first is chosen on tie.
    const strict: WeightModel = { ...WEIGHTS, thresholds: { confirmed: 0.95, inferred: 0.3 } };
    const result = calibrate([{ scenario, snapshot, truth }], [WEIGHTS, strict], MODEL);
    expect(result.bestIndex).toBe(0);
    expect(result.bestMeanF1).toBe(1);
    expect(result.ranking).toHaveLength(2);
  });
});
