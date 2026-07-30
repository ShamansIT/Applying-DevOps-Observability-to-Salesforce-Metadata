import { describe, expect, it } from 'vitest';
import { buildScenario } from '../../src/experiment/materialise.js';
import type { FileMap, MutationSpec } from '../../src/experiment/mutation.js';
import { projectChecksum } from '../../src/experiment/project.js';

const BASE: FileMap = {
  'classes/AccountService.cls': 'public class AccountService { public static void run() {} }',
  'triggers/AccountTrigger.trigger': 'trigger AccountTrigger on Account (before update) {}',
};

function spec(extra: Partial<MutationSpec> = {}): MutationSpec {
  return {
    id: 'S02-01',
    family: 'missing_field_reference',
    seed: 1,
    baseTopologyId: 'T01',
    target: { object: 'Account', event: 'update' },
    file: 'classes/AccountService.cls',
    token: 'run',
    ...extra,
  };
}

describe('buildScenario', () => {
  it('writes a manifest into the file map and stamps both checksums', () => {
    const built = buildScenario('S02-01', BASE, spec());
    expect(built.files['mutation-manifest.json']).toContain('"family": "missing_field_reference"');
    expect(built.baseChecksum).toBe(projectChecksum(BASE));
    expect(built.mutatedChecksum).not.toBe(built.baseChecksum);
  });

  it('is deterministic', () => {
    expect(buildScenario('S02-01', BASE, spec())).toEqual(buildScenario('S02-01', BASE, spec()));
  });

  it('rejects a base whose checksum does not match', () => {
    expect(() => {
      buildScenario('S02-01', BASE, spec(), 'deadbeef');
    }).toThrow(/base checksum mismatch/);
  });
});
