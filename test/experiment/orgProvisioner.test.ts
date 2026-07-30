import { describe, expect, it } from 'vitest';
import { cliProvisioner } from '../../src/experiment/orgProvisioner.js';
import type { ProcResult } from '../../src/experiment/oracle.js';

function runnerFor(create: ProcResult): {
  run: (file: string, args: string[], options?: { cwd: string }) => Promise<ProcResult>;
  calls: { args: string[]; cwd: string | undefined }[];
} {
  const calls: { args: string[]; cwd: string | undefined }[] = [];
  const run = (_file: string, args: string[], options?: { cwd: string }): Promise<ProcResult> => {
    calls.push({ args, cwd: options?.cwd });
    return Promise.resolve(args[1] === 'create' ? create : { code: 0, stdout: '{}', stderr: '' });
  };
  return { run, calls };
}

describe('cliProvisioner', () => {
  it('reports a scratch org ready when create returns a username', async () => {
    const { run } = runnerFor({
      code: 0,
      stdout: JSON.stringify({ status: 0, result: { username: 'u@example.scratch' } }),
      stderr: '',
    });
    const provisioner = cliProvisioner(run, { devHub: 'hub', definitionFile: 'def.json' });
    const result = await provisioner.create('a1');
    expect(result.ready).toBe(true);
  });

  it('reports not ready when create fails', async () => {
    const { run } = runnerFor({
      code: 1,
      stdout: JSON.stringify({ status: 1, message: 'no dev hub' }),
      stderr: '',
    });
    const provisioner = cliProvisioner(run, { devHub: 'hub', definitionFile: 'def.json' });
    const result = await provisioner.create('a1');
    expect(result.ready).toBe(false);
    expect(result.message).toMatch(/no dev hub/);
  });

  it('passes the project cwd to the scratch commands and never throws on teardown', async () => {
    const { run, calls } = runnerFor({
      code: 0,
      stdout: JSON.stringify({ result: { username: 'u@example.scratch' } }),
      stderr: '',
    });
    const provisioner = cliProvisioner(run, {
      devHub: 'hub',
      definitionFile: 'def.json',
      cwd: '/work/session',
    });
    await provisioner.create('a1');
    await provisioner.remove('a1');
    expect(calls.every((call) => call.cwd === '/work/session')).toBe(true);
  });
});
