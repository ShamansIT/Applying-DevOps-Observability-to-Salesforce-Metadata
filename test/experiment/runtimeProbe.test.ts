import { describe, expect, it } from 'vitest';
import { runtimeProbe } from '../../src/experiment/runtimeProbe.js';

describe('runtimeProbe', () => {
  it('inserts and updates a known object for an update event', () => {
    const probe = runtimeProbe('Account', 'update');
    expect(probe.path).toBe('scripts/probe.apex');
    expect(probe.apex).toContain('new Account(');
    expect(probe.apex).toContain('insert rec;');
    expect(probe.apex).toContain('update rec;');
    expect(probe.requiresOperatorReview).toBe(false);
  });

  it('only inserts for a create event', () => {
    const probe = runtimeProbe('Contact', 'create');
    expect(probe.apex).toContain('insert rec;');
    expect(probe.apex).not.toContain('update rec;');
  });

  it('flags an unknown object for operator review with a describe fallback', () => {
    const probe = runtimeProbe('My_Custom__c', 'create');
    expect(probe.requiresOperatorReview).toBe(true);
    expect(probe.apex).toContain('getGlobalDescribe');
  });
});
