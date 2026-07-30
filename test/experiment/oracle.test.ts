import { describe, expect, it } from 'vitest';
import {
  createScratchArgs,
  deleteScratchArgs,
  normaliseValidation,
  runValidation,
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

  it('builds scratch create and delete arrays', () => {
    expect(createScratchArgs('hub', 'def.json', 'a1')).toContain('--target-dev-hub');
    expect(deleteScratchArgs('a1')).toContain('--no-prompt');
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
    const runner = async (file: string, args: string[]): Promise<ProcResult> => {
      calls.push([file, ...args]);
      return proc(JSON.stringify({ result: { success: true } }));
    };
    const v = await runValidation('eval-org', runner);
    expect(v.outcome).toBe('pass');
    expect(calls[0]?.[0]).toBe('sf');
    expect(calls[0]).toContain('--dry-run');
  });
});
