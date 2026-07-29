import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import type { WeightModel } from '../../src/core/score/index.js';
import type { OrgSnapshot } from '../../src/ingestion/index.js';
import {
  aggregate,
  hashGroundTruth,
  proceduralTtfaf,
  proceduralTtfafStats,
  rankingCalibrate,
  runScenario,
  sessionTtfaf,
  skeletonSample,
  skeletonStats,
  toAggregateCsv,
  toBaselineCsv,
  toProceduralTtfafCsv,
  toScenarioCsv,
  toSkeletonCsv,
  validateBaselineSession,
  validateGroundTruth,
  validateScenario,
} from '../../src/evaluation/index.js';
import type { ProceduralTtfafRecord } from '../../src/evaluation/ttfaf.js';
import type { BaselineSession, IdentifiedItem } from '../../src/evaluation/baseline.js';
import type { GroundTruth } from '../../src/evaluation/groundTruth.js';
import type { ScenarioResult } from '../../src/evaluation/metrics.js';
import type { ComplexityLevel, Scenario } from '../../src/evaluation/scenario.js';
import type { ComparisonMetrics } from '../../src/evaluation/compare.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

// Required benchmark metadata shared by inline scenarios; spread into each so tests stay terse.
const META = {
  taskPrompt: 'list automations and their order',
  startingPoint: 'object in setup, source only',
  complexityProfile: { level: 'low' as const, automationCount: 1, crossObject: false },
  expansionProfile: { usesExpansion: false, maxDepth: 0 },
  groundTruthReference: 'S',
  inclusionRationale: 'unit fixture',
  versions: { apiVersion: '67.0', toolVersion: '0.0.1', snapshot: 's' },
};

