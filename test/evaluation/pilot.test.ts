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

  it('never claims a false edge - precision stays 1', () => {
    expect(run.metrics.precision).toBe(1);
    expect(run.metrics.noise).toBe(0);
  });

  it('misses the dynamic reference rather than guessing - recall below 1', () => {
    expect(run.metrics.expected).toBe(4);
    expect(run.metrics.truePositives).toBe(3);
    expect(run.metrics.falseNegatives).toBe(1);
    expect(run.metrics.recall).toBe(0.75);
    expect(run.metrics.coverage).toBe(0.75);
  });

  it('places every matched edge in its expected phase', () => {
    expect(run.metrics.phaseOrderingAccuracy).toBe(1);
  });

  it('stamps the ground-truth hash and it matches a fresh hash', () => {
    const truth = loadGroundTruth(fixture('ground-truth/S01.json'));
    expect(run.groundTruthHash).toBe(hashGroundTruth(truth));
    expect(run.groundTruthHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
