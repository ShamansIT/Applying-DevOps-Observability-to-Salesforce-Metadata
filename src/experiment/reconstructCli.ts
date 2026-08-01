// Filesystem glue for the reconstruction commands: run the suite, write results/reconstruct/<id>/,
// re-roll aggregate, repackage checksums, run the stats self-test. Excluded from the coverage gate.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PhaseModel, WeightModel } from '../core/index.js';
import { aggregate, toAggregateCsv } from '../evaluation/metrics.js';
import type { ScenarioResult } from '../evaluation/metrics.js';
import { pilotCandidates } from './pilotCandidates.js';
import { hrtimeClock } from './race.js';
import { reconstructionBundle, runReconstructionSuite } from './reconstructionEval.js';
import { experimentChecksums, writeImmutableBundle } from './storage.js';

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Run the candidate register through the real core and write a checksummed bundle.
export function runReconstructCommand(
  freezeId: string,
  model: PhaseModel,
  weights: WeightModel,
): string {
  const runs = runReconstructionSuite(pilotCandidates(), model, hrtimeClock, weights);
  const bundle = reconstructionBundle(runs, {
    freezeId,
    createdAt: new Date().toISOString(),
    environment: {
      gitCommit: gitCommit(),
      node: process.version,
      os: process.platform,
      arch: process.arch,
      salesforceApiVersion: '67.0',
    },
    seeds: { topology: 1 },
    configHashes: {
      phaseModel: sha256File(resolve(process.cwd(), 'src', 'core', 'phases', 'phases.v67.json')),
      weights: sha256File(resolve(process.cwd(), 'config', 'weights.json')),
    },
  });
  writeImmutableBundle(bundle, join(process.cwd(), 'results', 'reconstruct', freezeId));
  const deterministic = runs.every((run) => run.deterministic);
  return `reconstruct ${freezeId}: ${String(runs.length)} candidate(s), deterministic ${String(deterministic)}, org-execution not_run`;
}

// Re-roll an existing run's aggregate without re-running the core.
export function aggregateCommand(freezeId: string): string {
  const dir = join(process.cwd(), 'results', 'reconstruct', freezeId);
  const results = JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8')) as ScenarioResult[];
  writeFileSync(join(dir, 'summary', 'aggregate.csv'), toAggregateCsv(aggregate(results)), 'utf8');
  return `aggregate ${freezeId}: re-rolled ${String(results.length)} scenario(s)`;
}

// Recompute checksums over every bundle file bar the manifest of checksums itself.
export function packageCommand(freezeId: string): string {
  const dir = join(process.cwd(), 'results', 'reconstruct', freezeId);
  const files: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.name !== 'checksums.sha256')
        files[childRel] = readFileSync(join(dir, childRel), 'utf8');
    }
  };
  walk('');
  writeFileSync(join(dir, 'checksums.sha256'), experimentChecksums(files), 'utf8');
  return `package ${freezeId}: ${String(Object.keys(files).length)} file(s) checksummed`;
}

// Statistics connectivity: the stats tool runs its textbook self-test. Inferential statistics over
// paired shift-left data need real-org timings and outcomes, which do not exist offline (not_run).
export function statsCommand(): string {
  const output = execFileSync('python', ['scripts/stats.py', '--selftest'], { encoding: 'utf8' });
  return `stats: ${output.trim().split('\n').pop() ?? 'ok'} (inferential shift-left stats pending real-org data)`;
}
