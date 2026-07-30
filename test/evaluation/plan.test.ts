import { describe, expect, it } from 'vitest';
import { assertDisjointMainPlan } from '../../src/evaluation/plan.js';

describe('assertDisjointMainPlan', () => {
  it('accepts a non-empty main set disjoint from pilot', () => {
    expect(() => {
      assertDisjointMainPlan(['S02', 'S03'], ['S01']);
    }).not.toThrow();
  });

  it('rejects an empty main set', () => {
    expect(() => {
      assertDisjointMainPlan([], ['S01']);
    }).toThrow(/empty/);
  });

  it('rejects a pilot scenario appearing in main', () => {
    expect(() => {
      assertDisjointMainPlan(['S01', 'S02'], ['S01']);
    }).toThrow(/pilot scenario/);
  });

  it('rejects a scenario listed twice in main', () => {
    expect(() => {
      assertDisjointMainPlan(['S02', 'S02'], ['S01']);
    }).toThrow(/appears twice/);
  });
});
