import { describe, expect, it } from 'vitest';
import { inventory } from '../../../src/core/cascade/inventory.js';
import type { AnalysisTarget } from '../../../src/core/cascade/inventory.js';
import type { MetadataComponent, OrgSnapshot } from '../../../src/ingestion/index.js';

function snapshotOf(components: MetadataComponent[]): OrgSnapshot {
  return {
    meta: {
      apiVersion: '67.0',
      capturedAt: '2026-01-01T00:00:00.000Z',
      source: 'fixture',
      toolVersion: '0.0.1',
    },
    components,
  };
}

const ACCOUNT: MetadataComponent[] = [
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
    attributes: {
      processType: 'AutoLaunchedFlow',
      triggerType: 'RecordBeforeSave',
      status: 'Active',
    },
  },
  {
    type: 'Flow',
    fullName: 'Account_After_Save',
    object: 'Account',
    attributes: {
      processType: 'AutoLaunchedFlow',
      triggerType: 'RecordAfterSave',
      status: 'Active',
    },
  },
  {
    type: 'ValidationRule',
    fullName: 'Account.Require_Industry',
    object: 'Account',
    attributes: { active: true },
  },
  {
    type: 'DuplicateRule',
    fullName: 'Account.Standard_Account_Duplicate',
    object: 'Account',
    attributes: { active: true },
  },
];

const UPDATE: AnalysisTarget = { object: 'Account', event: 'update' };

describe('inventory (L1)', () => {
  it('collects record-triggered participants for object and update event', () => {
    const items = inventory(snapshotOf(ACCOUNT), UPDATE);
    const kinds = items.map((i) => i.nodeType).sort();
    expect(kinds).toEqual([
      'apex_trigger',
      'duplicate_rule',
      'flow_after',
      'flow_before',
      'validation_rule',
    ]);
  });

  it('splits Apex trigger timings that match target event', () => {
    const items = inventory(snapshotOf(ACCOUNT), UPDATE);
    const trigger = items.find((i) => i.nodeType === 'apex_trigger');
    expect(trigger?.timings).toEqual(['after', 'before']);
  });

  it('keeps after-save flow on delete but drops before-save and validation', () => {
    const items = inventory(snapshotOf(ACCOUNT), { object: 'Account', event: 'delete' });
    const kinds = items.map((i) => i.nodeType).sort();
    expect(kinds).toEqual(['flow_after']);
  });

  it('drops trigger when no event verb matches target', () => {
    const snap = snapshotOf([
      {
        type: 'ApexTrigger',
        fullName: 'OnlyInsert',
        object: 'Account',
        attributes: { events: ['before insert'] },
      },
    ]);
    expect(inventory(snap, UPDATE)).toHaveLength(0);
  });

  it('maps insert verb to create event', () => {
    const snap = snapshotOf([
      {
        type: 'ApexTrigger',
        fullName: 'OnlyInsert',
        object: 'Account',
        attributes: { events: ['before insert'] },
      },
    ]);
    const items = inventory(snap, { object: 'Account', event: 'create' });
    expect(items).toHaveLength(1);
    expect(items[0]?.timings).toEqual(['before']);
  });

  it('marks Process Builder flow as legacy process_builder', () => {
    const snap = snapshotOf([
      {
        type: 'Flow',
        fullName: 'Account_PB',
        object: 'Account',
        attributes: { processType: 'Workflow', status: 'Active' },
      },
    ]);
    const items = inventory(snap, UPDATE);
    expect(items[0]?.nodeType).toBe('process_builder');
    expect(items[0]?.legacy).toBe(true);
  });

  it('ignores components bound to other objects', () => {
    const snap = snapshotOf([
      {
        type: 'ValidationRule',
        fullName: 'Contact.Rule',
        object: 'Contact',
        attributes: { active: true },
      },
    ]);
    expect(inventory(snap, UPDATE)).toHaveLength(0);
  });

  it('reads active flag from active boolean and status string', () => {
    const snap = snapshotOf([
      {
        type: 'ValidationRule',
        fullName: 'Account.Off',
        object: 'Account',
        attributes: { active: false },
      },
      {
        type: 'Flow',
        fullName: 'Account_Inactive',
        object: 'Account',
        attributes: { triggerType: 'RecordBeforeSave', status: 'Draft' },
      },
    ]);
    const items = inventory(snap, UPDATE);
    expect(items.every((i) => i.active === false)).toBe(true);
  });
});
