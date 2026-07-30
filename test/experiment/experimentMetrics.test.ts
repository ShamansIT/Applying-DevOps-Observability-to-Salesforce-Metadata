import { describe, expect, it } from 'vitest';
import { computeExperimentMetrics } from '../../src/experiment/experimentMetrics.js';
import type { ScenarioRun } from '../../src/experiment/experimentMetrics.js';
import type { RaceTiming } from '../../src/experiment/race.js';

function timing(lead: number, first: boolean): RaceTiming {
  return {
    prototypeTtfafMs: 5,
    baselineTtfafMs: 5 + lead,
    leadTimeMs: lead,
    prototypeLatencyMs: 5,
    oracleLatencyMs: 5 + lead,
    prototypeFirst: first,
  };
}

function run(part: Partial<ScenarioRun>): ScenarioRun {
  return {
    scenarioId: 'S',
    cluster: 'mixed',
    complexity: 'low',
    expectedValidity: 'invalid',
    expectedFailureClass: 'metadata_reference',
    detectability: 'static-direct',
    prediction: 'material_warning',
    oracleOutcome: 'fail',
    oracleFailureClass: 'metadata_reference',
    timing: timing(10, true),
    ...part,
  };
}

describe('computeExperimentMetrics', () => {
  it('scores detection recall over static-invalid and false warnings over valid', () => {
    const runs: ScenarioRun[] = [
      run({ scenarioId: 'a' }), // static invalid, flagged -> detected
      run({ scenarioId: 'b', prediction: 'no_blocking_finding' }), // static invalid, missed
      run({
        scenarioId: 'c',
        expectedValidity: 'valid',
        prediction: 'material_warning',
        oracleOutcome: 'pass',
      }), // false warning
      run({
        scenarioId: 'd',
        expectedValidity: 'valid',
        prediction: 'no_blocking_finding',
        oracleOutcome: 'pass',
      }), // clean valid
    ];
    const m = computeExperimentMetrics(runs);
    expect(m.detection.staticInvalid).toBe(2);
    expect(m.detection.detectedStaticInvalid).toBe(1);
    expect(m.detection.recall).toBe(0.5);
    expect(m.detection.valid).toBe(2);
    expect(m.detection.falseWarnings).toBe(1);
    expect(m.detection.falseWarningRate).toBe(0.5);
    // raised on invalid = 1 (a), raised total = 2 (a, c) -> precision 0.5
    expect(m.detection.precision).toBe(0.5);
  });

  it('summarises timing and the policy-gate simulation', () => {
    const runs: ScenarioRun[] = [
      run({ scenarioId: 'a', timing: timing(10, true) }),
      run({
        scenarioId: 'b',
        expectedValidity: 'valid',
        prediction: 'material_warning',
        timing: timing(-2, false),
      }),
    ];
    const m = computeExperimentMetrics(runs);
    expect(m.timing.prototypeFirstShare).toBe(0.5);
    expect(m.policyGate.validationsAvoided).toBe(2); // both flagged blocking-grade
    expect(m.policyGate.failuresInterceptedLocally).toBe(1); // the invalid one
    expect(m.policyGate.validFalselyBlocked).toBe(1); // the valid flagged one
  });
});
