// Time-to-first-actionable-feedback protocol. Skeleton renders after L1, so TTFAF is L1 timing read
// straight from run meta - measured inside cascade, not by external stopwatch. Records per-repeat
// samples and writes CSV shaped same way for prototype and baseline, so two are comparable.
// Timings vary run to run, so this module is one place that reads them.

import type { ReconstructResult } from '../core/index.js';

export interface TtfafSample {
  source: string; // 'prototype' or 'baseline'
  repeat: number;
  ttfafMs: number; // time to skeleton after L1
  fullMs: number; // full cascade wall-clock
}

export interface TtfafStat {
  mean: number;
  ciHalfWidth: number;
  n: number;
}

// One sample from one run. Source labels which system produced it.
export function ttfafSample(
  result: ReconstructResult,
  repeat: number,
  source = 'prototype',
): TtfafSample {
  const l1 = result.meta.timings.find((timing) => timing.layer === 'L1');
  const fullMs = result.meta.timings.reduce((sum, timing) => sum + timing.ms, 0);
  return { source, repeat, ttfafMs: round(l1?.ms ?? 0), fullMs: round(fullMs) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stat(values: number[]): TtfafStat {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, ciHalfWidth: 0, n: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) {
    return { mean: round(mean), ciHalfWidth: 0, n };
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean: round(mean), ciHalfWidth: round(1.96 * (Math.sqrt(variance) / Math.sqrt(n))), n };
}

// Mean and confidence interval for TTFAF and full cascade across samples.
export function ttfafStats(samples: TtfafSample[]): { ttfaf: TtfafStat; full: TtfafStat } {
  return {
    ttfaf: stat(samples.map((sample) => sample.ttfafMs)),
    full: stat(samples.map((sample) => sample.fullMs)),
  };
}

// CSV of samples: same columns for prototype and baseline, so protocol rows line up.
export function toTtfafCsv(samples: TtfafSample[]): string {
  const header = ['source', 'repeat', 'ttfaf_ms', 'full_ms'];
  const rows = samples.map((sample) =>
    [sample.source, String(sample.repeat), String(sample.ttfafMs), String(sample.fullMs)].join(','),
  );
  return [header.join(','), ...rows, ''].join('\n');
}
