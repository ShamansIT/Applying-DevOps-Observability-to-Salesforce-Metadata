import { describe, expect, it } from 'vitest';
import { compare } from '../../src/evaluation/compare.js';
import type { GroundTruth } from '../../src/evaluation/groundTruth.js';
import type { ReconstructResult } from '../../src/core/index.js';
import type { ExecEdge, ExecNode } from '../../src/core/types.js';

function node(id: string, phase: string, state: ExecNode['state'] = 'confirmed'): ExecNode {
  return {
    id,
    apiName: id,
    label: id,
    type: 'apex_trigger',
    object: 'Account',
    phase,
    active: true,
    state,
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
  nodes: [
    { id: 'a', phase: 'before_triggers' },
    { id: 'b', phase: 'after_triggers' },
  ],
  edges: [
    { from: 'a', to: 'x', phase: 'before_triggers', expected: 'confirmed' },
    { from: 'b', to: 'y', phase: 'after_triggers', expected: 'inferred' },
  ],
};

describe('compare', () => {
  it('scores a perfect reconstruction as precision and recall 1 across nodes and edges', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred')],
    );
    const m = compare(result, TRUTH);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.nodePrecision).toBe(1);
    expect(m.nodeRecall).toBe(1);
    expect(m.phaseAccuracy).toBe(1);
    expect(m.orderedPathCoverage).toBe(1);
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
    expect(m.distribution.unresolved).toBe(1);
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

  it('counts a spurious claimed node against node precision', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers'), node('c', 'before_triggers')],
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred')],
    );
    const m = compare(result, TRUTH);
    expect(m.claimedNodes).toBe(3);
    expect(m.nodeTruePositives).toBe(2);
    expect(m.nodePrecision).toBeCloseTo(2 / 3, 3);
    expect(m.nodeRecall).toBe(1);
  });

  it('reports missed edges as false negatives and drops ordered path coverage', () => {
    const result = resultOf([node('a', 'before_triggers')], [edge('a', 'x', 'confirmed')]);
    const m = compare(result, TRUTH);
    expect(m.falseNegatives).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.nodeRecall).toBe(0.5);
    // placed: node a in phase + edge a->x from a; backbone: 2 nodes + 2 edges
    expect(m.orderedPathCoverage).toBe(0.5);
  });

  it('flags missed confirmed edges in false-omission rate', () => {
    const result = resultOf([node('b', 'after_triggers')], [edge('b', 'y', 'inferred')]);
    const m = compare(result, TRUTH); // misses expected-confirmed a->x
    expect(m.falseOmissionRate).toBe(1);
  });

  it('drops phase-assignment credit when a matched node is in the wrong phase', () => {
    const result = resultOf(
      [node('a', 'after_triggers'), node('b', 'after_triggers')], // a expected in before_triggers
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred')],
    );
    const m = compare(result, TRUTH);
    expect(m.phaseAccuracy).toBe(0.5);
  });

  it('keeps ambiguous expectations out of the denominators', () => {
    const truth: GroundTruth = {
      id: 'T',
      nodes: [{ id: 'a', phase: 'before_triggers' }],
      edges: [
        { from: 'a', to: 'x', phase: 'before_triggers', expected: 'confirmed' },
        {
          from: 'a',
          to: 'maybe',
          phase: 'before_triggers',
          expected: 'inferred',
          adjudication: 'ambiguous',
        },
      ],
    };
    const result = resultOf([node('a', 'before_triggers')], [edge('a', 'x', 'confirmed')]);
    const m = compare(result, truth);
    expect(m.expected).toBe(1); // ambiguous edge not counted
    expect(m.recall).toBe(1);
    expect(m.ambiguousExcluded).toBe(1);
  });

  it('scores boundary handling apart - over-claiming a boundary edge fails it', () => {
    const truth: GroundTruth = {
      id: 'T',
      edges: [
        { from: 'a', to: 'x', phase: 'before_triggers', expected: 'confirmed' },
        {
          from: 'a',
          to: 'edge_case',
          phase: 'before_triggers',
          expected: 'confirmed',
          adjudication: 'boundary',
        },
      ],
    };
    const overClaim = resultOf(
      [node('a', 'before_triggers')],
      [edge('a', 'x', 'confirmed'), edge('a', 'edge_case', 'confirmed')],
    );
    expect(compare(overClaim, truth).boundaryAccuracy).toBe(0);
    expect(compare(overClaim, truth).expected).toBe(1); // boundary edge out of main denominator

    const restrained = resultOf(
      [node('a', 'before_triggers')],
      [edge('a', 'x', 'confirmed'), edge('a', 'edge_case', 'unresolved')],
    );
    expect(compare(restrained, truth).boundaryAccuracy).toBe(1);
  });

  it('reports a full confidence-state distribution over nodes and edges', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers', 'excluded')],
      [edge('a', 'x', 'confirmed'), edge('b', 'y', 'inferred'), edge('a', 'z', 'unresolved')],
    );
    const m = compare(result, TRUTH);
    expect(m.distribution).toEqual({ confirmed: 2, inferred: 1, unresolved: 1, excluded: 1 });
  });
});
