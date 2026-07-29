// Evaluation runner core. Pure orchestration over pre-loaded cases: run core per scenario, check
// determinism by a double run, compare against ground truth, sample skeleton latency, and assemble a
// bundle plus a manifest that stamps the freeze. No filesystem here - loading and writing live in the
// cli - so this is unit-testable and deterministic given an injected clock.

import { reconstruct } from '../core/index.js';
import type { PhaseModel, ReconstructResult, SourceResolver, WeightModel } from '../core/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';
import { compare } from './compare.js';
import type { ComparisonMetrics } from './compare.js';
import { hashGroundTruth } from './groundTruth.js';
import type { GroundTruth } from './groundTruth.js';
import { skeletonSample, toSkeletonCsv } from './latency.js';
import type { SkeletonLatencySample } from './latency.js';
import { aggregate, toAggregateCsv, toScenarioCsv } from './metrics.js';
import type { AggregateReport, ScenarioResult } from './metrics.js';
import type { Scenario } from './scenario.js';

export interface EvalCase {
  scenario: Scenario;
  snapshot: OrgSnapshot;
  truth: GroundTruth;
}

export interface RunOptions {
  model: PhaseModel;
  weights: WeightModel;
  freezeId: string;
  repeats: number; // runs per scenario; two or more so determinism is checked
  createdAt: string; // injected clock, ISO string
  toolVersion: string;
}

export interface ScenarioManifestEntry {
  id: string;
  cluster: string;
  groundTruthHash: string;
  deterministic: boolean;
}

export interface Manifest {
  freezeId: string;
  createdAt: string;
  toolVersion: string;
  phaseModelApiVersion: string;
  weightsProvisional: boolean;
  repeats: number;
  scenarioCount: number;
  deterministic: boolean; // every scenario byte-identical across repeats
  scenarios: ScenarioManifestEntry[];
}

export interface ScenarioGraph {
  id: string;
  result: ReconstructResult;
}

export interface EvaluationBundle {
  manifest: Manifest;
  results: ScenarioResult[]; // per-scenario cluster and metrics, for aggregate and CSV
  aggregate: AggregateReport;
  latency: SkeletonLatencySample[];
  graphs: ScenarioGraph[];
}

const snapshotSource: SourceResolver = (component) => component.source;

function runOnce(item: EvalCase, options: RunOptions): ReconstructResult {
  return reconstruct(
    item.snapshot,
    { object: item.scenario.object, event: item.scenario.event },
    options.model,
    {
      weights: options.weights,
      sourceResolver: snapshotSource,
      depthLimit: item.scenario.depthLimit,
      ...(item.snapshot.dependencies
        ? { dependencies: { records: item.snapshot.dependencies } }
        : {}),
    },
  );
}

// Graph identity for the determinism check: everything but wall-clock timings, which live in meta and
// vary run to run by design.
function graphKey(result: ReconstructResult): string {
  return JSON.stringify({
    skeleton: result.skeleton,
    nodes: result.nodes,
    edges: result.edges,
    risk: result.risk,
  });
}

// Run all cases and assemble the bundle. Each scenario runs `repeats` times: the first drives metrics,
// and all runs feed the determinism check and latency samples.
export function runEvaluation(cases: EvalCase[], options: RunOptions): EvaluationBundle {
  if (cases.length === 0) {
    throw new Error('runEvaluation: needs at least one case');
  }
  const repeats = Math.max(2, options.repeats);

  const results: ScenarioResult[] = [];
  const latency: SkeletonLatencySample[] = [];
  const graphs: ScenarioGraph[] = [];
  const scenarios: ScenarioManifestEntry[] = [];
  let phaseModelApiVersion = '';

  for (const item of cases) {
    const first = runOnce(item, options);
    const firstKey = graphKey(first);
    let deterministic = true;
    latency.push(skeletonSample(first, 1));
    for (let repeat = 2; repeat <= repeats; repeat += 1) {
      const again = runOnce(item, options);
      if (graphKey(again) !== firstKey) {
        deterministic = false;
      }
      latency.push(skeletonSample(again, repeat));
    }

    const metrics: ComparisonMetrics = compare(first, item.truth);
    results.push({ cluster: item.scenario.cluster, metrics });
    graphs.push({ id: item.scenario.id, result: first });
    scenarios.push({
      id: item.scenario.id,
      cluster: item.scenario.cluster,
      groundTruthHash: hashGroundTruth(item.truth),
      deterministic,
    });
    phaseModelApiVersion = first.meta.phaseModelApiVersion ?? '';
  }

  const manifest: Manifest = {
    freezeId: options.freezeId,
    createdAt: options.createdAt,
    toolVersion: options.toolVersion,
    phaseModelApiVersion,
    weightsProvisional: options.weights.provisional,
    repeats,
    scenarioCount: cases.length,
    deterministic: scenarios.every((entry) => entry.deterministic),
    scenarios,
  };

  return { manifest, results, aggregate: aggregate(results), latency, graphs };
}

// Strip wall-clock timings so a written graph is byte-stable and never carries run-to-run noise.
function stableGraph(result: ReconstructResult): unknown {
  return {
    skeleton: result.skeleton,
    nodes: result.nodes,
    edges: result.edges,
    risk: result.risk,
    meta: { ...result.meta, timings: [] },
  };
}

// Turn a bundle into a map of relative path to file content. Pure, so the cli only has to write it.
export function serializeBundle(bundle: EvaluationBundle): Record<string, string> {
  const files: Record<string, string> = {
    'manifest.json': `${JSON.stringify(bundle.manifest, null, 2)}\n`,
    'metrics.json': `${JSON.stringify(bundle.results, null, 2)}\n`,
    'metrics-scenario.csv': toScenarioCsv(bundle.results),
    'metrics-aggregate.csv': toAggregateCsv(bundle.aggregate),
    'latency.csv': toSkeletonCsv(bundle.latency),
  };
  for (const graph of bundle.graphs) {
    files[`graphs/${graph.id}.json`] = `${JSON.stringify(stableGraph(graph.result), null, 2)}\n`;
  }
  return files;
}
