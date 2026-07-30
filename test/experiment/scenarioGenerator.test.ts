import { describe, expect, it } from 'vitest';
import { generateBenchmark } from '../../src/experiment/scenarioGenerator.js';
import { benchmarkQuality } from '../../src/experiment/benchmarkQuality.js';

describe('generateBenchmark', () => {
  const { pilot, main } = generateBenchmark();

  it('produces 18 pilot and 72 main scenarios', () => {
    expect(pilot).toHaveLength(18);
    expect(main).toHaveLength(72);
  });

  it('keeps pilot and main disjoint', () => {
    const mainIds = new Set(main.map((s) => s.id));
    expect(pilot.some((s) => mainIds.has(s.id))).toBe(false);
  });

  it('gives every scenario an effective mutation and a design expectation', () => {
    for (const scenario of [...pilot, ...main]) {
      expect(scenario.mutationManifest.changedFiles.length).toBeGreaterThan(0);
      expect(Object.keys(scenario.changedFileHashes).length).toBeGreaterThan(0);
      expect(['pass', 'fail']).toContain(scenario.designExpectation.validationOutcome);
      expect(scenario.designExpectation.expectedNodes.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('records the base topology family and instance for clustering analysis', () => {
    expect(main[0]?.topologyFamilyId).toBeDefined();
    expect(main[0]?.topologyInstanceId).toContain('main-');
  });

  it('is deterministic', () => {
    const again = generateBenchmark();
    expect(again.main.map((s) => s.id)).toEqual(main.map((s) => s.id));
  });
});

describe('benchmarkQuality', () => {
  const { pilot, main } = generateBenchmark();

  it('passes the generated benchmark with no critical violations', () => {
    const report = benchmarkQuality(pilot, main);
    expect(report.ok).toBe(true);
    expect(report.mainCount).toBe(72);
    expect(Object.keys(report.clusterBalance).sort()).toEqual([
      'declarative',
      'mixed',
      'programmatic',
    ]);
  });

  it('flags a pilot/main overlap as critical', () => {
    const clash = main[0];
    if (!clash) throw new Error('no main scenario');
    const report = benchmarkQuality([{ ...clash }], main);
    expect(report.ok).toBe(false);
    expect(report.pilotMainOverlap).toContain(clash.id);
  });

  it('flags a duplicate main scenario', () => {
    const first = main[0];
    if (!first) throw new Error('no main scenario');
    const report = benchmarkQuality(pilot, [...main, { ...first, id: 'main-clone' }]);
    expect(report.ok).toBe(false);
    expect(report.duplicateSignatures.length).toBeGreaterThan(0);
  });
});