describe('validateScenario', () => {
  const good: Scenario = {
    id: 'S',
    object: 'Account',
    event: 'update',
    cluster: 'mixed',
    depthLimit: 0,
    snapshot: 's.json',
    ...META,
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
  it('rejects a missing task prompt', () => {
    expect(() => {
      validateScenario({ ...good, taskPrompt: '  ' });
    }).toThrow(/taskPrompt/);
  });
  it('rejects an unknown complexity level', () => {
    expect(() => {
      validateScenario({
        ...good,
        complexityProfile: { ...good.complexityProfile, level: 'huge' as ComplexityLevel },
      });
    }).toThrow(/complexityProfile.level/);
  });
  it('rejects a blank pinned version', () => {
    expect(() => {
      validateScenario({ ...good, versions: { ...good.versions, apiVersion: '' } });
    }).toThrow(/versions.apiVersion/);
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
  it('accepts a full record with nodes, typed relationship and adjudication', () => {
    const full: GroundTruth = {
      id: 'T',
      source: 'author inspection',
      nodes: [{ id: 'n', phase: 'before_triggers', adjudication: 'scorable' }],
      edges: [
        {
          from: 'a',
          to: 'b',
          phase: 'p',
          expected: 'confirmed',
          relationship: 'invokes',
          adjudication: 'scorable',
        },
      ],
      exclusions: [{ ref: 'x', reason: 'asynchronous' }],
    };
    expect(() => {
      validateGroundTruth(full);
    }).not.toThrow();
  });
  it('rejects an unknown relationship type', () => {
    const bad = {
      id: 'T',
      edges: [{ from: 'a', to: 'b', phase: 'p', expected: 'confirmed', relationship: 'calls' }],
    } as unknown as GroundTruth;
    expect(() => {
      validateGroundTruth(bad);
    }).toThrow(/relationship is not known/);
  });
  it('rejects an unknown adjudication status', () => {
    const bad = {
      id: 'T',
      edges: [{ from: 'a', to: 'b', phase: 'p', expected: 'confirmed', adjudication: 'maybe' }],
    } as unknown as GroundTruth;
    expect(() => {
      validateGroundTruth(bad);
    }).toThrow(/adjudication must be/);
  });
  it('rejects a node without a phase', () => {
    const bad = {
      id: 'T',
      nodes: [{ id: 'n' }],
      edges: [],
    } as unknown as GroundTruth;
    expect(() => {
      validateGroundTruth(bad);
    }).toThrow(/node 0 missing id or phase/);
  });
  it('rejects an exclusion without a reason', () => {
    const bad = {
      id: 'T',
      edges: [],
      exclusions: [{ ref: 'x' }],
    } as unknown as GroundTruth;
    expect(() => {
      validateGroundTruth(bad);
    }).toThrow(/exclusion 0 missing ref or reason/);
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
    expectedNodes: 2,
    claimedNodes: 2,
    nodeTruePositives: 2,
    nodePrecision: 1,
    nodeRecall: 1,
    phaseAccuracy: 1,
    expected: 2,
    claimed: 2,
    truePositives: 2,
    falsePositives: 0,
    falseNegatives: 0,
    precision,
    recall: 1,
    f1,
    orderedPathCoverage: 1,
    noise: 0,
    falseOmissionRate: 0,
    boundaryTotal: 0,
    boundaryAccuracy: 1,
    ambiguousExcluded: 0,
    distribution: { confirmed: 4, inferred: 0, unresolved: 0, excluded: 0 },
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

describe('skeleton latency', () => {
  it('reads L1 timing as time to first paint', () => {
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
      ...META,
    };
    const truth: GroundTruth = { id: 'S', edges: [] };
    const run = runScenario(scenario, snapshot, truth, MODEL, WEIGHTS);
    const sample = skeletonSample(run.result, 1);
    expect(sample.timeToSkeletonMs).toBeGreaterThanOrEqual(0);
    expect(sample.source).toBe('prototype');
    const stats = skeletonStats([sample, skeletonSample(run.result, 2)]);
    expect(stats.skeleton.n).toBe(2);
    expect(toSkeletonCsv([sample]).split('\n')[0]).toBe(
      'source,repeat,time_to_skeleton_ms,full_ms',
    );
  });
});

describe('procedural ttfaf', () => {
  const record: ProceduralTtfafRecord = {
    scenarioId: 'S01',
    condition: 'baseline',
    taskPrompt: 'list automations and their order',
    candidates: [
      { atMs: 20_000, actionable: false, correct: false },
      { atMs: 65_000, actionable: true, correct: true },
      { atMs: 90_000, actionable: true, correct: true },
    ],
    timedOut: false,
  };

  it('takes the first actionable answer as ttfaf and reads its post-run correctness', () => {
    const outcome = proceduralTtfaf(record);
    expect(outcome.ttfafMs).toBe(65_000);
    expect(outcome.reached).toBe(true);
    expect(outcome.correctAtTtfaf).toBe(true);
  });

  it('reports a timeout with no actionable answer as not reached at the cap', () => {
    const outcome = proceduralTtfaf({
      ...record,
      candidates: [{ atMs: 30_000, actionable: false }],
      timedOut: true,
      timeoutMs: 120_000,
    });
    expect(outcome.reached).toBe(false);
    expect(outcome.ttfafMs).toBe(120_000);
    expect(outcome.correctAtTtfaf).toBe(false);
  });

  it('rejects a record that timed out without a cap', () => {
    expect(() => {
      proceduralTtfaf({ ...record, timedOut: true });
    }).toThrow(/timeoutMs/);
  });

  it('aggregates reached ttfaf and counts correctness apart from timeouts', () => {
    const stats = proceduralTtfafStats([
      record,
      {
        ...record,
        scenarioId: 'S02',
        candidates: [{ atMs: 45_000, actionable: true, correct: false }],
      },
    ]);
    expect(stats.total).toBe(2);
    expect(stats.reached).toBe(2);
    expect(stats.correct).toBe(1);
    expect(stats.ttfaf.mean).toBe(55_000);
    expect(toProceduralTtfafCsv([record]).split('\n')[0]).toBe(
      'scenario,condition,ttfaf_ms,reached,correct_at_ttfaf',
    );
  });
});

describe('baseline session', () => {
  const session: BaselineSession = {
    scenarioId: 'S01',
    operator: 'op1',
    condition: 'baseline',
    conditionOrder: 1,
    taskPrompt: 'list automations and their order',
    candidates: [
      { atMs: 30_000, actionable: false, correct: false },
      { atMs: 70_000, actionable: true, correct: true },
    ],
    timedOut: false,
    identified: [
      { ref: 'AccountTrigger', kind: 'component', source: 'setup' },
      { ref: 'AccountTrigger->AccountService', kind: 'relationship', evidence: 'call site' },
    ],
    inspectionLog: [
      { atMs: 5_000, action: 'opened trigger', target: 'AccountTrigger' },
      { atMs: 40_000, action: 'read flow', target: 'Account_After_Save' },
    ],
  };

  it('derives ttfaf from the same candidates the session holds', () => {
    const outcome = sessionTtfaf(session);
    expect(outcome.ttfafMs).toBe(70_000);
    expect(outcome.reached).toBe(true);
    expect(outcome.correctAtTtfaf).toBe(true);
  });

  it('rejects a non-counterbalanced condition order', () => {
    expect(() => {
      validateBaselineSession({ ...session, conditionOrder: 0 });
    }).toThrow(/conditionOrder/);
  });

  it('rejects an identified item with an unknown kind', () => {
    expect(() => {
      validateBaselineSession({
        ...session,
        identified: [{ ref: 'x', kind: 'thing' as IdentifiedItem['kind'] }],
      });
    }).toThrow(/component or relationship/);
  });

  it('summarises sessions to csv side by side', () => {
    const csv = toBaselineCsv([session, { ...session, operator: 'op2', condition: 'assisted' }]);
    expect(csv.split('\n')[0]).toBe(
      'scenario,operator,condition,condition_order,ttfaf_ms,reached,correct_at_ttfaf,identified,inspections,timed_out',
    );
    expect(csv).toContain('S01,op1,baseline,1,70000,true,true,2,2,false');
  });
});

describe('rankingCalibrate', () => {
  // Held-out validation case; calibration reads reconstruction state and score, never ground truth.
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
          'trigger AccountTrigger on Account (before update) { AccountService.run(Trigger.new); String q = "SELECT Id FROM " + obj; Database.query(q); }',
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
    id: 'V',
    object: 'Account',
    event: 'update',
    cluster: 'programmatic',
    depthLimit: 0,
    snapshot: 's.json',
    ...META,
  };

  it('picks the candidate whose score best orders confidence tiers', () => {
    // Ordering candidate rewards stronger evidence; flat candidate scores everything equally and so
    // cannot rank tiers apart. Ordering candidate wins or ties, never loses.
    const ordering: WeightModel = { ...WEIGHTS };
    const flat: WeightModel = {
      ...WEIGHTS,
      evidenceWeights: {
        dependency_api: 0.5,
        object_binding: 0.5,
        flow_xml_static: 0.5,
        apex_static: 0.5,
        config_link: 0.5,
        heuristic: 0.5,
      },
    };
    const result = rankingCalibrate([{ scenario, snapshot }], [ordering, flat], MODEL);
    expect(result.ranking).toHaveLength(2);
    expect(result.bestConcordance).toBeGreaterThanOrEqual(result.ranking[1]?.concordance ?? 0);
    expect(result.ranking[0]?.concordance).toBeGreaterThanOrEqual(
      result.ranking[1]?.concordance ?? 0,
    );
  });

  it('needs at least one case and one candidate', () => {
    expect(() => {
      rankingCalibrate([], [WEIGHTS], MODEL);
    }).toThrow(/at least one/);
  });
});
