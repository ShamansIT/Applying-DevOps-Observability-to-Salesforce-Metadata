import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFlow } from '../../../src/core/parse/flowParser.js';

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/parse/flows/${name}`, import.meta.url)),
    'utf8',
  );
}

describe('parseFlow (L3 static)', () => {
  it('reads start element, triggerType, object and record-trigger type', () => {
    const flow = parseFlow(fixture('Account_After_Save.flow-meta.xml'));
    expect(flow.triggerType).toBe('RecordAfterSave');
    expect(flow.object).toBe('Account');
    expect(flow.recordTriggerType).toBe('Update');
    expect(flow.hasEntryCriteria).toBe(true);
    expect(flow.errors).toEqual([]);
  });

  it('collects record references and subflow calls', () => {
    const flow = parseFlow(fixture('Account_After_Save.flow-meta.xml'));
    const updates = flow.references.filter((r) => r.kind === 'recordUpdate');
    expect(updates[0]?.object).toBe('Contact');
    expect(flow.references.some((r) => r.kind === 'recordLookup' && r.object === 'User')).toBe(
      true,
    );
    expect(flow.subflows).toEqual(['Shared_Account_Logic']);
    expect(
      flow.references.some((r) => r.kind === 'subflow' && r.flowName === 'Shared_Account_Logic'),
    ).toBe(true);
  });

  it('reads explicit trigger order when set', () => {
    const flow = parseFlow(fixture('Account_Before_Save_Ordered.flow-meta.xml'));
    expect(flow.triggerType).toBe('RecordBeforeSave');
    expect(flow.recordTriggerType).toBe('CreateAndUpdate');
    expect(flow.triggerOrder).toBe(200);
  });

  it('leaves trigger order unset when absent', () => {
    const flow = parseFlow(fixture('Account_After_Save.flow-meta.xml'));
    expect(flow.triggerOrder).toBeUndefined();
  });

  it('captures malformed XML as error without throwing', () => {
    const flow = parseFlow(fixture('Malformed.flow-meta.xml'));
    expect(flow.errors.length).toBeGreaterThan(0);
    expect(flow.references).toEqual([]);
  });

  it('reports missing root on non-flow XML', () => {
    const flow = parseFlow('<Other></Other>');
    expect(flow.errors[0]).toMatch(/no Flow root/i);
  });
});
