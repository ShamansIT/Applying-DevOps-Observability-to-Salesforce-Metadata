import { describe, expect, it } from 'vitest';
import { computeTiming, runRace } from '../../src/experiment/race.js';
import type { RaceTimestamps } from '../../src/experiment/race.js';
import type { PrototypeOutcome } from '../../src/experiment/prototypeAdapter.js';
import type { ValidationResult } from '../../src/experiment/oracle.js';

const proto: PrototypeOutcome = {
  predictionCategory: 'material_warning',
  actionableFinding: { category: 'material_warning', component: 'a', reason: 'r', scope: 'risk' },
  affectedComponents: ['a'],
  stageEvents: [],
  failed: false,
};

const oracle: ValidationResult = {
  outcome: 'fail',
  failureClass: 'metadata_reference',
  failingComponents: ['a'],
  message: 'm',
  actionable: true,
  infrastructure: 'ok',
  raw: {},
};

describe('computeTiming', () => {
  it('computes ttfaf and a positive lead when the prototype is first', () => {
    const ts: RaceTimestamps = {
      t0Ns: 0n,
      prototypeFirstActionableNs: 5_000_000n,
      prototypeCompletedNs: 5_000_000n,
      orgFirstActionableNs: 20_000_000n,
      orgValidationCompletedNs: 20_000_000n,
    };
    const t = computeTiming(ts);
    expect(t.prototypeTtfafMs).toBe(5);
    expect(t.baselineTtfafMs).toBe(20);
    expect(t.leadTimeMs).toBe(15);
    expect(t.prototypeFirst).toBe(true);
  });
});

describe('runRace', () => {
  it('runs both paths from one t0 and times them', async () => {
    const marks = [0n, 5_000_000n, 20_000_000n];
    let i = 0;
    const now = (): bigint => marks[i++] ?? 0n;
    const race = await runRace({
      prototype: () => proto,
      oracle: () => Promise.resolve(oracle),
      now,
    });
    expect(race.prototype.predictionCategory).toBe('material_warning');
    expect(race.oracle.outcome).toBe('fail');
    expect(race.timing.leadTimeMs).toBe(15);
    expect(race.timing.prototypeFirst).toBe(true);
  });
});
