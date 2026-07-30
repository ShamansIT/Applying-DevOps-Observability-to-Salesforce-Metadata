import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { runScenarioLive, runScenarios } from '../../src/experiment/liveRunner.js';
import type { LiveDeps } from '../../src/experiment/liveRunner.js';
import { generateBenchmark, topologyFilesIndex } from '../../src/experiment/scenarioGenerator.js';
import type { ProcResult } from '../../src/experiment/oracle.js';
import { memoryWorkspace } from '../../src/experiment/workspace.js';

const MODEL = loadPhaseModel();
const FILES = topologyFilesIndex();
const { main } = generateBenchmark();

function clock(): () => bigint {
  let c = 0n;
  return () => {
    c += 1_000_000n;
    return c;
  };
}

function deps(procRunner: LiveDeps['procRunner']): LiveDeps {
  return {
    baseFilesFor: (id) => FILES.get(id) ?? {},
    model: MODEL,
    procRunner,
    now: clock(),
    alias: 'eval-org',
    workspace: memoryWorkspace(),
  };
}

const failJson = JSON.stringify({
  result: {
    success: false,
    details: { componentFailures: [{ fullName: 'X', problem: 'Field does not exist' }] },
  },
});

describe('runScenarioLive', () => {
  it('runs one scenario end to end from mutation to scenario run', async () => {
    const scenario = main[0];
    if (!scenario) throw new Error('no scenario');
    const runner = (): Promise<ProcResult> =>
      Promise.resolve({ code: 1, stdout: failJson, stderr: '' });
    const attempt = await runScenarioLive(scenario, deps(runner));
    expect(attempt.status).toBe('complete');
    expect(attempt.scenarioRun.scenarioId).toBe(scenario.id);
    expect(attempt.oracle.outcome).toBe('fail');
    expect(attempt.materialisedChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a setup failure as a status, not an exception', async () => {
    const scenario = main[0];
    if (!scenario) throw new Error('no scenario');
    const badDeps = deps(() => Promise.resolve({ code: 0, stdout: '{}', stderr: '' }));
    badDeps.baseFilesFor = () => ({ x: 'not a project' }); // mutation target absent
    const attempt = await runScenarioLive(scenario, badDeps);
    expect(attempt.status).toBe('setup_failed');
    expect(attempt.prototype.failed).toBe(true);
  });
});

describe('scenario parity and repetitions', () => {
  it('materialises to disk and runs the oracle with cwd on that project', async () => {
    const scenario = main[0];
    if (!scenario) throw new Error('no scenario');
    const seenCwd: (string | undefined)[] = [];
    const runner = (
      _file: string,
      _args: string[],
      options?: { cwd: string },
    ): Promise<ProcResult> => {
      seenCwd.push(options?.cwd);
      return Promise.resolve({ code: 1, stdout: failJson, stderr: '' });
    };
    const attempt = await runScenarioLive(scenario, deps(runner));
    expect(attempt.prototypeRepetitions).toHaveLength(5);
    expect(attempt.prototypeDeterministic).toBe(true);
    expect(attempt.raw.materialisedProjectHash).toBe(attempt.materialisedChecksum);
    // The oracle ran against the materialised workspace directory, not the process cwd.
    expect(seenCwd.some((cwd) => typeof cwd === 'string' && cwd.startsWith('mem://'))).toBe(true);
  });

  it('provisions and tears down a disposable org for a runtime scenario', async () => {
    const scenario = main.find((s) =>
      s.mutationManifest.requiredOracleStages.includes('runtime_transaction'),
    );
    if (!scenario) throw new Error('no runtime scenario');
    const runner = (_file: string, args: string[]): Promise<ProcResult> =>
      Promise.resolve(
        args[0] === 'apex'
          ? {
              code: 1,
              stdout: JSON.stringify({
                result: { success: false, compiled: true, exceptionMessage: 'boom at runtime' },
              }),
              stderr: '',
            }
          : { code: 0, stdout: JSON.stringify({ result: { success: true } }), stderr: '' },
      );
    const created: string[] = [];
    const removed: string[] = [];
    const provisioner = {
      create: (alias: string) => {
        created.push(alias);
        return Promise.resolve({ alias, ready: true, message: 'ok' });
      },
      remove: (alias: string) => {
        removed.push(alias);
        return Promise.resolve();
      },
    };
    const attempt = await runScenarioLive(scenario, { ...deps(runner), provisioner });
    expect(attempt.oracle.outcome).toBe('fail');
    expect(attempt.oracle.failureClass).toBe('runtime_exception');
    expect(created).toHaveLength(1);
    expect(removed).toEqual(created);
  });
});

describe('runScenarios', () => {
  it('retries an infrastructure failure then completes', async () => {
    const scenario = main[0];
    if (!scenario) throw new Error('no scenario');
    let call = 0;
    const runner = (): Promise<ProcResult> => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? { code: 139, stdout: 'segfault', stderr: '' } // infrastructure, retryable
          : { code: 0, stdout: JSON.stringify({ result: { success: true } }), stderr: '' },
      );
    };
    const batch = await runScenarios([scenario], deps(runner), { maxInfraRetries: 2 });
    expect(batch.runs).toHaveLength(1);
    expect(batch.infrastructureFailures.length).toBeGreaterThanOrEqual(1);
    expect(call).toBe(2);
  });
});
