import { describe, expect, it } from 'vitest';
import { runStageOracle } from '../../src/experiment/stageOracle.js';
import type { StageContext } from '../../src/experiment/stageOracle.js';
import type { ProcResult } from '../../src/experiment/oracle.js';
import type { OracleStage } from '../../src/experiment/mutation.js';
import { memoryWorkspace } from '../../src/experiment/workspace.js';

const PASS = JSON.stringify({ result: { success: true } });
const COMPONENT_FAIL = JSON.stringify({
  result: {
    success: false,
    details: { componentFailures: [{ fullName: 'X', problem: 'Field does not exist' }] },
  },
});
const RUNTIME_FAIL = JSON.stringify({
  result: { success: false, compiled: true, exceptionMessage: 'boom' },
});

function context(stages: OracleStage[], run: StageContext['run']): StageContext {
  return {
    stages,
    dir: 'mem://p/0',
    alias: 'eval-org',
    target: { object: 'Account', event: 'update' },
    run,
    workspace: memoryWorkspace(),
    timeoutMs: 1000,
  };
}

describe('runStageOracle', () => {
  it('runs a single dry-run deploy for static stages', async () => {
    const seen: string[][] = [];
    const run = (_file: string, args: string[]): Promise<ProcResult> => {
      seen.push(args);
      return Promise.resolve({ code: 1, stdout: COMPONENT_FAIL, stderr: '' });
    };
    const outcome = await runStageOracle(context(['metadata_validation'], run));
    expect(outcome.combined.outcome).toBe('fail');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('--dry-run');
  });

  it('reports a runtime stage as not-run without a provisioner', async () => {
    const run = (): Promise<ProcResult> => Promise.resolve({ code: 0, stdout: PASS, stderr: '' });
    const outcome = await runStageOracle(context(['runtime_transaction'], run));
    expect(outcome.combined.outcome).toBe('not_run');
    expect(outcome.combined.infrastructure).toBe('permanent_failure');
  });

  it('provisions, deploys, probes and tears down for a runtime stage', async () => {
    const created: string[] = [];
    const removed: string[] = [];
    const run = (_file: string, args: string[]): Promise<ProcResult> =>
      Promise.resolve(
        args[0] === 'apex'
          ? { code: 1, stdout: RUNTIME_FAIL, stderr: '' }
          : { code: 0, stdout: PASS, stderr: '' },
      );
    const ctx: StageContext = {
      ...context(['runtime_transaction'], run),
      provisioner: {
        create: (alias) => {
          created.push(alias);
          return Promise.resolve({ alias, ready: true, message: 'ok' });
        },
        remove: (alias) => {
          removed.push(alias);
          return Promise.resolve();
        },
      },
      disposableAlias: 'eval-org-scn',
    };
    const outcome = await runStageOracle(ctx);
    expect(outcome.combined.failureClass).toBe('runtime_exception');
    expect(created).toEqual(['eval-org-scn']);
    expect(removed).toEqual(['eval-org-scn']);
  });

  it('stops at a failed deploy before running the runtime probe', async () => {
    const apexCalls: number[] = [];
    const run = (_file: string, args: string[]): Promise<ProcResult> => {
      if (args[0] === 'apex') apexCalls.push(1);
      return Promise.resolve(
        args[0] === 'apex'
          ? { code: 0, stdout: PASS, stderr: '' }
          : { code: 1, stdout: COMPONENT_FAIL, stderr: '' },
      );
    };
    const ctx: StageContext = {
      ...context(['runtime_transaction'], run),
      provisioner: {
        create: (alias) => Promise.resolve({ alias, ready: true, message: 'ok' }),
        remove: () => Promise.resolve(),
      },
      disposableAlias: 'eval-org-scn',
    };
    const outcome = await runStageOracle(ctx);
    expect(outcome.combined.outcome).toBe('fail');
    expect(apexCalls).toHaveLength(0);
  });
});
