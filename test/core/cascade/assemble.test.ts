import { describe, expect, it } from 'vitest';
import { assemble } from '../../../src/core/cascade/assemble.js';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../../src/core/score/index.js';
import { assertValidExecNode } from '../../../src/core/validate.js';
import type { ConfidenceState, ExecEdge, ExecNode } from '../../../src/core/types.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

function node(
  id: string,
  phase: string,
  evidence: ExecNode['evidence'],
  state: ConfidenceState = 'confirmed',
  excludeReason?: string,
): ExecNode {
  return {
    id,
    apiName: id,
    label: id,
    type: 'flow_after',
    object: 'Account',
    phase,
    active: true,
    state,
    score: 0,
    evidence,
    ...(excludeReason ? { excludeReason } : {}),
  };
}

function edge(
  from: string,
  to: string,
  evidence: ExecEdge['evidence'],
  state: ConfidenceState = 'confirmed',
): ExecEdge {
  return { from, to, kind: 'dependency', state, score: 0, evidence };
}

describe('assemble (L4)', () => {
  it('keeps the assigned state and falls to unresolved when evidence is absent', () => {
    const { nodes } = assemble({
      nodes: [
        node('a', 'after_save_flows', [{ type: 'dependency_api', ref: 'a' }], 'confirmed'),
        node('b', 'after_save_flows', [{ type: 'config_link', ref: 'b' }], 'inferred'),
        node('c', 'after_save_flows', [], 'confirmed'), // no evidence -> unresolved
      ],
      edges: [],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.state]));
    expect(byId['a']).toBe('confirmed');
    expect(byId['b']).toBe('inferred');
    expect(byId['c']).toBe('unresolved');
  });

  it('fills a ranking score from evidence without deriving state from it', () => {
    const { nodes } = assemble({
      nodes: [node('a', 'after_save_flows', [{ type: 'config_link', ref: 'a' }], 'confirmed')],
      edges: [],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    expect(nodes[0]?.score).toBeCloseTo(WEIGHTS.evidenceWeights.config_link);
    expect(nodes[0]?.state).toBe('confirmed'); // score below confirmed threshold, state still confirmed
  });

  it('keeps scope exclusion over evidence', () => {
    const { nodes } = assemble({
      nodes: [
        node(
          'x',
          'after_save_flows',
          [{ type: 'dependency_api', ref: 'x' }],
          'excluded',
          'inactive',
        ),
      ],
      edges: [],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    expect(nodes[0]?.state).toBe('excluded');
    expect(nodes[0]?.excludeReason).toBe('inactive');
  });

  it('excludes nodes in an asynchronous phase', () => {
    const { nodes } = assemble({
      nodes: [
        node('async', 'post_commit', [{ type: 'dependency_api', ref: 'async' }], 'confirmed'),
      ],
      edges: [],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    expect(nodes[0]?.state).toBe('excluded');
    expect(nodes[0]?.excludeReason).toMatch(/asynchronous/i);
    expect(() => {
      assertValidExecNode(nodes[0]!);
    }).not.toThrow();
  });

  it('merges duplicates by id, unioning evidence and keeping the strongest state', () => {
    const { nodes, edges } = assemble({
      nodes: [
        node('a', 'after_save_flows', [{ type: 'flow_xml_static', ref: 'a' }], 'inferred'),
        node('a', 'after_save_flows', [{ type: 'dependency_api', ref: 'a' }], 'confirmed'),
      ],
      edges: [
        edge('a', 'object:Contact', [{ type: 'apex_static', ref: 'a' }], 'inferred'),
        edge('a', 'object:Contact', [{ type: 'dependency_api', ref: 'a' }], 'confirmed'),
      ],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.evidence).toHaveLength(2);
    expect(nodes[0]?.state).toBe('confirmed');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.state).toBe('confirmed');
  });

  it('freezes node, edge and evidence order deterministically', () => {
    const input = {
      nodes: [
        node(
          'b',
          'after_save_flows',
          [
            { type: 'config_link', ref: 'b' },
            { type: 'apex_static', ref: 'b' },
          ],
          'confirmed',
        ),
        node('a', 'after_save_flows', [{ type: 'flow_xml_static', ref: 'a' }], 'confirmed'),
      ],
      edges: [edge('b', 'z', []), edge('a', 'y', [])],
      weights: WEIGHTS,
      phaseModel: MODEL,
    };
    const first = assemble(input);
    const second = assemble(input);
    expect(first).toEqual(second);
    expect(first.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(first.edges.map((e) => e.from)).toEqual(['a', 'b']);
    expect(first.nodes[1]?.evidence.map((e) => e.type)).toEqual(['apex_static', 'config_link']);
  });
});
