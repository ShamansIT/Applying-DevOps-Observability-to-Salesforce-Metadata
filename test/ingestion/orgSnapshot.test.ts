import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { componentsForObject, loadSnapshot, validateSnapshot } from '../../src/ingestion/index.js';
import type { OrgSnapshot } from '../../src/ingestion/index.js';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/snapshots/example-account.json', import.meta.url),
);

describe('loadSnapshot (offline fixtures mode)', () => {
  it('loads fixture snapshot with zero network', () => {
    const snapshot = loadSnapshot(FIXTURE);
    expect(snapshot.meta.source).toBe('fixture');
    expect(snapshot.components.length).toBeGreaterThan(0);
  });

  it('finds components bound to target object (case-insensitive)', () => {
    const snapshot = loadSnapshot(FIXTURE);
    const onAccount = componentsForObject(snapshot, 'account');
    expect(onAccount.map((component) => component.type)).toContain('ApexTrigger');
  });
});

describe('validateSnapshot', () => {
  const good: OrgSnapshot = {
    meta: {
      apiVersion: null,
      capturedAt: '2026-01-01T00:00:00.000Z',
      source: 'fixture',
      toolVersion: '0.0.1',
    },
    components: [{ type: 'ApexTrigger', fullName: 'X', object: 'Account', attributes: {} }],
  };

  it('rejects component missing type or fullName', () => {
    const bad: OrgSnapshot = {
      ...good,
      components: [{ type: '', fullName: '', attributes: {} }],
    };
    expect(() => {
      validateSnapshot(bad);
    }).toThrow(/type or fullName/i);
  });

  it('rejects non-array components field', () => {
    const bad = { ...good, components: null } as unknown as OrgSnapshot;
    expect(() => {
      validateSnapshot(bad);
    }).toThrow(/array/i);
  });
});
