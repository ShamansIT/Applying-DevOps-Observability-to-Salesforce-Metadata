import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reconstruct } from '../../src/core/cascade/reconstruct.js';
import type { ReconstructOptions } from '../../src/core/cascade/reconstruct.js';
import type { SourceResolver } from '../../src/core/cascade/extract.js';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import { loadSnapshot } from '../../src/ingestion/index.js';

// Determinism gate. Same inputs must give byte-identical graph, edges, skeleton and risk across two
// runs, over every degrade path. Timings vary and are excluded. A difference here is defect.

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();
const SNAPSHOT = loadSnapshot(
  fileURLToPath(new URL('../../fixtures/snapshots/s01-eval.json', import.meta.url)),
);
const resolver: SourceResolver = (component) => component.source;
const TARGET = { object: 'Account', event: 'update' as const };

const CONFIGS: { name: string; options: ReconstructOptions }[] = [
  { name: 'offline (no source, no deps)', options: { weights: WEIGHTS } },
  {
    name: 'full (source + deps)',
    options: {
      weights: WEIGHTS,
      sourceResolver: resolver,
      dependencies: { records: SNAPSHOT.dependencies ?? [] },
    },
  },
  {
    name: 'expanded (depth 1)',
    options: { weights: WEIGHTS, sourceResolver: resolver, depthLimit: 1 },
  },
  {
    name: 'degraded (truncated deps)',
    options: {
      weights: WEIGHTS,
      sourceResolver: resolver,
      dependencies: { records: SNAPSHOT.dependencies ?? [], truncated: true },
    },
  },
];

describe('determinism gate', () => {
  for (const config of CONFIGS) {
    it(`double-run is deep-equal: ${config.name}`, () => {
      const a = reconstruct(SNAPSHOT, TARGET, MODEL, config.options);
      const b = reconstruct(SNAPSHOT, TARGET, MODEL, config.options);
      expect(a.nodes).toEqual(b.nodes);
      expect(a.edges).toEqual(b.edges);
      expect(a.skeleton).toEqual(b.skeleton);
      expect(a.risk).toEqual(b.risk);
      expect(a.meta.degraded).toEqual(b.meta.degraded);
    });
  }

  it('graph is independent of injected clock', () => {
    let t = 0;
    const stepA = reconstruct(SNAPSHOT, TARGET, MODEL, {
      weights: WEIGHTS,
      sourceResolver: resolver,
      clock: () => (t += 5),
    });
    const stepB = reconstruct(SNAPSHOT, TARGET, MODEL, {
      weights: WEIGHTS,
      sourceResolver: resolver,
      clock: () => Date.now(),
    });
    expect(stepA.nodes).toEqual(stepB.nodes);
    expect(stepA.edges).toEqual(stepB.edges);
    expect(stepA.risk).toEqual(stepB.risk);
  });
});
