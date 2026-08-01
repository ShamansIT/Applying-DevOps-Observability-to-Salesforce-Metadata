import { describe, expect, it } from 'vitest';
import { orgCheck } from '../../src/experiment/orgCheck.js';
import type { ProcResult } from '../../src/experiment/oracle.js';
import type { FileMap } from '../../src/experiment/mutation.js';

function runner(overrides: { display?: string; list?: string; versionCode?: number } = {}) {
  return (_file: string, args: string[]): Promise<ProcResult> => {
    if (args[0] === '--version') {
      return Promise.resolve({
        code: overrides.versionCode ?? 0,
        stdout: '@salesforce/cli/2.119.8 win32-x64 node-v22',
        stderr: '',
      });
    }
    if (args[1] === 'display') {
      return Promise.resolve({
        code: 0,
        stdout: overrides.display ?? JSON.stringify({ result: { connectedStatus: 'Connected' } }),
        stderr: '',
      });
    }
    if (args[1] === 'list') {
      return Promise.resolve({
        code: 0,
        stdout:
          overrides.list ??
          JSON.stringify({ result: { devHubs: [{ alias: 'Hub', connectedStatus: 'Connected' }] } }),
        stderr: '',
      });
    }
    return Promise.resolve({ code: 0, stdout: '{}', stderr: '' });
  };
}

const goodTemplate: FileMap = {
  'sfdx-project.json': JSON.stringify({ sourceApiVersion: '67.0' }),
  'config/project-scratch-def.json': '{}',
};

describe('orgCheck', () => {
  it('is ready when the cli, project, api and storage all check out and no org is asked for', async () => {
    const report = await orgCheck({
      run: runner(),
      projectTemplate: goodTemplate,
      canWriteResults: true,
      expectedApiVersion: '67.0',
    });
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.name === 'auth')?.status).toBe('skipped');
    expect(report.checks.find((c) => c.name === 'dev-hub')?.status).toBe('skipped');
  });

  it('confirms a connected auth alias and Dev Hub', async () => {
    const report = await orgCheck({
      run: runner(),
      projectTemplate: goodTemplate,
      canWriteResults: true,
      expectedApiVersion: '67.0',
      devHub: 'Hub',
      targetOrg: 'Hub',
    });
    expect(report.checks.find((c) => c.name === 'auth')?.status).toBe('ok');
    expect(report.checks.find((c) => c.name === 'dev-hub')?.status).toBe('ok');
    expect(report.ready).toBe(true);
  });

  it('blocks when the Dev Hub is not authenticated', async () => {
    const report = await orgCheck({
      run: runner({ list: JSON.stringify({ result: { devHubs: [] } }) }),
      projectTemplate: goodTemplate,
      canWriteResults: true,
      expectedApiVersion: '67.0',
      devHub: 'Missing',
    });
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.name === 'dev-hub')?.status).toBe('blocked');
  });

  it('blocks on a project template with the wrong api version', async () => {
    const report = await orgCheck({
      run: runner(),
      projectTemplate: {
        'sfdx-project.json': JSON.stringify({ sourceApiVersion: '58.0' }),
        'config/project-scratch-def.json': '{}',
      },
      canWriteResults: true,
      expectedApiVersion: '67.0',
    });
    expect(report.checks.find((c) => c.name === 'api')?.status).toBe('blocked');
    expect(report.ready).toBe(false);
  });

  it('blocks when result storage is not writable', async () => {
    const report = await orgCheck({
      run: runner(),
      projectTemplate: goodTemplate,
      canWriteResults: false,
      expectedApiVersion: '67.0',
    });
    expect(report.checks.find((c) => c.name === 'storage')?.status).toBe('blocked');
    expect(report.ready).toBe(false);
  });
});
