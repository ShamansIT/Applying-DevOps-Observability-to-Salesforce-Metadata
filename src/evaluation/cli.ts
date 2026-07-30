// Evaluation cli. Thin filesystem shell around the pure runner: read a phase config, load scenarios,
// ground truth and snapshots, run, and write results/<freeze-id>/ with a manifest. Phases: pilot and
// main run their configured set; repeat runs the same set more times for a latency distribution;
// aggregate re-rolls an existing run's metrics. Meant to be run from repository root.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPhaseModelFromPath } from '../core/phases/phaseModel.js';
import { loadWeights } from '../core/score/index.js';
import type { ConfigHashes, FreezeEnvironment } from './runner.js';
import { loadSnapshot } from '../ingestion/index.js';
import { loadGroundTruth } from './groundTruth.js';
import { aggregate, toAggregateCsv } from './metrics.js';
import type { ScenarioResult } from './metrics.js';
import { assertDisjointMainPlan } from './plan.js';
import { runEvaluation, serializeBundle } from './runner.js';
import type { EvalCase } from './runner.js';
import { loadScenario } from './scenario.js';

interface CaseConfig {
  scenario: string;
  groundTruth: string;
}

interface PhaseConfig {
  repeats?: number;
  cases: CaseConfig[];
}

interface Args {
  phase: string;
  freeze?: string;
  config?: string;
  repeats?: number;
}

function parseArgs(argv: string[]): Args {
  const phase = argv[0] ?? '';
  const args: Args = { phase };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--freeze' && value) {
      args.freeze = value;
      i += 1;
    } else if (flag === '--config' && value) {
      args.config = value;
      i += 1;
    } else if (flag === '--repeats' && value) {
      args.repeats = Number(value);
      i += 1;
    }
  }
  return args;
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// Best-effort git call; returns fallback when git is absent or the tree is not a repository.
function git(args: string[], root: string, fallback: string): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function freezeEnvironment(root: string): FreezeEnvironment {
  return {
    gitCommit: git(['rev-parse', 'HEAD'], root, 'unknown'),
    gitDirty: git(['status', '--porcelain'], root, '').length > 0,
    node: process.version,
    os: process.platform,
    arch: process.arch,
    salesforceApiVersion: '67.0',
  };
}

function loadCase(caseConfig: CaseConfig, root: string): EvalCase {
  const scenarioPath = resolve(root, caseConfig.scenario);
  const scenario = loadScenario(scenarioPath);
  const truth = loadGroundTruth(resolve(root, caseConfig.groundTruth));
  const snapshotPath = isAbsolute(scenario.snapshot)
    ? scenario.snapshot
    : resolve(dirname(scenarioPath), scenario.snapshot);
  return { scenario, snapshot: loadSnapshot(snapshotPath), truth };
}

function writeBundle(files: Record<string, string>, outDir: string): void {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(outDir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
}

// Scenario ids of one phase config, loading only the scenario files. Used to enforce pilot/main
// disjointness before a run.
function planScenarioIds(configPath: string, root: string): string[] {
  if (!existsSync(configPath)) {
    return [];
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as PhaseConfig;
  return config.cases.map((caseConfig) => loadScenario(resolve(root, caseConfig.scenario)).id);
}

function runPhase(args: Args, root: string, now: Date): string {
  // repeat runs the main set more times, so it reads the main config.
  const configName = args.phase === 'repeat' ? 'main' : args.phase;
  const configPath = args.config ?? join(root, 'config', 'eval', `${configName}.json`);
  if (!existsSync(configPath)) {
    throw new Error(`eval ${args.phase}: config not found at ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as PhaseConfig;
  const cases = config.cases.map((caseConfig) => loadCase(caseConfig, root));

  // Main and repeat draw on the main benchmark, which must be non-empty and disjoint from pilot.
  if (args.phase === 'main' || args.phase === 'repeat') {
    const pilotIds = planScenarioIds(join(root, 'config', 'eval', 'pilot.json'), root);
    assertDisjointMainPlan(
      cases.map((evalCase) => evalCase.scenario.id),
      pilotIds,
    );
  }

  const freezeId = args.freeze ?? `${today(now)}-${args.phase}`;
  const repeats = args.repeats ?? config.repeats ?? 2;

  const phaseModelPath = resolve(root, 'src', 'core', 'phases', 'phases.v67.json');
  const weightsPath = resolve(root, 'config', 'weights.json');
  const model = loadPhaseModelFromPath(phaseModelPath);
  const weights = loadWeights(pathToFileURL(weightsPath));
  const configHashes: ConfigHashes = {
    phaseModel: sha256File(phaseModelPath),
    weights: sha256File(weightsPath),
  };

  const bundle = runEvaluation(cases, {
    model,
    weights,
    freezeId,
    repeats,
    createdAt: now.toISOString(),
    toolVersion: process.env['npm_package_version'] ?? '0.0.0',
    environment: freezeEnvironment(root),
    configHashes,
  });

  const outDir = join(root, 'results', freezeId);
  writeBundle(serializeBundle(bundle), outDir);
  return `eval ${args.phase}: ${String(bundle.manifest.scenarioCount)} scenario(s), deterministic ${String(bundle.manifest.deterministic)}, written to ${outDir}`;
}

// Re-roll an existing run's per-scenario metrics into a fresh aggregate, without re-running core.
function aggregatePhase(args: Args, root: string): string {
  if (!args.freeze) {
    throw new Error('eval aggregate: --freeze <id> is required');
  }
  const dir = join(root, 'results', args.freeze);
  const results = JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8')) as ScenarioResult[];
  writeFileSync(join(dir, 'metrics-aggregate.csv'), toAggregateCsv(aggregate(results)), 'utf8');
  return `eval aggregate: re-rolled ${String(results.length)} scenario(s) in ${dir}`;
}

export function main(argv: string[], root: string, now: Date): string {
  const args = parseArgs(argv);
  switch (args.phase) {
    case 'pilot':
    case 'main':
    case 'repeat':
      return runPhase(args, root, now);
    case 'aggregate':
      return aggregatePhase(args, root);
    default:
      throw new Error(
        `eval: unknown phase '${args.phase}', expected pilot, main, repeat or aggregate`,
      );
  }
}
