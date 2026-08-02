// Offline reconstruction evaluation over the candidate register. Runs the real core, scores its graph
// against provisional ground truth with the evaluation metrics, rolls into a checksummed bundle. No org.

import { createHash } from 'node:crypto';
import { reconstruct } from '../core/index.js';
import type { AnalysisTarget, PhaseModel, WeightModel } from '../core/index.js';
import { PREFLIGHT_RULES, PREFLIGHT_VERSION } from './preflight.js';
import { compare } from '../evaluation/compare.js';
import type { ComparisonMetrics } from '../evaluation/compare.js';
import { hashGroundTruth } from '../evaluation/groundTruth.js';
import type { GroundTruth } from '../evaluation/groundTruth.js';
import { toScenarioCsv } from '../evaluation/metrics.js';
import type { ScenarioResult } from '../evaluation/metrics.js';
import type { ScenarioCluster } from '../evaluation/scenario.js';
import type { FailureClass, FileMap, MutationDetectability } from './mutation.js';
import { canonicalGraph } from './readiness.js';
import { snapshotFromFiles } from './snapshotBuilder.js';
import { experimentChecksums, redact } from './storage.js';
import type { NanoClock } from './race.js';
import { descriptiveSummary } from './descriptiveStats.js';
import type { DescriptiveSummary } from './descriptiveStats.js';

export type CandidateVariant = 'valid' | 'static_fail' | 'risk';

// What the prototype is expected to do on the mutated project - deliberately coarse.
export type ExpectedPrototypeCategory = 'no_concern' | 'blocking' | 'risk_or_unresolved';

export interface CandidateManifest {
  operation: string;
  changedFiles: string[];
  changedFileHashes: Record<string, string>; // sha256 of new content, or 'deleted'
  effective: boolean; // clean and mutated differ - no no-op
}

export interface CandidateDesignExpectation {
  validationOutcome: 'pass' | 'fail';
  failureClass: FailureClass;
  detectability: MutationDetectability;
}

export interface Candidate {
  id: string;
  cluster: ScenarioCluster;
  variant: CandidateVariant;
  target: AnalysisTarget;
  cleanFiles: FileMap;
  mutatedFiles: FileMap;
  cleanHash: string;
  mutatedHash: string;
  fingerprint: string; // structural fingerprint of the mutated project
  mutationManifest: CandidateManifest;
  designExpectation: CandidateDesignExpectation;
  expectedPrototypeCategory: ExpectedPrototypeCategory;
  groundTruth: GroundTruth; // variant-specific
  salesforceValidated: false; // candidate only - never validated against a real org here
}

export interface ReconstructionRun {
  scenarioId: string;
  cluster: ScenarioCluster;
  variant: CandidateVariant;
  expectedPrototypeCategory: ExpectedPrototypeCategory;
  cleanHash: string;
  mutatedHash: string;
  fingerprint: string;
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
  const snapshot = snapshotFromFiles(candidate.mutatedFiles);
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
    expectedPrototypeCategory: candidate.expectedPrototypeCategory,
    cleanHash: candidate.cleanHash,
    mutatedHash: candidate.mutatedHash,
    fingerprint: candidate.fingerprint,
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
  runType: string;
  scenarioCount: number;
  deterministic: boolean; // every scenario reconstructed identically twice
  orgExecutionStatus: 'not_run'; // reconstruction is org-independent; no real-org value exists
  gitDirty: boolean;
  environment: Record<string, string>; // git commit, node, os, arch, api, and npm/python/sf versions
  seeds: Record<string, number>;
  configHashes: Record<string, string>; // phase model and weights
  scenarioPlanHash: string;
  groundTruthHashes: Record<string, string>; // per-scenario ground-truth hash
  diagnosticRuleHash: string; // preflight rule set, versioned
  statistics: { procedure: string; seed: number; resamples: number; ci: number };
  timing: { coreRunsPerScenario: number };
}

