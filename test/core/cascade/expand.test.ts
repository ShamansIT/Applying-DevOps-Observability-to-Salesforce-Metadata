import { describe, expect, it } from 'vitest';
import { expand, subflowExpander } from '../../../src/core/cascade/expand.js';
import type { ExpandTarget } from '../../../src/core/cascade/expand.js';
import type { ExecEdge, ExecNode } from '../../../src/core/types.js';
import type { MetadataComponent, OrgSnapshot } from '../../../src/ingestion/index.js';

function node(id: string): ExecNode {
  return {
    id,
    apiName: id,
    label: id,
    type: 'flow_after',
    object: 'Account',
    phase: 'after_save_flows',
    active: true,
    state: 'inferred',
    score: 0,
    evidence: [],
  };
}

function edge(from: string, to: string): ExecEdge {
  return { from, to, kind: 'dependency', state: 'unresolved', score: 0, evidence: [] };
}

describe('expand (L5)', () => {
  it('is a no-op at depth 0', () => {
    const input = { nodes: [node('a')], edges: [edge('a', 'flow:B')], depthLimit: 0 };
    const target: ExpandTarget = () => undefined;
    const out = expand({ ...input, expandTarget: target });
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toHaveLength(1);
  });

  it('materializes targets up to the depth limit only', () => {
    // chain flow:B -> flow:C -> flow:D; depth 1 should reach B but not C
    const target: ExpandTarget = (id) => {
      const next = { 'flow:B': 'flow:C', 'flow:C': 'flow:D' }[id];
      return next ? { node: node(id), edges: [edge(id, next)] } : undefined;
    };
    const depth1 = expand({
      nodes: [node('a')],
      edges: [edge('a', 'flow:B')],
      depthLimit: 1,
      expandTarget: target,
    });
    expect(depth1.nodes.map((n) => n.id).sort()).toEqual(['a', 'flow:B']);

    const depth2 = expand({
      nodes: [node('a')],
      edges: [edge('a', 'flow:B')],
      depthLimit: 2,
      expandTarget: target,
    });
    expect(depth2.nodes.map((n) => n.id).sort()).toEqual(['a', 'flow:B', 'flow:C']);
  });

  it('guards cycles - a ring is materialized once, no infinite loop', () => {
    // flow:B -> flow:C -> flow:B
    const target: ExpandTarget = (id) => {
      const next = { 'flow:B': 'flow:C', 'flow:C': 'flow:B' }[id];
      return next ? { node: node(id), edges: [edge(id, next)] } : undefined;
    };
    const out = expand({
      nodes: [node('a')],
      edges: [edge('a', 'flow:B')],
      depthLimit: 10,
      expandTarget: target,
    });
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['a', 'flow:B', 'flow:C']);
  });
});

describe('subflowExpander', () => {
  const SUB = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>AutoLaunchedFlow</processType>
  <recordUpdates><name>U</name><object>Contact</object></recordUpdates>
</Flow>`;

  const snapshot: OrgSnapshot = {
    meta: {
      apiVersion: '67.0',
      capturedAt: '2026-01-01T00:00:00.000Z',
      source: 'fixture',
      toolVersion: '0.0.1',
    },
    components: [
      { type: 'Flow', fullName: 'Shared_Logic', object: 'Account', attributes: {} },
    ] satisfies MetadataComponent[],
  };

  it('expands a referenced flow into a node in the caller phase with its own edges', () => {
    const target = subflowExpander(snapshot, (component) =>
      component.fullName === 'Shared_Logic' ? SUB : undefined,
    );
    const caller = node('flow_after:Account:Parent');
    const out = expand({
      nodes: [caller],
      edges: [edge(caller.id, 'flow:Shared_Logic')],
      depthLimit: 1,
      expandTarget: target,
    });
    const materialized = out.nodes.find((n) => n.id === 'flow:Shared_Logic');
    expect(materialized?.phase).toBe('after_save_flows');
    expect(out.edges.some((e) => e.from === 'flow:Shared_Logic' && e.to === 'object:Contact')).toBe(
      true,
    );
  });

  it('ignores non-flow targets', () => {
    const target = subflowExpander(snapshot, () => undefined);
    expect(target('apex_class:Foo', 'after_save_flows')).toBeUndefined();
  });
});
