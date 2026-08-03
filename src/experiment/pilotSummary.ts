// Pilot summary templates. Reduces per-scenario records to completion, timing, detection, exception and
// reconstruction summaries. Timing is one paired observation per scenario; org fields stay not_run. Pure.

import type { FileMap } from './mutation.js';
import type { ReadinessRecord } from './readiness.js';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? (ordered[mid] ?? 0)
    : ((ordered[mid - 1] ?? 0) + (ordered[mid] ?? 0)) / 2;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const pos = (ordered.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return (ordered[low] ?? 0) + ((ordered[high] ?? 0) - (ordered[low] ?? 0)) * (pos - low);
}

export interface PilotSummary {
  runId: string;
  orgExecutionStatus: 'not_run' | 'present';
  completion: {
    total: number;
    complete: number;
    cleanInvalid: number;
    prototypeFailed: number;
    infrastructureFailed: number;
    error: number;
  };
  detection: {
    staticFailures: number;
    staticFailuresFlagged: number; // prototype raised a blocking finding
    riskScenarios: number;
    riskScenariosFlagged: number; // prototype raised risk or unresolved
  };
  timing: {
    subset: string[];
    note: 'single_paired_observation_per_scenario';
    leadMedianMs: number;
    leadIqrMs: number;
  };
  reconstruction: { scenarios: number; deterministic: number };
  exceptions: { scenarioId: string; status: string; reasons: string[] }[];
}

const CONCERN = new Set(['blocking_finding', 'material_warning', 'unresolved']);

// One scenario per cluster (deterministic by id order) is the balanced timing subset.
export function timingSubset(records: ReadinessRecord[]): string[] {
  const seen = new Set<string>();
  const subset: string[] = [];
  for (const record of [...records].sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : 1))) {
    const cluster = record.scenarioId.split('-')[1] ?? record.scenarioId;
    if (!seen.has(cluster)) {
      seen.add(cluster);
      subset.push(record.scenarioId);
    }
  }
  return subset;
}

export function pilotSummary(runId: string, records: ReadinessRecord[]): PilotSummary {
  const complete = records.filter((r) => r.status === 'complete');
  const orgExecuted = records.some((r) => r.mutatedOutcome !== 'not_run');
  const staticFailures = records.filter((r) => r.designExpectation.mutatedValidation === 'fail');
  const risk = records.filter((r) => r.designExpectation.prototype === 'risk_or_unresolved');
  const subset = new Set(timingSubset(records));
  const leads = complete.filter((r) => subset.has(r.scenarioId)).map((r) => r.timing.leadTimeMs);

  return {
    runId,
    orgExecutionStatus: orgExecuted ? 'present' : 'not_run',
    completion: {
      total: records.length,
      complete: complete.length,
      cleanInvalid: records.filter((r) => r.status === 'clean_invalid').length,
      prototypeFailed: records.filter((r) => r.status === 'prototype_failed').length,
      infrastructureFailed: records.filter((r) => r.status === 'infrastructure_failed').length,
      error: records.filter((r) => r.status === 'error').length,
    },
    detection: {
      staticFailures: staticFailures.length,
      staticFailuresFlagged: staticFailures.filter(
        (r) => r.prototype.predictionCategory === 'blocking_finding',
      ).length,
      riskScenarios: risk.length,
      riskScenariosFlagged: risk.filter((r) => CONCERN.has(r.prototype.predictionCategory)).length,
    },
    timing: {
      subset: [...subset].sort(),
      note: 'single_paired_observation_per_scenario',
      leadMedianMs: Math.round(median(leads) * 1000) / 1000,
      leadIqrMs: Math.round((quantile(leads, 0.75) - quantile(leads, 0.25)) * 1000) / 1000,
    },
    reconstruction: {
      scenarios: records.length,
      deterministic: records.filter((r) => r.prototypeDeterministic).length,
    },
    exceptions: records
      .filter((r) => !r.criteriaMet)
      .map((r) => ({ scenarioId: r.scenarioId, status: r.status, reasons: r.reasons })),
  };
}

export function pilotSummaryFiles(summary: PilotSummary): FileMap {
  return {
    'pilot-summary.json': `${JSON.stringify(summary, null, 2)}\n`,
    'summary/completion.json': `${JSON.stringify(summary.completion, null, 2)}\n`,
    'summary/detection.json': `${JSON.stringify(summary.detection, null, 2)}\n`,
    'summary/timing.json': `${JSON.stringify(summary.timing, null, 2)}\n`,
    'summary/reconstruction.json': `${JSON.stringify(summary.reconstruction, null, 2)}\n`,
    'summary/exceptions.json': `${JSON.stringify(summary.exceptions, null, 2)}\n`,
  };
}