function diagnosticRuleHash(): string {
  const rules = PREFLIGHT_RULES.map((rule) => `${rule.id}@${rule.version}`)
    .sort()
    .join(',');
  return createHash('sha256').update(`${PREFLIGHT_VERSION}|${rules}`).digest('hex');
}

function scenarioPlanHash(stored: StoredRun[]): string {
  const plan = stored
    .map((run) => `${run.scenarioId}|${run.fingerprint}|${run.groundTruthHash}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(plan).digest('hex');
}

// Re-rollable per-scenario record: the fields aggregate and descriptive stats need, without the graph.
export interface StoredRun {
  scenarioId: string;
  cluster: ScenarioCluster;
  variant: CandidateVariant;
  expectedPrototypeCategory: ExpectedPrototypeCategory;
  cleanHash: string;
  mutatedHash: string;
  fingerprint: string;
  groundTruthHash: string;
  deterministic: boolean;
  latencyMs: number;
  metrics: ComparisonMetrics;
}

export function storedRuns(runs: ReconstructionRun[]): StoredRun[] {
  return runs.map((run) => ({
    scenarioId: run.scenarioId,
    cluster: run.cluster,
    variant: run.variant,
    expectedPrototypeCategory: run.expectedPrototypeCategory,
    cleanHash: run.cleanHash,
    mutatedHash: run.mutatedHash,
    fingerprint: run.fingerprint,
    groundTruthHash: run.groundTruthHash,
    deterministic: run.deterministic,
    latencyMs: run.latencyMs,
    metrics: run.metrics,
  }));
}

// Frozen descriptive statistics from stored runs - median, IQR, seeded bootstrap CI, determinism,
// latency. Used to build and to re-roll the run's summary without re-running the core.
export function descriptiveFromStored(stored: StoredRun[]): DescriptiveSummary {
  return descriptiveSummary({
    results: stored.map((run) => ({ cluster: run.cluster, metrics: run.metrics })),
    deterministic: stored.map((run) => run.deterministic),
    latenciesMs: stored.map((run) => run.latencyMs),
  });
}

export interface BundleContext {
  freezeId: string;
  createdAt: string;
  runType: string;
  gitDirty: boolean;
  environment: Record<string, string>; // includes npm/python/sf versions when known
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
  const stored = storedRuns(runs);
  const descriptive = descriptiveFromStored(stored);
  const manifest: ReconstructionManifest = {
    freezeId: context.freezeId,
    createdAt: context.createdAt,
    runType: context.runType,
    scenarioCount: runs.length,
    deterministic: runs.every((run) => run.deterministic),
    orgExecutionStatus: 'not_run',
    gitDirty: context.gitDirty,
    environment: context.environment,
    seeds: context.seeds,
    configHashes: context.configHashes,
    scenarioPlanHash: scenarioPlanHash(stored),
    groundTruthHashes: Object.fromEntries(
      stored.map((run) => [run.scenarioId, run.groundTruthHash]),
    ),
    diagnosticRuleHash: diagnosticRuleHash(),
    statistics: { procedure: 'bootstrap-median-ci', ...descriptive.procedure },
    timing: { coreRunsPerScenario: 2 },
  };
  const files: FileMap = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'runs.json': `${JSON.stringify(stored, null, 2)}\n`,
    'metrics.json': `${JSON.stringify(results, null, 2)}\n`,
    'datasets/scenario-metrics.csv': toScenarioCsv(results),
    // Frozen descriptive procedure - median, IQR, seeded bootstrap CI - not a normal-approximation CI.
    'summary/descriptive-stats.json': `${JSON.stringify(descriptive, null, 2)}\n`,
    'candidate-register.json': `${JSON.stringify(
      stored.map((run) => ({
        id: run.scenarioId,
        cluster: run.cluster,
        variant: run.variant,
        expectedPrototypeCategory: run.expectedPrototypeCategory,
        cleanHash: run.cleanHash,
        mutatedHash: run.mutatedHash,
        fingerprint: run.fingerprint,
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
