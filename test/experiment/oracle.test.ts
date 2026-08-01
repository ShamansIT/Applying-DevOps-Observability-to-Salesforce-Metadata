import { describe, expect, it } from 'vitest';
import {
  apexRunArgs,
  createScratchArgs,
  deleteScratchArgs,
  deployArgs,
  normaliseRuntime,
  normaliseValidation,
  runValidation,
  runValidationPolled,
  validateArgs,
} from '../../src/experiment/oracle.js';
import type { ProcResult } from '../../src/experiment/oracle.js';

function proc(stdout: string, code = 0, stderr = ''): ProcResult {
  return { code, stdout, stderr };
}

describe('argument arrays', () => {
  it('builds a dry-run validation with local tests', () => {
    const args = validateArgs('eval-org');
    expect(args).toContain('--dry-run');
    expect(args).toContain('RunLocalTests');
    expect(args.slice(-2)).toEqual(['eval-org', '--json']);
  });

  it('adds an explicit source dir when one is given', () => {
    const args = validateArgs('eval-org', 'force-app');
    expect(args).toContain('--source-dir');
    expect(args[args.indexOf('--source-dir') + 1]).toBe('force-app');
  });

  it('builds a real deploy without a dry-run flag and with the chosen test level', () => {
    const args = deployArgs('eval-org', { dryRun: false, testLevel: 'NoTestRun' });
    expect(args).not.toContain('--dry-run');
    expect(args).toContain('NoTestRun');
  });

  it('builds an anonymous-apex run against a file', () => {
    const args = apexRunArgs('eval-org', 'scripts/probe.apex');
    expect(args.slice(0, 2)).toEqual(['apex', 'run']);
    expect(args).toContain('scripts/probe.apex');
  });

  it('builds scratch create and delete arrays', () => {
    expect(createScratchArgs('hub', 'def.json', 'a1')).toContain('--target-dev-hub');
    expect(deleteScratchArgs('a1')).toContain('--no-prompt');
  });
});

describe('normaliseRuntime', () => {
  it('reads a runtime exception as a runtime failure', () => {
    const v = normaliseRuntime(
      proc(
        JSON.stringify({ result: { success: false, compiled: true, exceptionMessage: 'boom' } }),
        1,
      ),
    );
    expect(v.outcome).toBe('fail');
    expect(v.failureClass).toBe('runtime_exception');
  });

  it('reads a compile problem as a compile failure', () => {
    const v = normaliseRuntime(
      proc(JSON.stringify({ result: { compiled: false, compileProblem: 'bad token' } }), 1),
    );
    expect(v.failureClass).toBe('compile');
  });

  it('reads a clean run as a runtime pass', () => {
    const v = normaliseRuntime(proc(JSON.stringify({ result: { success: true, compiled: true } })));
    expect(v.outcome).toBe('pass');
  });

  it('treats unparseable apex-run output as infrastructure', () => {
    const v = normaliseRuntime(proc('not json', 1));
    expect(v.infrastructure).toBe('retryable_failure');
  });
});

describe('normaliseValidation', () => {
  it('reads a component failure and classifies it', () => {
    const json = JSON.stringify({
      status: 1,
      result: {
        success: false,
        details: {
          componentFailures: [{ fullName: 'AccountService', problem: 'Field Foo does not exist' }],
        },
      },
    });
    const v = normaliseValidation(proc(json, 1));
    expect(v.outcome).toBe('fail');
    expect(v.failureClass).toBe('metadata_reference');
    expect(v.failingComponents).toEqual(['AccountService']);
    expect(v.actionable).toBe(true);
    expect(v.infrastructure).toBe('ok');
  });

  it('reads a passing validation as an actionable success', () => {
    const v = normaliseValidation(proc(JSON.stringify({ status: 0, result: { success: true } })));
    expect(v.outcome).toBe('pass');
    expect(v.actionable).toBe(true);
  });

  it('treats an auth error as a permanent infrastructure failure', () => {
    const v = normaliseValidation(proc(JSON.stringify({ name: 'NoOrgFound', message: 'no org' })));
    expect(v.infrastructure).toBe('permanent_failure');
    expect(v.actionable).toBe(false);
  });

  it('treats unparseable output as a retryable infrastructure failure', () => {
    const v = normaliseValidation(proc('segfault', 139));
    expect(v.infrastructure).toBe('retryable_failure');
    expect(v.outcome).toBe('not_run');
  });

  it('treats a job-only response as not yet actionable', () => {
    const v = normaliseValidation(proc(JSON.stringify({ result: { id: '0Af000' } })));
    expect(v.actionable).toBe(false);
    expect(v.outcome).toBe('not_run');
  });
});

