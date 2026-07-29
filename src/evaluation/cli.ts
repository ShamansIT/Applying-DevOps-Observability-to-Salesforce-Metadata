// Evaluation cli. Thin filesystem shell around the pure runner: read a phase config, load scenarios,
// ground truth and snapshots, run, and write results/<freeze-id>/ with a manifest. Phases: pilot and
// main run their configured set; repeat runs the same set more times for a latency distribution;
// aggregate re-rolls an existing run's metrics. Meant to be run from repository root.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPhaseModelFromPath } from '../core/phases/phaseModel.js';
import { loadWeights } from '../core/score/index.js';
import { loadSnapshot } from '../ingestion/index.js';
import { loadGroundTruth } from './groundTruth.js';
import { aggregate, toAggregateCsv } from './metrics.js';
import type { ScenarioResult } from './metrics.js';
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

function runPhase(args: Args, root: string, now: Date): string {
  const configPath = args.config ?? join(root, 'config', 'eval', `${args.phase}.json`);
  if (!existsSync(configPath)) {
    throw new Error(`eval ${args.phase}: config not found at ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as PhaseConfig;
  const cases = config.cases.map((caseConfig) => loadCase(caseConfig, root));
  const freezeId = args.freeze ?? `${today(now)}-${args.phase}`;
  const repeats = args.repeats ?? config.repeats ?? 2;

  const model = loadPhaseModelFromPath(resolve(root, 'src', 'core', 'phases', 'phases.v67.json'));
  const weights = loadWeights(pathToFileURL(resolve(root, 'config', 'weights.json')));

  const bundle = runEvaluation(cases, {
    model,
    weights,
    freezeId,
    repeats,
    createdAt: now.toISOString(),
    toolVersion: process.env['npm_package_version'] ?? '0.0.0',
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
