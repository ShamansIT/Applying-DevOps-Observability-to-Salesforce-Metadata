import { describe, expect, it } from 'vitest';
import { loadPhaseModel, phaseIndex } from '../../../src/core/phases/phaseModel.js';
import { reconstruct } from '../../../src/core/cascade/reconstruct.js';
import type { CascadeEmission } from '../../../src/core/cascade/reconstruct.js';
import type { AnalysisTarget } from '../../../src/core/cascade/inventory.js';
import type { MetadataComponent, OrgSnapshot } from '../../../src/ingestion/index.js';

const MODEL = loadPhaseModel();

const COMPONENTS: MetadataComponent[] = [
  {
    type: 'ApexTrigger',
    fullName: 'AccountTrigger',
    object: 'Account',
    attributes: { events: ['before update', 'after update'], status: 'Active' },
  },
  {
    type: 'Flow',
    fullName: 'Account_Before_Save',
    object: 'Account',
    attributes: { triggerType: 'RecordBeforeSave', status: 'Active' },
  },
  {
    type: 'ValidationRule',
    fullName: 'Account.Require_Industry',
    object: 'Account',
    attributes: { active: true },
  },
];

const SNAPSHOT: OrgSnapshot = {
  meta: {
    apiVersion: '67.0',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'fixture',
    toolVersion: '0.0.1',
  },
  components: COMPONENTS,
};

const TARGET: AnalysisTarget = { object: 'Account', event: 'update' };

// Fixed clock so timing deltas are stable in tests.
function stepClock(): () => number {
  let t = 0;
  return () => (t += 5);
}

describe('reconstruct (cascade L1+L2)', () => {
  it('emits skeleton after L1 then after L2', () => {
    const emissions: CascadeEmission[] = [];
    reconstruct(SNAPSHOT, TARGET, MODEL, {
      emit: (e) => emissions.push(e),
      clock: stepClock(),
    });
    expect(emissions.map((e) => e.layer)).toEqual(['L1', 'L2']);
    expect(emissions[0]?.skeleton.nodeCount).toBe(0); // L1 backbone carries no nodes yet
    expect(emissions[0]?.skeleton.candidateCount).toBe(3);
    expect(emissions[1]?.skeleton.nodeCount).toBeGreaterThan(0);
  });

  it('places nodes in pinned phase order', () => {
    const { skeleton } = reconstruct(SNAPSHOT, TARGET, MODEL, { clock: stepClock() });
    expect(skeleton.phases.map((p) => p.phase)).toEqual(MODEL.phases.map((p) => p.key));
    for (const group of skeleton.phases) {
      for (const node of group.nodes) {
        expect(node.phase).toBe(group.phase);
      }
    }
    // before-triggers group sorts ahead of after-triggers group in the backbone
    const before = phaseIndex(MODEL, 'before_triggers');
    const after = phaseIndex(MODEL, 'after_triggers');
    expect(before).toBeLessThan(after);
  });

  it('sorts nodes by stable id for determinism', () => {
    const { nodes } = reconstruct(SNAPSHOT, TARGET, MODEL, { clock: stepClock() });
    const ids = nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('produces byte-identical graph output across two runs, ignoring timings', () => {
    const a = reconstruct(SNAPSHOT, TARGET, MODEL, { clock: stepClock() });
    const b = reconstruct(SNAPSHOT, TARGET, MODEL, { clock: stepClock() });
    expect(a.nodes).toEqual(b.nodes);
    expect(a.skeleton).toEqual(b.skeleton);
  });

  it('records per-layer timings and empty degrade list in meta', () => {
    const { meta } = reconstruct(SNAPSHOT, TARGET, MODEL, { clock: stepClock() });
    expect(meta.timings.map((t) => t.layer)).toEqual(['L1', 'L2']);
    expect(meta.timings.every((t) => t.ms >= 0)).toBe(true);
    expect(meta.degraded).toEqual([]);
    expect(meta.snapshotApiVersion).toBe('67.0');
    expect(meta.phaseModelApiVersion).toBe('67.0');
  });

  it('carries the split trigger into both trigger phases', () => {
    const { skeleton } = reconstruct(SNAPSHOT, TARGET, MODEL, { clock: stepClock() });
    const before = skeleton.phases.find((p) => p.phase === 'before_triggers');
    const after = skeleton.phases.find((p) => p.phase === 'after_triggers');
    expect(before?.nodes.some((n) => n.apiName === 'AccountTrigger')).toBe(true);
    expect(after?.nodes.some((n) => n.apiName === 'AccountTrigger')).toBe(true);
  });
});