describe('runValidation', () => {
  it('runs the injected runner and normalises', async () => {
    const calls: string[][] = [];
    const runner = (file: string, args: string[]): Promise<ProcResult> => {
      calls.push([file, ...args]);
      return Promise.resolve(proc(JSON.stringify({ result: { success: true } })));
    };
    const v = await runValidation('eval-org', runner);
    expect(v.outcome).toBe('pass');
    expect(calls[0]?.[0]).toBe('sf');
    expect(calls[0]).toContain('--dry-run');
  });

  it('passes cwd options and an explicit source dir when options are given', async () => {
    let seenArgs: string[] = [];
    let seenCwd: string | undefined;
    const runner = (
      _file: string,
      args: string[],
      options?: { cwd: string },
    ): Promise<ProcResult> => {
      seenArgs = args;
      seenCwd = options?.cwd;
      return Promise.resolve(proc(JSON.stringify({ result: { success: true } })));
    };
    await runValidation('eval-org', runner, { cwd: '/work/scn', timeoutMs: 1000 });
    expect(seenArgs).toContain('--source-dir');
    expect(seenCwd).toBe('/work/scn');
  });
});

const queued = JSON.stringify({ result: { id: '0Af000', status: 'Queued' } });
const succeeded = JSON.stringify({ result: { success: true, status: 'Succeeded' } });

function isReport(args: string[]): boolean {
  return args[2] === 'report';
}

describe('runValidationPolled', () => {
  it('returns at once when the first response is already final', async () => {
    const runner = (): Promise<ProcResult> => Promise.resolve(proc(succeeded));
    const polled = await runValidationPolled('eval-org', runner);
    expect(polled.result.outcome).toBe('pass');
    expect(polled.pollCount).toBe(0);
    expect(polled.pollingEvents).toEqual([]);
  });

  it('polls a queued deploy through deploy report to a final result', async () => {
    let reports = 0;
    const runner = (_file: string, args: string[]): Promise<ProcResult> => {
      if (isReport(args)) {
        reports += 1;
        return Promise.resolve(proc(reports >= 2 ? succeeded : queued));
      }
      return Promise.resolve(proc(queued));
    };
    const polled = await runValidationPolled('eval-org', runner, undefined, { maxPolls: 5 });
    expect(polled.jobId).toBe('0Af000');
    expect(polled.result.outcome).toBe('pass');
    expect(polled.pollCount).toBe(2);
    expect(polled.pollingEvents).toHaveLength(2);
    expect(polled.timedOut).toBe(false);
  });

  it('times out as retryable infrastructure when the deploy never settles', async () => {
    const runner = (): Promise<ProcResult> => Promise.resolve(proc(queued));
    const polled = await runValidationPolled('eval-org', runner, undefined, { maxPolls: 3 });
    expect(polled.timedOut).toBe(true);
    expect(polled.pollCount).toBe(3);
    expect(polled.result.infrastructure).toBe('retryable_failure');
  });

  it('treats a malformed first response as infrastructure without polling', async () => {
    const runner = (): Promise<ProcResult> => Promise.resolve(proc('not json', 1));
    const polled = await runValidationPolled('eval-org', runner);
    expect(polled.pollCount).toBe(0);
    expect(polled.result.infrastructure).toBe('retryable_failure');
  });
});
