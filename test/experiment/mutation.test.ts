import { describe, expect, it } from 'vitest';
import { applyMutation } from '../../src/experiment/mutation.js';
import type { FileMap, MutationFamily, MutationSpec } from '../../src/experiment/mutation.js';

const TRIGGER = 'force-app/triggers/AccountTrigger.trigger';
const SERVICE = 'force-app/classes/AccountService.cls';
const FLOW = 'force-app/flows/Account_After_Save.flow-meta.xml';

const BASE: FileMap = {
  [TRIGGER]:
    'trigger AccountTrigger on Account (before update) { AccountService.run(Trigger.new); }',
  [SERVICE]: 'public class AccountService { public static void run(List<Account> a) {} }',
  [FLOW]: '<Flow><status>Active</status><subflow><flowName>Helper</flowName></subflow></Flow>',
};

function spec(family: MutationFamily, extra: Partial<MutationSpec> = {}): MutationSpec {
  return {
    id: `M-${family}`,
    family,
    seed: 1,
    baseTopologyId: 'T01',
    target: { object: 'Account', event: 'update' },
    ...extra,
  };
}

describe('applyMutation', () => {
  it('is deterministic - same base and spec give byte-equal output', () => {
    const s = spec('missing_field_reference', { file: SERVICE, token: 'run', replacement: 'gone' });
    expect(applyMutation(BASE, s)).toEqual(applyMutation(BASE, s));
  });

  it('does not mutate the base map in place', () => {
    const before = JSON.stringify(BASE);
    applyMutation(BASE, spec('control_noop', { file: TRIGGER }));
    expect(JSON.stringify(BASE)).toBe(before);
  });

  it('swaps a field reference and marks it an invalid static-direct reference break', () => {
    const { files, manifest } = applyMutation(
      BASE,
      spec('missing_field_reference', { file: SERVICE, token: 'run', replacement: 'run__missing' }),
    );
    expect(files[SERVICE]).toContain('run__missing');
    expect(manifest.expectedValidity).toBe('invalid');
    expect(manifest.expectedFailureClass).toBe('metadata_reference');
    expect(manifest.detectability).toBe('static-direct');
    expect(manifest.changedFiles).toEqual([SERVICE]);
    expect(manifest.changedFileHashes[SERVICE]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes a dependency and records the deletion', () => {
    const { files, manifest } = applyMutation(
      BASE,
      spec('missing_dependency', { removeFile: SERVICE }),
    );
    expect(files[SERVICE]).toBeUndefined();
    expect(manifest.expectedFailureClass).toBe('missing_dependency');
    expect(manifest.changedFileHashes[SERVICE]).toBe('deleted');
  });

  it('breaks apex compilation by removing a closing brace', () => {
    const { files, manifest } = applyMutation(BASE, spec('apex_compile_break', { file: TRIGGER }));
    expect((files[TRIGGER]?.match(/}/g) ?? []).length).toBe(0);
    expect(manifest.expectedFailureClass).toBe('compile');
    expect(manifest.expectedValidity).toBe('invalid');
  });

  it('treats a control change as valid and out of scope', () => {
    const { manifest } = applyMutation(BASE, spec('control_noop', { file: TRIGGER }));
    expect(manifest.expectedValidity).toBe('valid');
    expect(manifest.expectedFailureClass).toBe('none');
    expect(manifest.detectability).toBe('out-of-scope');
    expect(manifest.expectedAffectedComponents).toEqual([]);
  });

  it('marks a runtime failure valid at deploy but needing the runtime stage', () => {
    const { manifest } = applyMutation(BASE, spec('runtime_failure', { file: SERVICE }));
    expect(manifest.expectedValidity).toBe('valid');
    expect(manifest.expectedFailureClass).toBe('runtime_exception');
    expect(manifest.detectability).toBe('runtime-only');
    expect(manifest.requiredOracleStages).toContain('runtime_transaction');
  });

  it('deactivates a component without breaking the deploy', () => {
    const { files, manifest } = applyMutation(
      BASE,
      spec('inactive_component', { file: FLOW, token: 'Active', replacement: 'Inactive' }),
    );
    expect(files[FLOW]).toContain('<status>Inactive</status>');
    expect(manifest.expectedValidity).toBe('valid');
    expect(manifest.detectability).toBe('out-of-scope');
  });

  it('refuses a mutation that would be a silent no-op', () => {
    expect(() => {
      applyMutation(BASE, spec('missing_field_reference', { file: SERVICE, token: 'absent' }));
    }).toThrow(/no-op/);
  });

  it('refuses to mutate a file absent from the base', () => {
    expect(() => {
      applyMutation(BASE, spec('control_noop', { file: 'nope.cls' }));
    }).toThrow(/not in the base project/);
  });

  it('produces a real change and a well-formed manifest for every family', () => {
    const cases: [MutationFamily, Partial<MutationSpec>][] = [
      ['control_noop', { file: TRIGGER }],
      ['valid_impacting', { file: TRIGGER }],
      ['missing_field_reference', { file: SERVICE, token: 'run' }],
      ['missing_dependency', { removeFile: SERVICE }],
      ['apex_compile_break', { file: TRIGGER }],
      ['flow_reference_break', { file: FLOW, token: 'Helper' }],
      ['cross_object_impact', { file: TRIGGER }],
      ['recursion_risk', { file: TRIGGER }],
      ['inactive_component', { file: FLOW, token: 'Active' }],
      ['dynamic_unresolved', { file: TRIGGER }],
      ['test_only_failure', { file: SERVICE }],
      ['runtime_failure', { file: SERVICE }],
    ];
    for (const [family, extra] of cases) {
      const { manifest } = applyMutation(BASE, spec(family, extra));
      expect(manifest.family).toBe(family);
      expect(manifest.changedFiles.length).toBeGreaterThan(0);
      expect(manifest.requiredOracleStages.length).toBeGreaterThan(0);
    }
  });
});
