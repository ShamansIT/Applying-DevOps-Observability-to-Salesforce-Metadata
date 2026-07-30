import { describe, expect, it } from 'vitest';
import {
  appendAdjudication,
  buildExceptionQueue,
  compareTruth,
} from '../../src/experiment/exceptions.js';
import type { AttemptResult, AttemptStatus } from '../../src/experiment/liveRunner.js';
import { generateBenchmark } from '../../src/experiment/scenarioGenerator.js';
import type { GeneratedScenario } from '../../src/experiment/scenarioGenerator.js';
import type { Outcome, ObservedFailureClass } from '../../src/experiment/oracle.js';

const { main } = generateBenchmark();

function attempt(
  scenario: GeneratedScenario,
  over: {
    status?: AttemptStatus;
    outcome?: Outcome;
    failureClass?: ObservedFailureClass;
    prediction?: string;
  },
): AttemptResult {
  const timing = {
    prototypeTtfafMs: 1,
    baselineTtfafMs: 2,
    leadTimeMs: 1,
    prototypeLatencyMs: 1,
    oracleLatencyMs: 2,
    prototypeFirst: true,
  };
  return {
    scenarioId: scenario.id,
    attemptId: 'a1',
    status: over.status ?? 'complete',
    materialisedChecksum: 'x',
    prototype: {
      predictionCategory: (over.prediction ?? 'no_blocking_finding') as never,
      actionableFinding: null,
      affectedComponents: [],
      stageEvents: [],
      failed: over.status === 'prototype_failed',
    },
    prototypeDeterministic: true,
    prototypeRepetitions: [],
    oracle: {
      outcome: over.outcome ?? 'pass',
      failureClass: over.failureClass ?? 'none',
      failingComponents: [],
      message: '',
      actionable: true,
      infrastructure: over.status === 'infrastructure_failed' ? 'retryable_failure' : 'ok',
      raw: {},
    },
    oracleStages: [],
    timing,
    raceLeadsMs: [],
    scenarioRun: {
      scenarioId: scenario.id,
      cluster: scenario.cluster,
      complexity: scenario.complexity,
      expectedValidity: scenario.mutationManifest.expectedValidity,
      expectedFailureClass: scenario.mutationManifest.expectedFailureClass,
      detectability: scenario.mutationManifest.detectability,
      prediction: (over.prediction ?? 'no_blocking_finding') as never,
      oracleOutcome: over.outcome ?? 'pass',
      oracleFailureClass: over.failureClass ?? 'none',
      timing,
    },
    comparison: {} as never,
    raw: {} as never,
  };
}

const invalidScenario = main.find((s) => s.designExpectation.validationOutcome === 'fail');
const validScenario = main.find((s) => s.designExpectation.validationOutcome === 'pass');

describe('compareTruth', () => {
  it('agrees when design and observed match', () => {
    if (!invalidScenario) throw new Error('no invalid scenario');
    const record = compareTruth(
      invalidScenario,
      attempt(invalidScenario, {
        outcome: 'fail',
        failureClass: invalidScenario.designExpectation.failureClass,
      }),
    );
    expect(record.status).toBe('agree');
    expect(record.designExpectation.validationOutcome).toBe('fail');
    expect(record.observedOracle.validationOutcome).toBe('fail');
  });

  it('needs adjudication when the outcomes disagree', () => {
    if (!invalidScenario) throw new Error('no invalid scenario');
    const record = compareTruth(invalidScenario, attempt(invalidScenario, { outcome: 'pass' }));
    expect(record.status).toBe('requires_adjudication');
  });
});

describe('buildExceptionQueue', () => {
  it('queues an unexpected pass', () => {
    if (!invalidScenario) throw new Error('no invalid scenario');
    const queue = buildExceptionQueue(
      [invalidScenario],
      [attempt(invalidScenario, { outcome: 'pass' })],
    );
    expect(queue[0]?.type).toBe('unexpected_pass');
  });

  it('queues infrastructure and setup failures', () => {
    if (!validScenario) throw new Error('no valid scenario');
    const infra = buildExceptionQueue(
      [validScenario],
      [attempt(validScenario, { status: 'infrastructure_failed' })],
    );
    const setup = buildExceptionQueue(
      [validScenario],
      [attempt(validScenario, { status: 'setup_failed' })],
    );
    expect(infra[0]?.type).toBe('infrastructure_failure');
    expect(setup[0]?.type).toBe('setup_failure');
  });

  it('does not queue a clean agreeing scenario', () => {
    if (!validScenario) throw new Error('no valid scenario');
    const queue = buildExceptionQueue(
      [validScenario],
      [attempt(validScenario, { outcome: 'pass' })],
    );
    expect(queue).toHaveLength(0);
  });
});

describe('appendAdjudication', () => {
  it('appends without mutating the prior log', () => {
    const log = [{ scenarioId: 's1', decision: 'accept', rationale: 'r', by: 'op', at: 't0' }];
    const next = appendAdjudication(log, {
      scenarioId: 's2',
      decision: 'exclude',
      rationale: 'r2',
      by: 'op',
      at: 't1',
    });
    expect(next).toHaveLength(2);
    expect(log).toHaveLength(1);
  });
});
