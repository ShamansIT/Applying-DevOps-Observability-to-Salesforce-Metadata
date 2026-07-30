import { describe, expect, it } from 'vitest';
import {
  buildExperimentBundle,
  experimentChecksums,
  redact,
  toScenarioRunsCsv,
} from '../../src/experiment/storage.js';
import type { ScenarioRun } from '../../src/experiment/experimentMetrics.js';
import { computeExperimentMetrics } from '../../src/experiment/experimentMetrics.js';
import type { RaceTiming } from '../../src/experiment/race.js';

const timing: RaceTiming = {
  prototypeTtfafMs: 5,
  baselineTtfafMs: 20,
  leadTimeMs: 15,
  prototypeLatencyMs: 5,
  oracleLatencyMs: 20,
  prototypeFirst: true,
};

const runs: ScenarioRun[] = [
  {
    scenarioId: 'S02-01',
    cluster: 'programmatic',
    complexity: 'medium',
    expectedValidity: 'invalid',
    expectedFailureClass: 'metadata_reference',
    detectability: 'static-direct',
    prediction: 'material_warning',
    oracleOutcome: 'fail',
    oracleFailureClass: 'metadata_reference',
    timing,
  },
];

describe('redact', () => {
  it('removes tokens, auth urls, usernames and personal paths', () => {
    const dirty =
      'token 00Dxx0000001gPf!AQ4AQ user me@example.com url force://a:b@c.salesforce.com path C:\\Users\\finel\\repo';
    const clean = redact(dirty);
    expect(clean).not.toContain('00Dxx0000001gPf');
    expect(clean).not.toContain('me@example.com');
    expect(clean).not.toContain('force://');
    expect(clean).not.toContain('finel');
  });
});

describe('bundle', () => {
  it('shapes a scenario-runs csv with a header', () => {
    expect(toScenarioRunsCsv(runs).split('\n')[0]).toContain('scenario,cluster,complexity');
  });

  it('lists a checksum per file', () => {
    const lines = experimentChecksums({ 'a.txt': 'x', 'b.txt': 'y' }).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^[0-9a-f]{64}\s{2}a\.txt$/);
  });

  it('builds an immutable, checksummed, redacted bundle', () => {
    const bundle = buildExperimentBundle({
      freezeId: '2026-07-30-main',
      createdAt: '2026-07-30T00:00:00.000Z',
      runs,
      metrics: computeExperimentMetrics(runs),
    });
    expect(Object.keys(bundle).sort()).toEqual([
      'checksums.sha256',
      'datasets/scenario-runs.csv',
      'manifest.json',
      'summary/experiment-metrics.json',
    ]);
    expect(bundle['checksums.sha256']).toContain('manifest.json');
  });
});
