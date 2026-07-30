import { describe, expect, it } from 'vitest';
import { validateCleanTopology } from '../../src/experiment/cleanTopology.js';
import { generateTopologyInstances } from '../../src/experiment/topologyGenerator.js';
import { memoryWorkspace } from '../../src/experiment/workspace.js';
import type { ProcResult } from '../../src/experiment/oracle.js';

const instance = generateTopologyInstances(1, 'clean').find((i) => i.params.triggers > 0);

const PASS = JSON.stringify({ result: { success: true } });
const FAIL = JSON.stringify({
  result: {
    success: false,
    details: { componentFailures: [{ fullName: 'X', problem: 'invalid field' }] },
  },
});

describe('validateCleanTopology', () => {
  it('reports a clean topology deployable when the dry-run passes', async () => {
    if (!instance) throw new Error('no programmatic instance');
    const run = (): Promise<ProcResult> => Promise.resolve({ code: 0, stdout: PASS, stderr: '' });
    const result = await validateCleanTopology(instance, {
      workspace: memoryWorkspace(),
      run,
      alias: 'eval-org',
    });
    expect(result.deployable).toBe(true);
    expect(result.componentsComplete).toBe(true);
    expect(result.components.find((c) => c.kind === 'apex_trigger')?.present).toBeGreaterThan(0);
  });

  it('refuses a base whose clean dry-run fails', async () => {
    if (!instance) throw new Error('no programmatic instance');
    const run = (): Promise<ProcResult> => Promise.resolve({ code: 1, stdout: FAIL, stderr: '' });
    const result = await validateCleanTopology(instance, {
      workspace: memoryWorkspace(),
      run,
      alias: 'eval-org',
    });
    expect(result.deployable).toBe(false);
    expect(result.outcome).toBe('fail');
  });
});
