// Result storage and packaging. Turns a set of scenario runs and their metrics into an immutable,
// checksummed result bundle: datasets and summaries plus a `checksums.sha256`. Secrets are redacted
// from anything stored - access tokens, auth URLs, usernames and personal paths never reach a result
// file. Writing refuses to overwrite an existing freeze directory. Pure serialisation is separate from
// the filesystem write, so the bundle is unit-tested without touching disk.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { FileMap } from './mutation.js';
import type { ExperimentMetrics, ScenarioRun } from './experimentMetrics.js';
import { writeProjectFiles } from './project.js';

const REDACTIONS: { pattern: RegExp; with: string }[] = [
  { pattern: /00D[A-Za-z0-9]{5,}![A-Za-z0-9._-]+/g, with: '[redacted-token]' },
  { pattern: /force:\/\/[^\s"']+/g, with: '[redacted-auth-url]' },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, with: '[redacted-user]' },
  { pattern: /[A-Za-z]:\\Users\\[^\\/\s"']+/g, with: '[redacted-path]' },
  { pattern: /\/(?:home|Users)\/[^/\s"']+/g, with: '[redacted-path]' },
];

// Remove secrets and personal identifiers from any text before it is stored.
export function redact(text: string): string {
  let out = text;
  for (const rule of REDACTIONS) {
    out = out.replace(rule.pattern, rule.with);
  }
  return out;
}

function csvValue(value: string | number | boolean): string {
  return String(value);
}

export function toScenarioRunsCsv(runs: ScenarioRun[]): string {
  const header = [
    'scenario',
    'cluster',
    'complexity',
    'expected_validity',
    'expected_failure_class',
    'detectability',
    'prediction',
    'oracle_outcome',
    'oracle_failure_class',
    'prototype_ttfaf_ms',
    'baseline_ttfaf_ms',
    'lead_time_ms',
    'prototype_first',
  ];
  const rows = runs.map((r) =>
    [
      r.scenarioId,
      r.cluster,
      r.complexity,
      r.expectedValidity,
      r.expectedFailureClass,
      r.detectability,
      r.prediction,
      r.oracleOutcome,
      r.oracleFailureClass,
      r.timing.prototypeTtfafMs,
      r.timing.baselineTtfafMs,
      r.timing.leadTimeMs,
      r.timing.prototypeFirst,
    ]
      .map(csvValue)
      .join(','),
  );
  return [header.join(','), ...rows, ''].join('\n');
}

// sha256 manifest over every file in the bundle, sorted by path, ready to write as checksums.sha256.
export function experimentChecksums(files: FileMap): string {
  return `${Object.keys(files)
    .sort()
    .map(
      (path) =>
        `${createHash('sha256')
          .update(files[path] ?? '')
          .digest('hex')}  ${path}`,
    )
    .join('\n')}\n`;
}

export interface BundleInput {
  freezeId: string;
  createdAt: string;
  runs: ScenarioRun[];
  metrics: ExperimentMetrics;
}

// Serialise a result bundle to a path-to-content map. All text is redacted. A checksums.sha256 covers
// every other file. Pure.
export function buildExperimentBundle(input: BundleInput): FileMap {
  const files: FileMap = {
    'manifest.json': `${JSON.stringify(
      { freezeId: input.freezeId, createdAt: input.createdAt, scenarioCount: input.runs.length },
      null,
      2,
    )}\n`,
    'datasets/scenario-runs.csv': toScenarioRunsCsv(input.runs),
    'summary/experiment-metrics.json': `${JSON.stringify(input.metrics, null, 2)}\n`,
  };
  const redacted: FileMap = {};
  for (const [path, content] of Object.entries(files)) {
    redacted[path] = redact(content);
  }
  redacted['checksums.sha256'] = experimentChecksums(redacted);
  return redacted;
}

// Write a bundle under results/<freeze-id>/, refusing to overwrite an existing freeze.
export function writeImmutableBundle(files: FileMap, outDir: string): void {
  if (existsSync(outDir)) {
    throw new Error(`experiment: freeze directory already exists, refusing to overwrite ${outDir}`);
  }
  writeProjectFiles(files, outDir);
}
