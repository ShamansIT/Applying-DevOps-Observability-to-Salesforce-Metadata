// Simulation-based sample-size planning. Given pilot scenario-level paired differences, resample a
// candidate main size with replacement many times and estimate the power of a two-sided paired sign
// test at alpha 0.05. Seeded, so a plan reproduces. The final main size is chosen and frozen before
// main results are inspected; this only informs that choice. If pilot data are too sparse for a stable
// estimate, the caller keeps the minimum planned size and reports the limitation rather than pretending.

import { mulberry32 } from './random.js';

function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Abramowitz-Stegun approximation of the error function.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

// Two-sided sign-test p-value by normal approximation - adequate inside a power simulation.
function signP(diffs: number[]): number {
  const pos = diffs.filter((d) => d > 0).length;
  const neg = diffs.filter((d) => d < 0).length;
  const n = pos + neg;
  if (n === 0) return 1;
  const z = (Math.abs(pos - n / 2) - 0.5) / (Math.sqrt(n) / 2);
  return Math.min(1, 2 * (1 - phi(z)));
}

export interface PowerRow {
  n: number;
  power: number;
}

// Estimate power at one size: fraction of resamples where the sign test rejects at alpha.
export function estimatePower(
  pilotDiffs: number[],
  n: number,
  rounds: number,
  seed: number,
  alpha = 0.05,
): number {
  if (pilotDiffs.length === 0 || n <= 0) return 0;
  const rand = mulberry32(seed);
  let rejects = 0;
  for (let round = 0; round < rounds; round += 1) {
    const sample: number[] = [];
    for (let i = 0; i < n; i += 1) {
      sample.push(pilotDiffs[Math.floor(rand() * pilotDiffs.length)] ?? 0);
    }
    if (signP(sample) < alpha) rejects += 1;
  }
  return Math.round((rejects / rounds) * 1000) / 1000;
}

// Power plan over candidate sizes, evaluated in blocks (54, 72, 90, ...).
export function powerPlan(
  pilotDiffs: number[],
  sizes: number[],
  rounds: number,
  seed: number,
): PowerRow[] {
  return sizes.map((n, index) => ({
    n,
    power: estimatePower(pilotDiffs, n, rounds, seed + index),
  }));
}
