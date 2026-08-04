// Filesystem glue for the reconstruction commands: run the suite, re-roll the descriptive summary,
// report descriptive stats, validate and archive the bundle. Excluded from the coverage gate.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PhaseModel, WeightModel } from '../core/index.js';
import type { FileMap } from './mutation.js';
import { buildArchive, packageManifest, validateBundle } from './packaging.js';
import { pilotCandidates } from './pilotCandidates.js';
import { hrtimeClock } from './race.js';
import {
  descriptiveFromStored,
  reconstructionBundle,
  runReconstructionSuite,
} from './reconstructionEval.js';
import type { StoredRun } from './reconstructionEval.js';
import { experimentChecksums, writeImmutableBundle } from './storage.js';

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitDirty(): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

// Best-effort tool version, first captured group of the pattern, or 'unknown' when the tool is absent.
function toolVersion(file: string, args: string[], pattern: RegExp): string {
  try {
    const out = execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.match(pattern)?.[1] ?? out.trim().split('\n')[0] ?? 'unknown';
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
    runType: 'reconstruction',
    gitDirty: gitDirty(),
    environment: {
      gitCommit: gitCommit(),
      node: process.version,
      os: process.platform,
      arch: process.arch,
      salesforceApiVersion: '67.0',
      npm: toolVersion('npm', ['-v'], /([\d.]+)/),
      python: toolVersion('python', ['--version'], /Python ([\d.]+)/),
      sf: toolVersion('sf', ['--version'], /@salesforce\/cli\/([\d.]+)/),
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

function loadRuns(freezeId: string): { dir: string; runs: StoredRun[] } {
  const dir = join(process.cwd(), 'results', 'reconstruct', freezeId);
  const runs = JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8')) as StoredRun[];
  return { dir, runs };
}

// Re-roll an existing run's descriptive summary without re-running the core.
export function aggregateCommand(freezeId: string): string {
  const { dir, runs } = loadRuns(freezeId);
  writeFileSync(
    join(dir, 'summary', 'descriptive-stats.json'),
    `${JSON.stringify(descriptiveFromStored(runs), null, 2)}\n`,
    'utf8',
  );
  finaliseChecksums(dir);
  return `aggregate ${freezeId}: re-rolled descriptive stats over ${String(runs.length)} scenario(s)`;
}

const ARTEFACTS = new Set(['validation-report.json', 'package-manifest.json']);
function isArtefact(rel: string): boolean {
  return ARTEFACTS.has(rel) || rel.endsWith('.bundle.json.gz') || rel.endsWith('.bundle.sha256');
}

// Read every bundle file bar the packaging artefacts into a map, keyed by relative path.
function readBundle(dir: string): FileMap {
  const files: FileMap = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else if (!isArtefact(childRel)) files[childRel] = readFileSync(join(dir, childRel), 'utf8');
    }
  };
  walk('');
  return files;
}

// Recompute checksums.sha256 over the whole bundle, so aggregate and stats outputs are covered before
// packaging. Not weakened - package still catches a file tampered or added after this.
function finaliseChecksums(dir: string): void {
  const files = readBundle(dir);
  delete files['checksums.sha256'];
  writeFileSync(join(dir, 'checksums.sha256'), experimentChecksums(files), 'utf8');
}

// Validate the bundle against its checksums, then write a deterministic gzip archive, its sha256 and a
// validation report. Gzipped JSON, so no external tar; a mismatch is reported, not silently repackaged.
export function packageCommand(freezeId: string): string {
  const dir = join(process.cwd(), 'results', 'reconstruct', freezeId);
  const files = readBundle(dir);

  // Validate first; always record the report, but never archive an invalid or tampered bundle.
  const validation = validateBundle(files);
  writeFileSync(
    join(dir, 'validation-report.json'),
    `${JSON.stringify({ freezeId, ...validation }, null, 2)}\n`,
    'utf8',
  );
  if (!validation.valid) {
    const detail = [
      validation.mismatches.length ? `mismatched: ${validation.mismatches.join(', ')}` : '',
      validation.unlisted.length ? `unlisted: ${validation.unlisted.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`package ${freezeId}: bundle invalid - ${detail}`);
  }

  // Refuse to overwrite an existing archive - a completed package is immutable.
  const archive = buildArchive(freezeId, files);
  if (existsSync(join(dir, archive.name))) {
    throw new Error(`package ${freezeId}: archive already exists, refusing to overwrite`);
  }
  writeFileSync(join(dir, archive.name), archive.bytes);
  writeFileSync(
    join(dir, `${freezeId}.bundle.sha256`),
    `${archive.sha256}  ${archive.name}\n`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'package-manifest.json'),
    packageManifest(freezeId, files, archive),
    'utf8',
  );

  return `package ${freezeId}: ${String(validation.checkedFiles)} file(s) validated ok, archive sha256 ${archive.sha256.slice(0, 12)}`;
}

// Descriptive statistics over a reconstruction run - median, IQR, seeded bootstrap CI, determinism and
// latency. Inferential hypothesis tests stay not_run until real-org paired data exists.
export function statsCommand(freezeId: string): string {
  const { dir, runs } = loadRuns(freezeId);
  const summary = descriptiveFromStored(runs);
  writeFileSync(
    join(dir, 'summary', 'stats-report.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  finaliseChecksums(dir);
  const f1 = summary.metrics['f1'];
  const f1Text = f1
    ? `f1 median ${String(f1.median)} [${String(f1.ci95Low)}, ${String(f1.ci95High)}]`
    : 'no f1';
  return `stats ${freezeId}: ${String(summary.n)} scenario(s), ${f1Text}, determinism ${String(summary.determinism.deterministic)}/${String(summary.determinism.n)}, hypotheses ${summary.hypotheses}`;
}
