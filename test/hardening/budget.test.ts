import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reconstruct } from '../../src/core/cascade/reconstruct.js';
import type { SourceResolver } from '../../src/core/cascade/extract.js';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import { loadSnapshot } from '../../src/ingestion/index.js';

// Latency budget gate. Runs pilot scenario repeatedly and checks L1 P50 and full-cascade P95
// against config/budgets.json. Fixture runs sit far under budget, so this catches real regression
// rather than noise.

interface Budgets {
  l1P50Ms: number;
  fullP95Ms: number;
}

const budgets = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../config/budgets.json', import.meta.url)), 'utf8'),
) as Budgets;

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();
const SNAPSHOT = loadSnapshot(
  fileURLToPath(new URL('../../fixtures/snapshots/s01-eval.json', import.meta.url)),
);
const resolver: SourceResolver = (component) => component.source;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe('latency budget gate', () => {
  const REPEATS = 10;
  const l1: number[] = [];
  const full: number[] = [];
  for (let i = 0; i < REPEATS; i += 1) {
    const { meta } = reconstruct(SNAPSHOT, { object: 'Account', event: 'update' }, MODEL, {
      weights: WEIGHTS,
      sourceResolver: resolver,
      dependencies: { records: SNAPSHOT.dependencies ?? [] },
    });
    l1.push(meta.timings.find((timing) => timing.layer === 'L1')?.ms ?? 0);
    full.push(meta.timings.reduce((sum, timing) => sum + timing.ms, 0));
  }

  it(`L1 P50 within ${String(budgets.l1P50Ms)} ms`, () => {
    expect(percentile(l1, 50)).toBeLessThanOrEqual(budgets.l1P50Ms);
  });

  it(`full cascade P95 within ${String(budgets.fullP95Ms)} ms`, () => {
    expect(percentile(full, 95)).toBeLessThanOrEqual(budgets.fullP95Ms);
  });
});
