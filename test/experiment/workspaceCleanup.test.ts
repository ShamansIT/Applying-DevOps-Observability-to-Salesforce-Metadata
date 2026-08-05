import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import {
  combineCleanup,
  memoryWorkspace,
  removeWithRetry,
  safeRemove,
} from '../../src/experiment/workspace.js';
import type { Workspace } from '../../src/experiment/workspace.js';
import { readinessScenarios, runReadinessScenario } from '../../src/experiment/readiness.js';
import { pilotEntries } from '../../src/experiment/pilot.js';
import type { ProcRunner } from '../../src/experiment/oracle.js';

const MODEL = loadPhaseModel();

function codedError(code: string): Error {
  const error = new Error(`${code}: teardown blocked`) as Error & { code: string };
  error.code = code;
  return error;
}

// A workspace that materialises in memory but whose teardown always throws a Windows-style lock error.
function throwingRemoveWorkspace(): Workspace {
  const inner = memoryWorkspace();
  return {
    create: (label) => inner.create(label),
    write: (dir, files) => inner.write(dir, files),
    read: (dir) => inner.read(dir),
    remove: () => {
      throw codedError('EPERM');
    },
  };
}

// Always-pass Salesforce runner - the semantic result is not what these tests exercise.
function passingRunner(): ProcRunner {
  return () =>
    Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ result: { success: true } }),
      stderr: '',
    });
}

function clock(): () => bigint {
  let c = 0n;
  return () => {
    c += 1_000_000n;
    return c;
  };
}

describe('removeWithRetry - bounded retry over transient teardown errors', () => {
  it('retries a transient error and then succeeds', () => {
    let calls = 0;
    const slept: number[] = [];
    removeWithRetry(
      () => {
        calls += 1;
        if (calls < 3) throw codedError('EPERM');
      },
      'dir',
      { maxRetries: 5, retryDelayMs: 7, sleep: (ms) => slept.push(ms) },
    );
    expect(calls).toBe(3);
    expect(slept).toEqual([7, 7]); // two retries before the third call succeeded
  });

  it('treats EBUSY and ENOTEMPTY as transient too', () => {
    for (const code of ['EBUSY', 'ENOTEMPTY']) {
      let calls = 0;
      removeWithRetry(
        () => {
          calls += 1;
          if (calls < 2) throw codedError(code);
        },
        'dir',
        { maxRetries: 3, retryDelayMs: 0, sleep: () => {} },
      );
      expect(calls).toBe(2);
    }
  });

  it('surfaces a permanent error after the retry budget, never looping', () => {
    let calls = 0;
    const slept: number[] = [];
    expect(() =>
      removeWithRetry(
        () => {
          calls += 1;
          throw codedError('EBUSY');
        },
        'dir',
        { maxRetries: 3, retryDelayMs: 1, sleep: (ms) => slept.push(ms) },
      ),
    ).toThrow(/EBUSY/);
    expect(calls).toBe(4); // initial attempt + 3 bounded retries
    expect(slept).toHaveLength(3);
  });

  it('does not retry a non-transient error', () => {
    let calls = 0;
    const slept: number[] = [];
    expect(() =>
      removeWithRetry(
        () => {
          calls += 1;
          throw codedError('EINVAL');
        },
        'dir',
        { sleep: (ms) => slept.push(ms) },
      ),
    ).toThrow(/EINVAL/);
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });
});

describe('safeRemove / combineCleanup - classify teardown without throwing', () => {
  it('reports ok on a clean teardown', () => {
    const ws = memoryWorkspace();
    const dir = ws.create('scn');
    expect(safeRemove(ws, dir)).toEqual({ ok: true });
  });

  it('classifies a failed teardown without throwing', () => {
    const result = safeRemove(throwingRemoveWorkspace(), 'dir');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/EPERM/);
  });

  it('is ok only when every removal succeeded', () => {
    expect(combineCleanup([{ ok: true }, { ok: true }])).toEqual({ ok: true });
    const merged = combineCleanup([
      { ok: true },
      { ok: false, error: 'a' },
      { ok: false, error: 'b' },
    ]);
    expect(merged.ok).toBe(false);
    expect(merged.error).toBe('a; b');
  });
});

describe('runReadinessScenario - teardown failure is infrastructure, not prototype failure', () => {
  const scenario = () => {
    const found = readinessScenarios().find((s) => s.id === 'R01');
    if (!found) throw new Error('no R01');
    return found;
  };
  const deps = (workspace: Workspace) => ({
    model: MODEL,
    workspace,
    procRunner: passingRunner(),
    provisioner: {
      create: (alias: string) => Promise.resolve({ alias, ready: true, message: 'ok' }),
      remove: () => Promise.resolve(),
    },
    now: clock(),
    alias: 'org',
    prototypeReps: 1,
  });

  it('keeps the prototype, Salesforce and timing outputs when cleanup fails permanently', async () => {
    const record = await runReadinessScenario(scenario(), deps(throwingRemoveWorkspace()));
    // Semantic execution completed and is retained - never overwritten by teardown.
    expect(record.status).toBe('complete');
    expect(record.mutatedOutcome).toBe('pass');
    expect(record.prototype.failed).toBe(false);
    expect(record.prototype.predictionCategory).not.toBe('prototype_failure');
    // Cleanup is classified apart from the semantic result, and stays visible.
    expect(record.workspaceCleanup.ok).toBe(false);
    expect(record.workspaceCleanup.error).toMatch(/EPERM/);
    expect(record.reasons.join(' ')).toMatch(/workspace cleanup failed/);
    expect(record.criteriaMet).toBe(false);
  });

  it('leaves cleanup ok and adds no cleanup reason on a normal teardown', async () => {
    const record = await runReadinessScenario(scenario(), deps(memoryWorkspace()));
    expect(record.workspaceCleanup.ok).toBe(true);
    expect(record.reasons.join(' ')).not.toMatch(/workspace cleanup/);
    expect(record.status).toBe('complete');
    expect(record.criteriaMet).toBe(true);
  });

  it('the pilot lifecycle shares the same hardened cleanup path', async () => {
    const entry = pilotEntries().find(
      (e) => e.candidate.designExpectation.validationOutcome !== 'fail',
    );
    if (!entry) throw new Error('no valid pilot candidate');
    const record = await runReadinessScenario(entry.scenario, deps(throwingRemoveWorkspace()));
    expect(record.workspaceCleanup.ok).toBe(false);
    expect(record.prototype.failed).toBe(false);
    expect(['error', 'prototype_failed']).not.toContain(record.status);
  });
});
