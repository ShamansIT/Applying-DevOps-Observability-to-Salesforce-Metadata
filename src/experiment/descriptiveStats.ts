// Frozen descriptive statistics for the offline reconstruction run - median, IQR, seeded bootstrap 95%
// interval, determinism and latency. No normal-approx interval, no inferential test: hypotheses not_run.

import { METRIC_KEYS } from '../evaluation/metrics.js';
import type { ScenarioResult } from '../evaluation/metrics.js';
import { mulberry32 } from './random.js';

export interface MetricDescriptive {
  n: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  ci95Low: number; // percentile-bootstrap of the median
  ci95High: number;
}

export interface DescriptiveSummary {
  n: number;
  metrics: Record<string, MetricDescriptive>;
  determinism: { n: number; deterministic: number; allDeterministic: boolean };
  latency: { n: number; medianMs: number; p95Ms: number; maxMs: number };
  hypotheses: 'not_run'; // real-org inferential tests need paired real-org data
  procedure: { seed: number; resamples: number; ci: number };
}

export interface DescriptiveInput {
  results: ScenarioResult[];
  deterministic: boolean[];
  latenciesMs: number[];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Linear-interpolation quantile over an unsorted sample.
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0] ?? 0;
  const pos = (ordered.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  const lowV = ordered[low] ?? 0;
  const highV = ordered[high] ?? 0;
  return lowV + (highV - lowV) * (pos - low);
}

function medianOf(values: number[]): number {
  return quantile(values, 0.5);
}

// Percentile-bootstrap 95% interval of the median. Seeded, so the interval is reproducible.
function bootstrapMedianCi(
  values: number[],
  seed: number,
  resamples: number,
): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
  const rand = mulberry32(seed);
  const medians: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    const sample: number[] = [];
    for (let i = 0; i < values.length; i += 1) {
      sample.push(values[Math.floor(rand() * values.length)] ?? 0);
    }
    medians.push(medianOf(sample));
  }
  return { low: quantile(medians, 0.025), high: quantile(medians, 0.975) };
}

function metricDescriptive(values: number[], seed: number, resamples: number): MetricDescriptive {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const ci = bootstrapMedianCi(values, seed, resamples);
  return {
    n: values.length,
    median: round(medianOf(values)),
    q1: round(q1),
    q3: round(q3),
    iqr: round(q3 - q1),
    ci95Low: round(ci.low),
    ci95High: round(ci.high),
  };
}

const DEFAULT_SEED = 20260801;
const DEFAULT_RESAMPLES = 2000;

// Descriptive summary over the reconstruction run. Pure and deterministic.
export function descriptiveSummary(
  input: DescriptiveInput,
  options: { seed?: number; resamples?: number } = {},
): DescriptiveSummary {
  const seed = options.seed ?? DEFAULT_SEED;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const metrics: Record<string, MetricDescriptive> = {};
  for (const [index, metricKey] of METRIC_KEYS.entries()) {
    const values = input.results.map((result) => result.metrics[metricKey]);
    // Vary the seed per metric so intervals are not lockstep, but stay reproducible.
    metrics[metricKey] = metricDescriptive(values, seed + index, resamples);
  }
  const deterministic = input.deterministic.filter(Boolean).length;
  return {
    n: input.results.length,
    metrics,
    determinism: {
      n: input.deterministic.length,
      deterministic,
      allDeterministic: deterministic === input.deterministic.length,
    },
    latency: {
      n: input.latenciesMs.length,
      medianMs: round(medianOf(input.latenciesMs)),
      p95Ms: round(quantile(input.latenciesMs, 0.95)),
      maxMs: input.latenciesMs.length ? Math.max(...input.latenciesMs) : 0,
    },
    hypotheses: 'not_run',
    procedure: { seed, resamples, ci: 0.95 },
  };
}
