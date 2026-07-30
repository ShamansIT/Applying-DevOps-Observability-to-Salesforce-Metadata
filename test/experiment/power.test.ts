import { describe, expect, it } from 'vitest';
import { estimatePower, powerPlan } from '../../src/experiment/power.js';

describe('estimatePower', () => {
  it('is reproducible for a fixed seed', () => {
    const diffs = [0.3, 0.25, 0.4, 0.2, 0.35, 0.28];
    expect(estimatePower(diffs, 30, 400, 7)).toBe(estimatePower(diffs, 30, 400, 7));
  });

  it('rises with sample size for a real one-directional effect', () => {
    const diffs = [0.3, 0.25, 0.4, 0.2, 0.35, 0.28];
    const small = estimatePower(diffs, 6, 600, 3);
    const large = estimatePower(diffs, 40, 600, 3);
    expect(large).toBeGreaterThanOrEqual(small);
    expect(large).toBeGreaterThan(0.5);
  });

  it('is near zero when differences have no direction', () => {
    expect(estimatePower([1, -1, 1, -1], 20, 400, 5)).toBeLessThan(0.3);
  });
});

describe('powerPlan', () => {
  it('evaluates candidate sizes in order', () => {
    const rows = powerPlan([0.3, 0.25, 0.4, 0.2], [54, 72, 90], 200, 11);
    expect(rows.map((r) => r.n)).toEqual([54, 72, 90]);
    expect(rows.every((r) => r.power >= 0 && r.power <= 1)).toBe(true);
  });
});
