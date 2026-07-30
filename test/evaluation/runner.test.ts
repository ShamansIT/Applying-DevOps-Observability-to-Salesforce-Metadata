import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import { loadSnapshot } from '../../src/ingestion/index.js';
import { hashGroundTruth, loadGroundTruth } from '../../src/evaluation/groundTruth.js';
import { loadScenario } from '../../src/evaluation/scenario.js';
import { runEvaluation, serializeBundle } from '../../src/evaluation/runner.js';
import type { EvalCase, RunOptions } from '../../src/evaluation/runner.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

function fixture(rel: string): string {
  return fileURLToPath(new URL(`../../fixtures/${rel}`, import.meta.url));
}

function s01Case(): EvalCase {
  const scenarioPath = fixture('scenarios/S01.json');
  const scenario = loadScenario(scenarioPath);
  const truth = loadGroundTruth(fixture('ground-truth/S01.json'));
  const snapshot = loadSnapshot(resolve(dirname(scenarioPath), scenario.snapshot));
  return { scenario, snapshot, truth };
}

const OPTIONS: RunOptions = {
  model: MODEL,
  weights: WEIGHTS,
  freezeId: 'test-freeze',
  repeats: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  toolVersion: '0.0.1',
  environment: {
    gitCommit: 'test',
    gitDirty: false,
    node: 'v22',
    os: 'linux',
    arch: 'x64',
    salesforceApiVersion: '67.0',
  },
  configHashes: { phaseModel: 'aaa', weights: 'bbb' },
};

describe('runEvaluation', () => {
  it('assembles a manifest that stamps the freeze and ground-truth hash', () => {
    const bundle = runEvaluation([s01Case()], OPTIONS);
    expect(bundle.manifest.freezeId).toBe('test-freeze');
    expect(bundle.manifest.scenarioCount).toBe(1);
    expect(bundle.manifest.deterministic).toBe(true);
    expect(bundle.manifest.weightsProvisional).toBe(true);
    expect(bundle.manifest.phaseModelApiVersion).toBe('67.0');
    expect(bundle.manifest.scenarios[0]?.groundTruthHash).toBe(hashGroundTruth(s01Case().truth));
  });

  it('carries the pilot metrics through to the aggregate', () => {
    const bundle = runEvaluation([s01Case()], OPTIONS);
    expect(bundle.aggregate.overall.n).toBe(1);
    expect(bundle.results[0]?.metrics.nodeRecall).toBe(1);
    expect(bundle.results[0]?.metrics.recall).toBe(1);
    expect(bundle.results[0]?.metrics.orderedPathCoverage).toBe(1);
  });

  it('samples skeleton latency once per repeat', () => {
    const bundle = runEvaluation([s01Case()], { ...OPTIONS, repeats: 3 });
    expect(bundle.latency).toHaveLength(3);
    expect(bundle.latency.map((sample) => sample.repeat)).toEqual([1, 2, 3]);
  });

  it('needs at least one case', () => {
    expect(() => {
      runEvaluation([], OPTIONS);
    }).toThrow(/at least one case/);
  });
});

describe('serializeBundle', () => {
  it('writes manifest, metrics, csv and a timing-free graph', () => {
    const files = serializeBundle(runEvaluation([s01Case()], OPTIONS));
    expect(Object.keys(files).sort()).toEqual([
      'graphs/S01.json',
      'latency.csv',
      'manifest.json',
      'metrics-aggregate.csv',
      'metrics-scenario.csv',
      'metrics.json',
    ]);
    const graph = JSON.parse(files['graphs/S01.json'] as string) as {
      meta: { timings: unknown[] };
    };
    expect(graph.meta.timings).toEqual([]);
    expect(files['metrics-scenario.csv']?.split('\n')[0]).toContain(
      'scenario,cluster,expected_nodes',
    );
  });

  it('is byte-identical across runs once timings are stripped', () => {
    const first = serializeBundle(runEvaluation([s01Case()], OPTIONS));
    const second = serializeBundle(runEvaluation([s01Case()], OPTIONS));
    expect(first['graphs/S01.json']).toBe(second['graphs/S01.json']);
    expect(first['metrics-scenario.csv']).toBe(second['metrics-scenario.csv']);
    expect(first['manifest.json']).toBe(second['manifest.json']);
  });
});
