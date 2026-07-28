// Scenario runner. Ties evaluation together: load snapshot, drive same core IDE drives, compare
// output against ground truth, and stamp ground-truth hash onto result. Snapshot carries
// component bodies, so run parses them offline through source resolver. Ground truth stays walled
// off from core - it only reaches compare, never reconstruct.

import { dirname, isAbsolute, resolve } from 'node:path';
import { reconstruct } from '../core/index.js';
import type { PhaseModel, ReconstructResult, SourceResolver, WeightModel } from '../core/index.js';
import { loadSnapshot } from '../ingestion/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';
import { compare } from './compare.js';
import type { ComparisonMetrics } from './compare.js';
import { hashGroundTruth, loadGroundTruth } from './groundTruth.js';
import type { GroundTruth } from './groundTruth.js';
import { loadScenario } from './scenario.js';
import type { Scenario } from './scenario.js';

export interface ScenarioRun {
  scenario: Scenario;
  result: ReconstructResult;
  metrics: ComparisonMetrics;
  groundTruthHash: string;
}

// Body lookup from snapshot: component carries its own source, captured at snapshot time.
const snapshotSource: SourceResolver = (component) => component.source;

// Run one already-loaded scenario. Pure apart from clock inside reconstruct; metrics do not depend
// on timings, so they are deterministic.
export function runScenario(
  scenario: Scenario,
  snapshot: OrgSnapshot,
  truth: GroundTruth,
  model: PhaseModel,
  weights: WeightModel,
): ScenarioRun {
  const result = reconstruct(snapshot, { object: scenario.object, event: scenario.event }, model, {
    weights,
    sourceResolver: snapshotSource,
    depthLimit: scenario.depthLimit,
    ...(snapshot.dependencies ? { dependencies: { records: snapshot.dependencies } } : {}),
  });
  return {
    scenario,
    result,
    metrics: compare(result, truth),
    groundTruthHash: hashGroundTruth(truth),
  };
}

export interface RunFromFilesOptions {
  scenarioPath: string;
  groundTruthPath: string;
  model: PhaseModel;
  weights: WeightModel;
  rootDir?: string; // base for scenario.snapshot; defaults to scenario file directory
}

// Load scenario, snapshot and ground truth from disk, then run. Snapshot path in scenario resolves
// against rootDir (or scenario file directory).
export function runScenarioFromFiles(options: RunFromFilesOptions): ScenarioRun {
  const scenario = loadScenario(options.scenarioPath);
  const truth = loadGroundTruth(options.groundTruthPath);
  const base = options.rootDir ?? dirname(options.scenarioPath);
  const snapshotPath = isAbsolute(scenario.snapshot)
    ? scenario.snapshot
    : resolve(base, scenario.snapshot);
  const snapshot = loadSnapshot(snapshotPath);
  return runScenario(scenario, snapshot, truth, options.model, options.weights);
}
