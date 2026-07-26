import { describe, expect, it } from 'vitest';
import { assemble } from '../../../src/core/cascade/assemble.js';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../../src/core/score/index.js';
import { assertValidExecNode } from '../../../src/core/validate.js';
import type { ExecEdge, ExecNode } from '../../../src/core/types.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

function node(
  id: string,
  phase: string,
  evidence: ExecNode['evidence'],
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
    state: 'inferred',
    score: 0,
    evidence,
    ...(excludeReason ? { excludeReason } : {}),
  };
}

function edge(from: string, to: string, evidence: ExecEdge['evidence']): ExecEdge {
  return { from, to, kind: 'dependency', state: 'unresolved', score: 0, evidence };
}

describe('assemble (L4)', () => {
  it('scores nodes from evidence and resolves state by threshold', () => {
    const { nodes } = assemble({
      nodes: [
        node('a', 'after_save_flows', [{ type: 'dependency_api', ref: 'a' }]), // 0.9 -> confirmed
        node('b', 'after_save_flows', [{ type: 'config_link', ref: 'b' }]), // 0.5 -> inferred
        node('c', 'after_save_flows', [{ type: 'heuristic', ref: 'c' }]), // 0.2 -> unresolved
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

  it('keeps scope exclusion over any score', () => {
    const { nodes } = assemble({
      nodes: [node('x', 'after_save_flows', [{ type: 'dependency_api', ref: 'x' }], 'inactive')],
      edges: [],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    expect(nodes[0]?.state).toBe('excluded');
    expect(nodes[0]?.excludeReason).toBe('inactive');
  });

  it('excludes nodes in an asynchronous phase', () => {
    const { nodes } = assemble({
      nodes: [node('async', 'post_commit', [{ type: 'dependency_api', ref: 'async' }])],
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

  it('merges duplicate nodes and edges by id, unioning evidence', () => {
    const { nodes, edges } = assemble({
      nodes: [
        node('a', 'after_save_flows', [{ type: 'flow_xml_static', ref: 'a' }]),
        node('a', 'after_save_flows', [{ type: 'dependency_api', ref: 'a' }]),
      ],
      edges: [
        edge('a', 'object:Contact', [{ type: 'flow_xml_static', ref: 'a' }]),
        edge('a', 'object:Contact', [{ type: 'dependency_api', ref: 'a' }]),
      ],
      weights: WEIGHTS,
      phaseModel: MODEL,
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.evidence).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.state).toBe('confirmed'); // 0.6 + 0.9 clamped -> confirmed
  });

  it('freezes node, edge and evidence order deterministically', () => {
    const input = {
      nodes: [
        node('b', 'after_save_flows', [
          { type: 'config_link', ref: 'b' },
          { type: 'apex_static', ref: 'b' },
        ]),
        node('a', 'after_save_flows', [{ type: 'flow_xml_static', ref: 'a' }]),
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
