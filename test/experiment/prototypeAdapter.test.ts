import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadSnapshot } from '../../src/ingestion/index.js';
import { categorise, runPrototype } from '../../src/experiment/prototypeAdapter.js';
import type { ReconstructResult } from '../../src/core/index.js';
import type { ExecEdge, ExecNode } from '../../src/core/types.js';
import type { RiskIndicator } from '../../src/core/risk/indicators.js';

function result(parts: {
  nodes?: ExecNode[];
  edges?: ExecEdge[];
  risk?: RiskIndicator[];
}): ReconstructResult {
  return {
    skeleton: {
      target: { object: 'Account', event: 'update' },
      phases: [],
      candidateCount: 0,
      nodeCount: 0,
    },
    nodes: parts.nodes ?? [],
    edges: parts.edges ?? [],
    risk: parts.risk ?? [],
    meta: {
      object: 'Account',
      event: 'update',
      snapshotApiVersion: '67.0',
      phaseModelApiVersion: '67.0',
      depthLimit: 0,
      truncated: false,
      timings: [{ layer: 'L1', ms: 1 }],
      degraded: [],
    },
  };
}

function node(id: string, state: ExecNode['state']): ExecNode {
  return {
    id,
    apiName: id,
    label: id,
    type: 'apex_trigger',
    object: 'Account',
    phase: 'before_triggers',
    active: true,
    state,
    score: 1,
    evidence: [],
  };
}

function edge(from: string, state: ExecEdge['state']): ExecEdge {
  return {
    from,
    to: 'x',
    kind: 'dependency',
    relationship: 'depends_on',
    state,
    score: 1,
    evidence: [],
  };
}

function risk(flagged: boolean): RiskIndicator {
  return {
    key: 'recursion',
    label: 'recursion hint',
    character: 'deterministic',
    value: 1,
    flagged,
    nodes: ['a'],
  };
}

describe('categorise', () => {
  it('maps a flagged risk to a material warning', () => {
    const o = categorise(result({ nodes: [node('a', 'confirmed')], risk: [risk(true)] }));
    expect(o.predictionCategory).toBe('material_warning');
    expect(o.actionableFinding?.scope).toBe('risk');
  });

  it('maps an unresolved edge to unresolved', () => {
    const o = categorise(
      result({ nodes: [node('a', 'confirmed')], edges: [edge('a', 'unresolved')] }),
    );
    expect(o.predictionCategory).toBe('unresolved');
  });

  it('maps a clean claim graph to no blocking finding, never a proven pass', () => {
    const o = categorise(result({ nodes: [node('a', 'confirmed')] }));
    expect(o.predictionCategory).toBe('no_blocking_finding');
    expect(o.actionableFinding?.reason).toMatch(/org validation still required/);
  });

  it('maps an all-excluded graph to out of scope', () => {
    const o = categorise(result({ nodes: [node('a', 'excluded')] }));
    expect(o.predictionCategory).toBe('out_of_scope');
  });

  it('carries stage events from run meta', () => {
    const o = categorise(result({ nodes: [node('a', 'confirmed')] }));
    expect(o.stageEvents).toEqual([{ stage: 'L1', ms: 1 }]);
  });
});

describe('runPrototype', () => {
  it('runs the core on a real snapshot without throwing and categorises', () => {
    const snapshotPath = fileURLToPath(
      new URL('../../fixtures/snapshots/s01-eval.json', import.meta.url),
    );
    const snapshot = loadSnapshot(snapshotPath);
    const { outcome } = runPrototype(
      snapshot,
      { object: 'Account', event: 'update' },
      loadPhaseModel(),
      { sourceResolver: (component) => component.source },
    );
    expect(outcome.failed).toBe(false);
    expect(outcome.stageEvents.length).toBeGreaterThan(0);
    expect(['material_warning', 'unresolved', 'no_blocking_finding', 'out_of_scope']).toContain(
      outcome.predictionCategory,
    );
  });
});
