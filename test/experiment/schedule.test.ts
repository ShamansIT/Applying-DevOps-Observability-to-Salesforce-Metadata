import { describe, expect, it } from 'vitest';
import { assertUniqueScenarios, blockedSchedule } from '../../src/experiment/schedule.js';
import type { ScenarioDescriptor } from '../../src/experiment/schedule.js';

const SCENARIOS: ScenarioDescriptor[] = [
  { id: 'S02', cluster: 'declarative', complexity: 'low', expectedValidity: 'valid' },
  { id: 'S03', cluster: 'declarative', complexity: 'low', expectedValidity: 'invalid' },
  { id: 'S04', cluster: 'programmatic', complexity: 'high', expectedValidity: 'valid' },
  { id: 'S05', cluster: 'programmatic', complexity: 'high', expectedValidity: 'invalid' },
];

describe('blockedSchedule', () => {
  it('is deterministic for a fixed seed and covers every scenario once', () => {
    const a = blockedSchedule(SCENARIOS, 42);
    const b = blockedSchedule(SCENARIOS, 42);
    expect(a).toEqual(b);
    expect(a.map((i) => i.scenarioId).sort()).toEqual(['S02', 'S03', 'S04', 'S05']);
    expect(a.map((i) => i.order)).toEqual([0, 1, 2, 3]);
  });

  it('alternates the counterbalanced sequence', () => {
    const seqs = blockedSchedule(SCENARIOS, 1).map((i) => i.sequence);
    expect(seqs[0]).toBe('baseline-first');
    expect(seqs[1]).toBe('prototype-first');
  });
});

describe('assertUniqueScenarios', () => {
  it('accepts distinct changed-file signatures', () => {
    expect(() => {
      assertUniqueScenarios([
        { mutationId: 'a', changedFileHashes: { 'x.cls': 'h1' } },
        { mutationId: 'b', changedFileHashes: { 'x.cls': 'h2' } },
      ]);
    }).not.toThrow();
  });

  it('rejects a trivially-cloned scenario', () => {
    expect(() => {
      assertUniqueScenarios([
        { mutationId: 'a', changedFileHashes: { 'x.cls': 'h1' } },
        { mutationId: 'b', changedFileHashes: { 'x.cls': 'h1' } },
      ]);
    }).toThrow(/not a distinct scenario/);
  });
});
