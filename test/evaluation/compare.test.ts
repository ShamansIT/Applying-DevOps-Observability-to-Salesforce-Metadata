import { describe, expect, it } from 'vitest';
import { compare } from '../../src/evaluation/compare.js';
import type { GroundTruth } from '../../src/evaluation/groundTruth.js';
import type { ReconstructResult } from '../../src/core/index.js';
import type { ExecEdge, ExecNode } from '../../src/core/types.js';

function node(id: string, phase: string): ExecNode {
  return {
    id,
    apiName: id,
    label: id,
    type: 'apex_trigger',
    object: 'Account',
    phase,
    active: true,
    state: 'confirmed',
    score: 1,
    evidence: [],
  };
}

function edge(from: string, to: string, state: ExecEdge['state']): ExecEdge {
  return { from, to, kind: 'dependency', state, score: 1, evidence: [] };
}

function resultOf(nodes: ExecNode[], edges: ExecEdge[]): ReconstructResult {
  return {
    skeleton: {
      target: { object: 'Account', event: 'update' },
      phases: [],
      candidateCount: 0,
      nodeCount: nodes.length,
    },
    nodes,
    edges,
    risk: [],
    meta: {
      object: 'Account',
      event: 'update',
      snapshotApiVersion: '67.0',
      phaseModelApiVersion: '67.0',
      depthLimit: 0,
      truncated: false,
      timings: [],
      degraded: [],
    },
  };
}

const TRUTH: GroundTruth = {
  id: 'T',
  edges: [
    { from: 'a', to: 'x', phase: 'before_triggers', expected: 'confirmed' },
    { from: 'b', to: 'y', phase: 'after_triggers', expected: 'inferred' },
  ],
};

describe('compare', () => {
  it('scores a perfect reconstruction as precision and recall 1', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred')],
    );
    const m = compare(result, TRUTH);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.phaseOrderingAccuracy).toBe(1);
  });

  it('does not penalise unresolved edges - they are not claims', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred'), edge('a', 'junk', 'unresolved')],
    );
    const m = compare(result, TRUTH);
    expect(m.claimed).toBe(2); // unresolved edge excluded from claims
    expect(m.precision).toBe(1);
    expect(m.noise).toBe(0);
  });

  it('counts a spurious claimed edge as noise', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred'), edge('a', 'wrong', 'confirmed')],
    );
    const m = compare(result, TRUTH);
    expect(m.falsePositives).toBe(1);
    expect(m.precision).toBeCloseTo(2 / 3, 3);
    expect(m.noise).toBeCloseTo(1 / 3, 3);
  });

  it('reports missed edges as false negatives and low recall', () => {
    const result = resultOf([node('a', 'before_triggers')], [edge('a', 'x', 'confirmed')]);
    const m = compare(result, TRUTH);
    expect(m.falseNegatives).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.coverage).toBe(0.5);
  });

  it('flags missed confirmed edges in false-omission rate', () => {
    const result = resultOf([node('b', 'after_triggers')], [edge('b', 'y', 'inferred')]);
    const m = compare(result, TRUTH); // misses expected-confirmed a->x
    expect(m.falseOmissionRate).toBe(1);
  });

  it('drops phase-ordering credit when a matched edge is in the wrong phase', () => {
    const result = resultOf(
      [node('a', 'after_triggers'), node('b', 'after_triggers')], // a expected in before_triggers
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred')],
    );
    const m = compare(result, TRUTH);
    expect(m.phaseOrderingAccuracy).toBe(0.5);
  });
});
