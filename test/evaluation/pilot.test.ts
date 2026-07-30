import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import {
  hashGroundTruth,
  loadGroundTruth,
  runScenarioFromFiles,
} from '../../src/evaluation/index.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

function fixture(rel: string): string {
  return fileURLToPath(new URL(`../../fixtures/${rel}`, import.meta.url));
}

describe('pilot scenario S01 (snapshot -> run -> comparison)', () => {
  const run = runScenarioFromFiles({
    scenarioPath: fixture('scenarios/S01.json'),
    groundTruthPath: fixture('ground-truth/S01.json'),
    model: MODEL,
    weights: WEIGHTS,
  });

  it('runs end-to-end and produces a graph', () => {
    expect(run.result.nodes.length).toBeGreaterThan(0);
    expect(run.metrics.scenarioId).toBe('S01');
  });

  it('recovers every expected node in its phase', () => {
    expect(run.metrics.expectedNodes).toBe(5);
    expect(run.metrics.nodeRecall).toBe(1);
    expect(run.metrics.nodePrecision).toBe(1);
    expect(run.metrics.phaseAccuracy).toBe(1);
  });

  it('reconstructs every statically-detectable edge with no false claim', () => {
    expect(run.metrics.expected).toBe(3); // three static-detectable edges
    expect(run.metrics.truePositives).toBe(3);
    expect(run.metrics.precision).toBe(1);
    expect(run.metrics.recall).toBe(1);
    expect(run.metrics.relationshipAccuracy).toBe(1);
    expect(run.metrics.finalEdgeNoiseRate).toBe(0);
  });

  it('leaves the runtime-only reference unresolved rather than guessing', () => {
    expect(run.metrics.runtimeOnlyExpected).toBe(1); // dynamic Contact SOQL
    expect(run.metrics.runtimeOnlyHandled).toBe(1); // not falsely claimed
  });

  it('covers the whole ordered backbone of what is statically detectable', () => {
    expect(run.metrics.orderedPathCoverage).toBe(1);
  });

  it('shows its certainty - two unresolved edges standing in for the dynamic reference', () => {
    expect(run.metrics.distribution).toEqual({
      confirmed: 8,
      inferred: 0,
      unresolved: 2,
      excluded: 0,
    });
  });

  it('stamps the ground-truth hash and it matches a fresh hash', () => {
    const truth = loadGroundTruth(fixture('ground-truth/S01.json'));
    expect(run.groundTruthHash).toBe(hashGroundTruth(truth));
    expect(run.groundTruthHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
