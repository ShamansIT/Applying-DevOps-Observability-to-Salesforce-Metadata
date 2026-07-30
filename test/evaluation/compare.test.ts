import { describe, expect, it } from 'vitest';
import { compare } from '../../src/evaluation/compare.js';
import type { GroundTruth } from '../../src/evaluation/groundTruth.js';
import type { ReconstructResult } from '../../src/core/index.js';
import type { ExecEdge, ExecNode, RelationshipKind } from '../../src/core/types.js';

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

function edge(
  from: string,
  to: string,
  state: ExecEdge['state'],
  relationship: RelationshipKind = 'depends_on',
): ExecEdge {
  return { from, to, kind: 'dependency', relationship, state, score: 1, evidence: [] };
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
    { from: 'a', to: 'x', relationship: 'depends_on', phase: 'before_triggers' },
    { from: 'b', to: 'y', relationship: 'invokes', phase: 'after_triggers' },
  ],
};

describe('compare', () => {
  it('scores a perfect reconstruction as precision and recall 1 across nodes and edges', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed', 'depends_on'), edge('b', 'y', 'inferred', 'invokes')],
    );
    const m = compare(result, TRUTH);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.nodePrecision).toBe(1);
    expect(m.nodeRecall).toBe(1);
    expect(m.phaseAccuracy).toBe(1);
    expect(m.orderedPathCoverage).toBe(1);
    expect(m.relationshipAccuracy).toBe(1);
  });

  it('does not match a right pair with the wrong relationship', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed', 'writes'), edge('b', 'y', 'inferred', 'invokes')],
    );
    const m = compare(result, TRUTH); // a->x claimed as writes, expected depends_on
    expect(m.truePositives).toBe(1); // only b->y matches
    expect(m.falsePositives).toBe(1); // a->x writes is spurious
    expect(m.relationshipAccuracy).toBe(0.5); // both pairs found, one relationship wrong
  });

  it('does not penalise unresolved edges - they are not claims', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [
        edge('a', 'x', 'confirmed', 'depends_on'),
        edge('b', 'y', 'inferred', 'invokes'),
        edge('a', 'junk', 'unresolved'),
      ],
    );
    const m = compare(result, TRUTH);
    expect(m.claimed).toBe(2);
    expect(m.precision).toBe(1);
    expect(m.finalEdgeNoiseRate).toBe(0);
    expect(m.distribution.unresolved).toBe(1);
  });

  it('counts a spurious claimed edge in the final edge noise rate', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers')],
      [
        edge('a', 'x', 'confirmed', 'depends_on'),
        edge('b', 'y', 'inferred', 'invokes'),
        edge('a', 'wrong', 'confirmed'),
      ],
    );
    const m = compare(result, TRUTH);
    expect(m.falsePositives).toBe(1);
    expect(m.precision).toBeCloseTo(2 / 3, 3);
    expect(m.finalEdgeNoiseRate).toBeCloseTo(1 / 3, 3);
  });

  it('flags a missed static-direct edge in the final omission rate', () => {
    const truth: GroundTruth = {
      id: 'T',
      edges: [
        {
          from: 'a',
          to: 'x',
          relationship: 'depends_on',
          phase: 'before_triggers',
          detectability: 'static-direct',
        },
      ],
    };
    const result = resultOf([node('a', 'before_triggers')], []);
    const m = compare(result, truth);
    expect(m.recall).toBe(0);
    expect(m.finalExpectedEdgeOmissionRate).toBe(1);
  });

  it('scores a runtime-only edge apart and credits leaving it unresolved', () => {
    const truth: GroundTruth = {
      id: 'T',
      edges: [
        { from: 'a', to: 'x', relationship: 'depends_on', phase: 'before_triggers' },
        {
          from: 'a',
          to: 'dyn',
          relationship: 'reads',
          phase: 'before_triggers',
          detectability: 'runtime-only',
        },
      ],
    };
    const result = resultOf(
      [node('a', 'before_triggers')],
      [edge('a', 'x', 'confirmed', 'depends_on'), edge('a', 'placeholder', 'unresolved')],
    );
    const m = compare(result, truth);
    expect(m.expected).toBe(1); // runtime-only edge not in the static denominator
    expect(m.recall).toBe(1);
    expect(m.runtimeOnlyExpected).toBe(1);
    expect(m.runtimeOnlyHandled).toBe(1); // tool did not falsely claim it
  });

  it('drops phase credit when a matched node is in the wrong phase', () => {
    const result = resultOf(
      [node('a', 'after_triggers'), node('b', 'after_triggers')],
      [edge('a', 'x', 'confirmed', 'depends_on'), edge('b', 'y', 'inferred', 'invokes')],
    );
    const m = compare(result, TRUTH);
    expect(m.phaseAccuracy).toBe(0.5);
  });

  it('keeps ambiguous expectations out of the denominators', () => {
    const truth: GroundTruth = {
      id: 'T',
      edges: [
        { from: 'a', to: 'x', relationship: 'depends_on', phase: 'before_triggers' },
        {
          from: 'a',
          to: 'maybe',
          relationship: 'reads',
          phase: 'before_triggers',
          adjudication: 'ambiguous',
        },
      ],
    };
    const result = resultOf([node('a', 'before_triggers')], [edge('a', 'x', 'confirmed')]);
    const m = compare(result, truth);
    expect(m.expected).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.ambiguousExcluded).toBe(1);
  });

  it('fails boundary handling on any positive claim, inferred included', () => {
    const truth: GroundTruth = {
      id: 'T',
      edges: [
        {
          from: 'a',
          to: 'edge_case',
          relationship: 'depends_on',
          phase: 'before_triggers',
          adjudication: 'boundary',
        },
      ],
    };
    expect(
      compare(resultOf([node('a', 'before_triggers')], [edge('a', 'edge_case', 'inferred')]), truth)
        .boundaryAccuracy,
    ).toBe(0);
    expect(
      compare(
        resultOf([node('a', 'before_triggers')], [edge('a', 'edge_case', 'unresolved')]),
        truth,
      ).boundaryAccuracy,
    ).toBe(1);
  });

  it('reports a full confidence-state distribution over nodes and edges', () => {
    const result = resultOf(
      [node('a', 'before_triggers'), node('b', 'after_triggers', 'excluded')],
      [
        edge('a', 'x', 'confirmed', 'depends_on'),
        edge('b', 'y', 'inferred', 'invokes'),
        edge('a', 'z', 'unresolved'),
      ],
    );
    const m = compare(result, TRUTH);
    expect(m.distribution).toEqual({ confirmed: 2, inferred: 1, unresolved: 1, excluded: 1 });
  });
});
