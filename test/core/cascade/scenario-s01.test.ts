import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import { reconstruct } from '../../../src/core/cascade/reconstruct.js';
import { loadSnapshot } from '../../../src/ingestion/index.js';

const MODEL = loadPhaseModel();
const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/snapshots/s01-account-update.json', import.meta.url),
);

// L1 inventory budget: P50 <= 3 s. In-memory fixture run must sit far under it.
const L1_BUDGET_MS = 3000;

function nodesIn(
  phaseKey: string,
  run = reconstruct(loadSnapshot(FIXTURE), { object: 'Account', event: 'update' }, MODEL),
) {
  return run.skeleton.phases.find((p) => p.phase === phaseKey)?.nodes ?? [];
}

describe('scenario S01 (Account update)', () => {
  const snapshot = loadSnapshot(FIXTURE);
  const target = { object: 'Account', event: 'update' as const };

  it('renders a deterministic skeleton (double run deep-equal, timings aside)', () => {
    const a = reconstruct(snapshot, target, MODEL);
    const b = reconstruct(snapshot, target, MODEL);
    expect(a.skeleton).toEqual(b.skeleton);
    expect(a.nodes).toEqual(b.nodes);
  });

  it('runs L1 within budget', () => {
    const { meta } = reconstruct(snapshot, target, MODEL);
    const l1 = meta.timings.find((t) => t.layer === 'L1');
    expect(l1).toBeDefined();
    expect(l1?.ms).toBeLessThan(L1_BUDGET_MS);
  });

  it('places each participant in its phase', () => {
    const run = reconstruct(snapshot, target, MODEL);
    const names = (phase: string) =>
      nodesIn(phase, run)
        .map((n) => n.apiName)
        .sort();

    // draft flow stays in its phase as an excluded node, so both before-save flows appear
    expect(names('before_save_flows')).toEqual(['Account_Retired', 'Account_Set_Defaults']);
    expect(names('before_triggers')).toEqual(['AccountTrigger']);
    expect(names('custom_validation')).toEqual(['Account.Require_Industry']);
    expect(names('duplicate_rules')).toEqual(['Account.Standard_Account_Duplicate']);
    expect(names('after_triggers')).toEqual(['AccountTrigger']);
    expect(names('workflow_rules')).toEqual(['Account.Legacy_Rating']);
    expect(names('after_save_flows').sort()).toEqual(['Account_Legacy_PB', 'Account_Notify_Owner']);
  });

  it('excludes the draft flow with a reason', () => {
    const run = reconstruct(snapshot, target, MODEL);
    const retired = run.nodes.find((n) => n.apiName === 'Account_Retired');
    expect(retired?.state).toBe('excluded');
    expect(retired?.excludeReason).toBe('inactive');
  });

  it('marks legacy participants', () => {
    const run = reconstruct(snapshot, target, MODEL);
    const pb = run.nodes.find((n) => n.apiName === 'Account_Legacy_PB');
    const wf = run.nodes.find((n) => n.apiName === 'Account.Legacy_Rating');
    expect(pb?.type).toBe('process_builder');
    expect(pb?.legacy).toBe(true);
    expect(wf?.legacy).toBe(true);
  });
});
