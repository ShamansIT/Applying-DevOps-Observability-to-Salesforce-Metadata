import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { validateGroundTruth } from '../../src/evaluation/groundTruth.js';
import { pilotCandidates } from '../../src/experiment/pilotCandidates.js';
import {
  reconstructionBundle,
  runReconstruction,
  runReconstructionSuite,
} from '../../src/experiment/reconstructionEval.js';

const MODEL = loadPhaseModel();

function clock(): () => bigint {
  let c = 0n;
  return () => {
    c += 1_000_000n;
    return c;
  };
}

describe('pilot candidate register', () => {
  it('has nine candidates: three clusters times three variants, none org-validated', () => {
    const candidates = pilotCandidates();
    expect(candidates).toHaveLength(9);
    expect(new Set(candidates.map((c) => c.cluster))).toEqual(
      new Set(['declarative', 'programmatic', 'mixed']),
    );
    expect(new Set(candidates.map((c) => c.variant))).toEqual(
      new Set(['valid', 'static_fail', 'risk']),
    );
    expect(candidates.every((c) => c.salesforceValidated === false)).toBe(true);
  });

  it('carries a valid provisional ground truth', () => {
    for (const candidate of pilotCandidates()) {
      expect(() => {
        validateGroundTruth(candidate.groundTruth);
      }).not.toThrow();
    }
  });

  it('realises variants in the files, not comments', () => {
    const byId = new Map(pilotCandidates().map((c) => [c.id, c]));
    const risk = byId.get('cand-programmatic-risk');
    const valid = byId.get('cand-programmatic-valid');
    const staticFail = byId.get('cand-programmatic-static_fail');
    const triggerOf = (files: Record<string, string>): string =>
      Object.entries(files).find(([p]) => p.endsWith('.trigger'))?.[1] ?? '';
    expect(triggerOf(risk?.files ?? {})).toContain('Database.query');
    expect(triggerOf(valid?.files ?? {})).not.toContain('Database.query');
    const validClasses = Object.keys(valid?.files ?? {}).filter((p) => p.endsWith('.cls')).length;
    const failClasses = Object.keys(staticFail?.files ?? {}).filter((p) =>
      p.endsWith('.cls'),
    ).length;
    expect(failClasses).toBeLessThan(validClasses);
  });
});

describe('reconstruction evaluation', () => {
  it('runs the real core over each candidate and scores against provisional truth', () => {
    const runs = runReconstructionSuite(pilotCandidates(), MODEL, clock());
    expect(runs).toHaveLength(9);
    for (const run of runs) {
      expect(run.deterministic).toBe(true);
      expect(run.metrics.scenarioId).toBe(run.scenarioId);
      expect(run.groundTruthHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('a single reconstruction is deterministic over the full canonical graph', () => {
    const candidate = pilotCandidates()[0];
    if (!candidate) throw new Error('no candidate');
    expect(runReconstruction(candidate, MODEL, clock()).deterministic).toBe(true);
  });

  it('packages a checksummed bundle that records org execution as not_run', () => {
    const runs = runReconstructionSuite(pilotCandidates(), MODEL, clock());
    const bundle = reconstructionBundle(runs, {
      freezeId: 'test',
      createdAt: '1970-01-01T00:00:00.000Z',
      environment: { node: 'test' },
      seeds: { topology: 1 },
      configHashes: { phaseModel: 'abc', weights: 'def' },
    });
    expect(bundle['manifest.json']).toContain('"orgExecutionStatus": "not_run"');
    expect(bundle['metrics.json']).toBeDefined();
    expect(bundle['summary/aggregate.csv']).toContain('nodePrecision');
    expect(bundle['datasets/scenario-metrics.csv']).toContain('cand-programmatic-valid');
    expect(bundle['checksums.sha256']).toBeDefined();
  });
});
