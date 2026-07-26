import { describe, expect, it } from 'vitest';
import { computeRisk } from '../../../src/core/risk/indicators.js';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import type { InventoryItem } from '../../../src/core/cascade/inventory.js';
import type { ExecEdge, ExecNode, NodeType } from '../../../src/core/types.js';

const MODEL = loadPhaseModel();

function node(
  id: string,
  phase: string,
  type: NodeType = 'flow_after',
  state: ExecNode['state'] = 'confirmed',
): ExecNode {
  return {
    id,
    apiName: id,
    label: id,
    type,
    object: 'Account',
    phase,
    active: true,
    state,
    score: 1,
    evidence: [],
  };
}

function edge(from: string, to: string, state: ExecEdge['state'] = 'confirmed'): ExecEdge {
  return { from, to, kind: 'dependency', state, score: 1, evidence: [] };
}

function item(nodeType: NodeType, fullName: string, active = true): InventoryItem {
  return {
    fullName,
    object: 'Account',
    nodeType,
    timings: [],
    active,
    legacy: false,
    source: { type: 'X', fullName, attributes: {} },
  };
}

function byKey(nodes: ExecNode[], edges: ExecEdge[], items: InventoryItem[] = []) {
  const indicators = computeRisk({ nodes, edges, items, phaseModel: MODEL });
  return Object.fromEntries(indicators.map((i) => [i.key, i]));
}

describe('computeRisk (seven indicators)', () => {
  it('returns all seven in fixed order with a character each', () => {
    const indicators = computeRisk({ nodes: [], edges: [], items: [], phaseModel: MODEL });
    expect(indicators.map((i) => i.key)).toEqual([
      'fan_in_out',
      'cross_phase_coupling',
      'unresolved_references',
      'low_confidence_cluster',
      'deferred_post_commit_reachability',
      'recursion_reentry_hint',
      'automation_density_per_object',
    ]);
    expect(
      indicators.every((i) => i.character === 'deterministic' || i.character === 'heuristic'),
    ).toBe(true);
  });

  it('flags cross-phase coupling only when endpoints sit in different phases', () => {
    const nodes = [
      node('before_triggers:Account:T', 'before_triggers'),
      node('after_triggers:Account:T', 'after_triggers'),
    ];
    const r = byKey(nodes, [edge(nodes[0]!.id, nodes[1]!.id)]);
    expect(r['cross_phase_coupling']?.flagged).toBe(true);
    expect(r['cross_phase_coupling']?.value).toBe(1);
  });

  it('measures unresolved reference share deterministically', () => {
    const r = byKey([], [edge('a', 'b', 'unresolved'), edge('a', 'c', 'confirmed')]);
    expect(r['unresolved_references']?.value).toBe(0.5);
    expect(r['unresolved_references']?.character).toBe('deterministic');
  });

  it('flags deferred reachability as heuristic for async-phase nodes', () => {
    const r = byKey([node('post_commit:Account:X', 'post_commit')], []);
    expect(r['deferred_post_commit_reachability']?.flagged).toBe(true);
    expect(r['deferred_post_commit_reachability']?.character).toBe('heuristic');
  });

  it('hints recursion when a node writes back to its own object', () => {
    const n = node('flow_after:Account:F', 'after_save_flows');
    const r = byKey([n], [edge(n.id, 'object:Account')]);
    expect(r['recursion_reentry_hint']?.flagged).toBe(true);
    expect(r['recursion_reentry_hint']?.character).toBe('heuristic');
  });

  it('counts automation density from active inventory only', () => {
    const items = [
      item('flow_before', 'A'),
      item('apex_trigger', 'B'),
      item('validation_rule', 'C', false),
    ];
    const r = byKey([], [], items);
    expect(r['automation_density_per_object']?.value).toBe(2);
  });

  it('flags fan-in/out above threshold', () => {
    const hub = node('flow_after:Account:Hub', 'after_save_flows');
    const edges = Array.from({ length: 6 }, (_, i) => edge(hub.id, `t${String(i)}`));
    const r = byKey([hub], edges);
    expect(r['fan_in_out']?.flagged).toBe(true);
    expect(r['fan_in_out']?.nodes).toContain(hub.id);
  });
});
