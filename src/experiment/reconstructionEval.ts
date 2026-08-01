// Offline reconstruction evaluation over the candidate register. Runs the real core, scores its graph
// against provisional ground truth with the evaluation metrics, rolls into a checksummed bundle. No org.

import { reconstruct } from '../core/index.js';
import type { AnalysisTarget, PhaseModel, WeightModel } from '../core/index.js';
import { compare } from '../evaluation/compare.js';
import type { ComparisonMetrics } from '../evaluation/compare.js';
import { hashGroundTruth } from '../evaluation/groundTruth.js';
import type { GroundTruth } from '../evaluation/groundTruth.js';
import { aggregate, toAggregateCsv, toScenarioCsv } from '../evaluation/metrics.js';
import type { ScenarioResult } from '../evaluation/metrics.js';
import type { ScenarioCluster } from '../evaluation/scenario.js';
import type { FileMap } from './mutation.js';
import { canonicalGraph } from './readiness.js';
import { snapshotFromFiles } from './snapshotBuilder.js';
import { experimentChecksums, redact } from './storage.js';
import type { NanoClock } from './race.js';

export type CandidateVariant = 'valid' | 'static_fail' | 'risk';

export interface Candidate {
  id: string;
  cluster: ScenarioCluster;
  variant: CandidateVariant;
  target: AnalysisTarget;
  files: FileMap;
  groundTruth: GroundTruth;
  salesforceValidated: false; // candidate only - never validated against a real org here
}

export interface ReconstructionRun {
  scenarioId: string;
  cluster: ScenarioCluster;
  variant: CandidateVariant;
  metrics: ComparisonMetrics;
  canonical: string;
  deterministic: boolean; // full canonical graph identical across two runs
  latencyMs: number;
  groundTruthHash: string;
}

function msBetween(from: bigint, to: bigint): number {
  return Math.round((Number(to - from) / 1e6) * 1000) / 1000;
}

// Run the core once (timed) and once more for determinism, then score against provisional truth.
export function runReconstruction(
  candidate: Candidate,
  model: PhaseModel,
  now: NanoClock,
  weights?: WeightModel,
): ReconstructionRun {
  const snapshot = snapshotFromFiles(candidate.files);
  const options = {
    sourceResolver: (component: { source?: string }) => component.source,
    ...(weights ? { weights } : {}),
  };
  const t0 = now();
  const result = reconstruct(snapshot, candidate.target, model, options);
  const t1 = now();
  const second = reconstruct(snapshot, candidate.target, model, options);
  const canonical = canonicalGraph(result);
  return {
    scenarioId: candidate.id,
    cluster: candidate.cluster,
    variant: candidate.variant,
    metrics: compare(result, candidate.groundTruth),
    canonical,
    deterministic: canonical === canonicalGraph(second),
    latencyMs: msBetween(t0, t1),
    groundTruthHash: hashGroundTruth(candidate.groundTruth),
  };
}

export function runReconstructionSuite(
  candidates: Candidate[],
  model: PhaseModel,
  now: NanoClock,
  weights?: WeightModel,
): ReconstructionRun[] {
  return candidates.map((candidate) => runReconstruction(candidate, model, now, weights));
}

export interface ReconstructionManifest {
  freezeId: string;
  createdAt: string;
  scenarioCount: number;
  deterministic: boolean; // every scenario reconstructed identically twice
  orgExecutionStatus: 'not_run'; // reconstruction is org-independent; no real-org value exists
  environment: Record<string, string>;
  seeds: Record<string, number>;
  configHashes: Record<string, string>;
}

// Latency summary over the suite, so local analysis latency is reported alongside quality.
function latencySummary(runs: ReconstructionRun[]): Record<string, number> {
  const values = runs.map((run) => run.latencyMs).sort((a, b) => a - b);
  const at = (q: number): number =>
    values[Math.min(values.length - 1, Math.floor(q * values.length))] ?? 0;
  return {
    n: values.length,
    p50Ms: values.length ? at(0.5) : 0,
    p95Ms: values.length ? at(0.95) : 0,
    maxMs: values.length ? (values[values.length - 1] ?? 0) : 0,
  };
}

export interface BundleContext {
  freezeId: string;
  createdAt: string;
  environment: Record<string, string>;
  seeds: Record<string, number>;
  configHashes: Record<string, string>;
}

// Serialise a reconstruction run to a checksummed, redacted bundle: per-scenario metrics, aggregate,
// canonical graphs, latency, and a manifest that records org-execution status as not_run.
export function reconstructionBundle(runs: ReconstructionRun[], context: BundleContext): FileMap {
  const results: ScenarioResult[] = runs.map((run) => ({
    cluster: run.cluster,
    metrics: run.metrics,
  }));
  const manifest: ReconstructionManifest = {
    freezeId: context.freezeId,
    createdAt: context.createdAt,
    scenarioCount: runs.length,
    deterministic: runs.every((run) => run.deterministic),
    orgExecutionStatus: 'not_run',
    environment: context.environment,
    seeds: context.seeds,
    configHashes: context.configHashes,
  };
  const files: FileMap = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'metrics.json': `${JSON.stringify(results, null, 2)}\n`,
    'datasets/scenario-metrics.csv': toScenarioCsv(results),
    'summary/aggregate.csv': toAggregateCsv(aggregate(results)),
    'summary/latency.json': `${JSON.stringify(latencySummary(runs), null, 2)}\n`,
    'candidate-register.json': `${JSON.stringify(
      runs.map((run) => ({
        id: run.scenarioId,
        cluster: run.cluster,
        variant: run.variant,
        salesforceValidated: false,
        groundTruthHash: run.groundTruthHash,
        deterministic: run.deterministic,
      })),
      null,
      2,
    )}\n`,
  };
  for (const run of runs) {
    files[`graphs/${run.scenarioId}.json`] = `${run.canonical}\n`;
  }
  const redacted: FileMap = {};
  for (const [path, content] of Object.entries(files)) {
    redacted[path] = redact(content);
  }
  redacted['checksums.sha256'] = experimentChecksums(redacted);
  return redacted;
}
