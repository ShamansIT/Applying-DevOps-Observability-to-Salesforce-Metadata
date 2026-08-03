import { describe, expect, it } from 'vitest';
import { pilotSummary, pilotSummaryFiles } from '../../src/experiment/pilotSummary.js';
import type { ReadinessRecord } from '../../src/experiment/readiness.js';

interface Canned {
  id: string;
  status?: string;
  mutatedOutcome?: string;
  mutatedValidation: 'pass' | 'fail';
  prototype: 'no_concern' | 'blocking' | 'risk_or_unresolved';
  category: string;
  lead?: number;
  deterministic?: boolean;
  criteriaMet?: boolean;
  reasons?: string[];
}

function record(c: Canned): ReadinessRecord {
  return {
    scenarioId: c.id,
    status: c.status ?? 'complete',
    mutatedOutcome: c.mutatedOutcome ?? 'not_run',
    designExpectation: { mutatedValidation: c.mutatedValidation, prototype: c.prototype },
    prototype: { predictionCategory: c.category },
    prototypeDeterministic: c.deterministic ?? true,
    timing: { leadTimeMs: c.lead ?? 5 },
    criteriaMet: c.criteriaMet ?? true,
    reasons: c.reasons ?? [],
  } as unknown as ReadinessRecord;
}

const records = [
  record({
    id: 'cand-declarative-static_fail',
    mutatedValidation: 'fail',
    prototype: 'blocking',
    category: 'blocking_finding',
  }),
  record({
    id: 'cand-programmatic-risk',
    mutatedValidation: 'pass',
    prototype: 'risk_or_unresolved',
    category: 'unresolved',
  }),
  record({
    id: 'cand-mixed-valid',
    mutatedValidation: 'pass',
    prototype: 'no_concern',
    category: 'no_blocking_finding',
    criteriaMet: false,
    reasons: ['prototype no_blocking_finding, expected no_concern'],
  }),
];

describe('pilotSummary', () => {
  it('reports not_run org execution when no scenario has an oracle outcome', () => {
    const summary = pilotSummary('run-1', records);
    expect(summary.orgExecutionStatus).toBe('not_run');
    expect(summary.completion.total).toBe(3);
    expect(summary.completion.complete).toBe(3);
  });

  it('counts static-failure and risk detection', () => {
    const summary = pilotSummary('run-1', records);
    expect(summary.detection.staticFailures).toBe(1);
    expect(summary.detection.staticFailuresFlagged).toBe(1);
    expect(summary.detection.riskScenarios).toBe(1);
    expect(summary.detection.riskScenariosFlagged).toBe(1);
  });

  it('collects exceptions and a single-observation timing note', () => {
    const summary = pilotSummary('run-1', records);
    expect(summary.exceptions).toHaveLength(1);
    expect(summary.exceptions[0]?.scenarioId).toBe('cand-mixed-valid');
    expect(summary.timing.note).toBe('single_paired_observation_per_scenario');
    expect(pilotSummaryFiles(summary)['pilot-summary.json']).toBeDefined();
  });

  it('marks org execution present once an oracle outcome exists', () => {
    const withOutcome = [
      ...records,
      record({
        id: 'cand-x-y',
        mutatedValidation: 'fail',
        prototype: 'blocking',
        category: 'blocking_finding',
        mutatedOutcome: 'fail',
      }),
    ];
    expect(pilotSummary('run-1', withOutcome).orgExecutionStatus).toBe('present');
  });
});
