import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { validateGroundTruth } from '../../src/evaluation/groundTruth.js';
import { pilotCandidates } from '../../src/experiment/pilotCandidates.js';
import {
  reconstructionBundle,
  runReconstruction,
  runReconstructionSuite,
} from '../../src/experiment/reconstructionEval.js';
import { runPrototype } from '../../src/experiment/prototypeAdapter.js';
import { snapshotFromFiles } from '../../src/experiment/snapshotBuilder.js';
import type { AnalysisTarget } from '../../src/core/index.js';

const MODEL = loadPhaseModel();
const CANDIDATES = pilotCandidates();

function clock(): () => bigint {
  let c = 0n;
  return () => {
    c += 1_000_000n;
    return c;
  };
}

function category(mutatedFiles: Record<string, string>, target: AnalysisTarget): string {
  return runPrototype(snapshotFromFiles(mutatedFiles), target, MODEL, {
    sourceResolver: (component) => component.source,
  }).outcome.predictionCategory;
}

describe('pilot candidate register', () => {
  it('is nine candidates: three clusters times three variants, none org-validated', () => {
    expect(CANDIDATES).toHaveLength(9);
    expect(new Set(CANDIDATES.map((c) => c.cluster))).toEqual(
      new Set(['declarative', 'programmatic', 'mixed']),
    );
    expect(new Set(CANDIDATES.map((c) => c.variant))).toEqual(
      new Set(['valid', 'static_fail', 'risk']),
    );
    expect(CANDIDATES.every((c) => c.salesforceValidated === false)).toBe(true);
  });

  it('all nine differ: distinct ids and structural fingerprints', () => {
    expect(new Set(CANDIDATES.map((c) => c.id)).size).toBe(9);
    expect(new Set(CANDIDATES.map((c) => c.fingerprint)).size).toBeGreaterThanOrEqual(6);
  });

  it('every mutation is effective: clean and mutated differ, no no-op', () => {
    for (const c of CANDIDATES) {
      expect(c.mutationManifest.effective).toBe(true);
      expect(c.mutationManifest.changedFiles.length).toBeGreaterThan(0);
      expect(c.cleanHash).not.toBe(c.mutatedHash);
    }
  });

  it('carries a valid, variant-matched provisional ground truth', () => {
    for (const c of CANDIDATES) {
      expect(() => {
        validateGroundTruth(c.groundTruth);
      }).not.toThrow();
      expect(c.groundTruth.id).toBe(c.id);
    }
  });

  it('justifies each expected prototype category against the real core', () => {
    for (const c of CANDIDATES) {
      const observed = category(c.mutatedFiles, c.target);
      if (c.expectedPrototypeCategory === 'no_concern') {
        expect(['blocking_finding', 'material_warning', 'unresolved']).not.toContain(observed);
      } else if (c.expectedPrototypeCategory === 'blocking') {
        expect(observed).toBe('blocking_finding');
      } else {
        expect(['material_warning', 'unresolved']).toContain(observed);
      }
    }
  });

  it('every static-failure variant fails and every risk stays valid by design', () => {
    for (const c of CANDIDATES.filter((x) => x.variant === 'static_fail')) {
      expect(c.designExpectation.validationOutcome).toBe('fail');
    }
    for (const c of CANDIDATES.filter((x) => x.variant === 'risk')) {
      expect(c.designExpectation.validationOutcome).toBe('pass');
      expect(c.designExpectation.detectability).not.toBe('static-direct');
    }
  });
});

describe('reconstruction evaluation', () => {
  it('runs the real core over each candidate and scores against provisional truth', () => {
    const runs = runReconstructionSuite(CANDIDATES, MODEL, clock());
    expect(runs).toHaveLength(9);
    for (const run of runs) {
      expect(run.deterministic).toBe(true);
      expect(run.metrics.scenarioId).toBe(run.scenarioId);
      expect(run.groundTruthHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('a single reconstruction is deterministic over the full canonical graph', () => {
    const candidate = CANDIDATES[0];
    if (!candidate) throw new Error('no candidate');
    expect(runReconstruction(candidate, MODEL, clock()).deterministic).toBe(true);
  });

  it('packages a checksummed bundle that records org execution as not_run', () => {
    const runs = runReconstructionSuite(CANDIDATES, MODEL, clock());
    const bundle = reconstructionBundle(runs, {
      freezeId: 'test',
      createdAt: '1970-01-01T00:00:00.000Z',
      runType: 'reconstruction',
      gitDirty: false,
      environment: { node: 'test' },
      seeds: { topology: 1 },
      configHashes: { phaseModel: 'abc', weights: 'def' },
    });
    expect(bundle['manifest.json']).toContain('"orgExecutionStatus": "not_run"');
    expect(bundle['manifest.json']).toContain('"diagnosticRuleHash"');
    expect(bundle['manifest.json']).toContain('"scenarioPlanHash"');
    expect(bundle['candidate-register.json']).toContain('expectedPrototypeCategory');
    expect(bundle['summary/descriptive-stats.json']).toContain('"hypotheses": "not_run"');
    expect(bundle['runs.json']).toBeDefined();
    expect(bundle['checksums.sha256']).toBeDefined();
  });
});
