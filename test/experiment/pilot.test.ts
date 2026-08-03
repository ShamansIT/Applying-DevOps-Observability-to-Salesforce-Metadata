import { describe, expect, it } from 'vitest';
import {
  activePilot,
  buildPilotPlan,
  candidateRegisterHash,
  orderByPlan,
  pilotEntries,
  planHash,
  resumeAllowed,
} from '../../src/experiment/pilot.js';
import type { RunFingerprint } from '../../src/experiment/pilot.js';

const ENTRIES = pilotEntries();

describe('pilot plan', () => {
  it('uses exactly the nine candidates, never R01-R03 or the generated benchmark', () => {
    expect(ENTRIES).toHaveLength(9);
    expect(ENTRIES.every((e) => e.candidate.id.startsWith('cand-'))).toBe(true);
    expect(ENTRIES.some((e) => /^R0[123]/.test(e.candidate.id))).toBe(false);
    expect(ENTRIES.every((e) => e.candidate.salesforceValidated === false)).toBe(true);
  });

  it('the active plan is metadata-validation only and rejects test/runtime scenarios', () => {
    expect(activePilot(ENTRIES)).toHaveLength(9);
    const first = ENTRIES[0];
    if (!first) throw new Error('no entry');
    const withRuntime = [
      { ...first, oracleStage: 'runtime_transaction' as const },
      ...ENTRIES.slice(1),
    ];
    expect(activePilot(withRuntime)).toHaveLength(8);
  });

  it('freezes a plan carrying the candidate-register hash', () => {
    const plan = buildPilotPlan(ENTRIES, 'run-1', 7);
    expect(plan.stage).toBe('metadata_validation');
    expect(plan.registerHash).toBe(candidateRegisterHash(ENTRIES));
    expect(plan.items).toHaveLength(9);
    expect(plan.scenarioIds).toHaveLength(9);
  });

  it('orders by the plan and rejects a register-hash mismatch', () => {
    const plan = buildPilotPlan(ENTRIES, 'run-1', 3);
    const ordered = orderByPlan(ENTRIES, plan);
    expect(ordered.map((e) => e.candidate.id)).toEqual(
      [...plan.items].sort((a, b) => a.order - b.order).map((i) => i.scenarioId),
    );
    expect(() => orderByPlan(ENTRIES, { ...plan, registerHash: 'tampered' })).toThrow(/register/);
  });
});

describe('resume gate', () => {
  const base: RunFingerprint = { gitCommit: 'abc', registerHash: 'reg', planHash: 'plan' };

  it('allows a resume when commit, register and plan all match', () => {
    expect(resumeAllowed(base, { ...base }).allowed).toBe(true);
  });

  it('refuses a resume on any drift', () => {
    expect(resumeAllowed(base, { ...base, gitCommit: 'x' }).allowed).toBe(false);
    expect(resumeAllowed(base, { ...base, registerHash: 'x' }).allowed).toBe(false);
    expect(resumeAllowed(base, { ...base, planHash: 'x' }).allowed).toBe(false);
  });

  it('plan hash is deterministic', () => {
    const plan = buildPilotPlan(ENTRIES, 'run-1', 5);
    expect(planHash(plan)).toBe(planHash(plan));
  });
});
