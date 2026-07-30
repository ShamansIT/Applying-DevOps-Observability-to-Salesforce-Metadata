import { describe, expect, it } from 'vitest';
import {
  buildRawAttempt,
  capturingRunner,
  rawAttemptFiles,
} from '../../src/experiment/rawStorage.js';
import type { RawAttemptInput } from '../../src/experiment/rawStorage.js';
import type { ProcResult } from '../../src/experiment/oracle.js';

const timestamps = {
  t0Ns: 0n,
  prototypeFirstActionableNs: 5n,
  prototypeCompletedNs: 5n,
  orgFirstActionableNs: 20n,
  orgValidationCompletedNs: 20n,
};

function input(over: Partial<RawAttemptInput> = {}): RawAttemptInput {
  return {
    scenarioId: 'main-x',
    attemptId: 'a1',
    status: 'complete',
    materialisedProjectHash: 'hash',
    prediction: 'material_warning',
    prototypeRepetitions: ['material_warning', 'material_warning'],
    prototype: {
      predictionCategory: 'material_warning',
      actionableFinding: null,
      affectedComponents: [],
      stageEvents: [],
      failed: false,
    },
    oracle: {
      outcome: 'fail',
      failureClass: 'metadata_reference',
      failingComponents: [],
      message: 'boom',
      actionable: true,
      infrastructure: 'ok',
      raw: {},
    },
    stages: [
      {
        stage: 'metadata_validation',
        outcome: 'fail',
        failureClass: 'metadata_reference',
        message: 'boom',
      },
    ],
    runtimeReviewNeeded: false,
    cliCalls: [],
    timestamps,
    raceLeadsMs: [15],
    designExpectation: {
      validationOutcome: 'fail',
      failureClass: 'metadata_reference',
      detectability: 'static-direct',
      requiredOracleStages: ['metadata_validation'],
      affectedComponents: [],
      expectedNodes: [],
      expectedEdges: [],
      rationale: 'x',
    },
    comparison: {
      scenarioId: 'main-x',
      designExpectation: {
        validationOutcome: 'fail',
        failureClass: 'metadata_reference',
        detectability: 'static-direct',
      },
      observedOracle: { validationOutcome: 'fail', failureClass: 'metadata_reference' },
      status: 'agree',
    },
    ...over,
  };
}

describe('capturingRunner', () => {
  it('records every call transparently', async () => {
    const inner = (): Promise<ProcResult> => Promise.resolve({ code: 0, stdout: 'ok', stderr: '' });
    const { run, calls } = capturingRunner(inner);
    await run('sf', ['project', 'deploy']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdout).toBe('ok');
  });
});

describe('buildRawAttempt', () => {
  it('flags deterministic when every repetition agrees', () => {
    expect(buildRawAttempt(input()).prototype.deterministic).toBe(true);
  });

  it('flags non-deterministic when repetitions differ', () => {
    const record = buildRawAttempt(
      input({ prototypeRepetitions: ['material_warning', 'unresolved'] }),
    );
    expect(record.prototype.deterministic).toBe(false);
  });

  it('stores nanosecond marks as strings', () => {
    expect(buildRawAttempt(input()).timingEvents.t0Ns).toBe('0');
  });
});

describe('rawAttemptFiles', () => {
  it('writes one redacted file per attempt', () => {
    const record = buildRawAttempt(
      input({
        cliCalls: [
          { file: 'sf', args: [], code: 0, stdout: 'user me@example.com ran it', stderr: '' },
        ],
      }),
    );
    const files = rawAttemptFiles([record]);
    const content = files['raw/main-x/a1.json'];
    expect(content).toBeDefined();
    expect(content).toContain('[redacted-user]');
    expect(content).not.toContain('me@example.com');
  });
});
