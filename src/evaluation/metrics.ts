// Metrics aggregation. Rolls per-scenario comparison up to overall and per-cluster figures with
// mean and normal-approximation confidence interval, and shapes both per-scenario and aggregate
// CSV for chapter-5 tables. Deterministic - fixed rounding, stable order, no timestamp. Pure.

import type { ComparisonMetrics } from './compare.js';
import type { ScenarioCluster } from './scenario.js';

export interface ScenarioResult {
  cluster: ScenarioCluster;
  metrics: ComparisonMetrics;
}

export interface MetricStat {
  mean: number;
  ciHalfWidth: number; // 95% normal-approximation half-width; 0 when n < 2
  n: number;
}

export interface Aggregate {
  n: number;
  stats: Record<string, MetricStat>;
}

export interface AggregateReport {
  overall: Aggregate;
  byCluster: Partial<Record<ScenarioCluster, Aggregate>>;
}

const METRIC_KEYS = [
  'precision',
  'recall',
  'f1',
  'coverage',
  'noise',
  'falseOmissionRate',
  'phaseOrderingAccuracy',
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Mean and 95% normal-approximation confidence half-width for one metric across scenarios.
function statOf(values: number[]): MetricStat {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, ciHalfWidth: 0, n: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) {
    return { mean: round(mean), ciHalfWidth: 0, n };
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const ci = 1.96 * (Math.sqrt(variance) / Math.sqrt(n));
  return { mean: round(mean), ciHalfWidth: round(ci), n };
}

function aggregateOf(results: ScenarioResult[]): Aggregate {
  const stats: Record<string, MetricStat> = {};
  for (const metricKey of METRIC_KEYS) {
    stats[metricKey] = statOf(results.map((result) => result.metrics[metricKey]));
  }
  return { n: results.length, stats };
}

// Aggregate overall and per cluster.
export function aggregate(results: ScenarioResult[]): AggregateReport {
  const byCluster: Partial<Record<ScenarioCluster, Aggregate>> = {};
  for (const cluster of ['programmatic', 'declarative', 'mixed'] as ScenarioCluster[]) {
    const group = results.filter((result) => result.cluster === cluster);
    if (group.length > 0) {
      byCluster[cluster] = aggregateOf(group);
    }
  }
  return { overall: aggregateOf(results), byCluster };
}

// Per-scenario CSV: one row per scenario, columns shaped for chapter-5 detail table.
export function toScenarioCsv(results: ScenarioResult[]): string {
  const header = [
    'scenario',
    'cluster',
    'expected',
    'claimed',
    'tp',
    'fp',
    'fn',
    'precision',
    'recall',
    'f1',
    'coverage',
    'noise',
    'false_omission_rate',
    'phase_ordering_accuracy',
  ];
  const rows = results.map((result) => {
    const m = result.metrics;
    return [
      m.scenarioId,
      result.cluster,
      m.expected,
      m.claimed,
      m.truePositives,
      m.falsePositives,
      m.falseNegatives,
      m.precision,
      m.recall,
      m.f1,
      m.coverage,
      m.noise,
      m.falseOmissionRate,
      m.phaseOrderingAccuracy,
    ].join(',');
  });
  return [header.join(','), ...rows, ''].join('\n');
}

// Aggregate CSV in tidy long form: one row per (group, metric).
export function toAggregateCsv(report: AggregateReport): string {
  const header = ['group', 'n', 'metric', 'mean', 'ci_half_width'];
  const rows: string[] = [];
  const emit = (group: string, aggregateReport: Aggregate): void => {
    for (const metricKey of METRIC_KEYS) {
      const stat = aggregateReport.stats[metricKey] as MetricStat;
      rows.push(
        [
          group,
          String(aggregateReport.n),
          metricKey,
          String(stat.mean),
          String(stat.ciHalfWidth),
        ].join(','),
      );
    }
  };
  emit('overall', report.overall);
  for (const cluster of ['programmatic', 'declarative', 'mixed'] as ScenarioCluster[]) {
    const clusterAggregate = report.byCluster[cluster];
    if (clusterAggregate) {
      emit(cluster, clusterAggregate);
    }
  }
  return [header.join(','), ...rows, ''].join('\n');
}

export { METRIC_KEYS };
export type { MetricKey };
