import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import {
  PREFLIGHT_RULES,
  PREFLIGHT_VERSION,
  componentIdsFromSnapshot,
  preflight,
} from '../../src/experiment/preflight.js';
import { runPrototype } from '../../src/experiment/prototypeAdapter.js';
import type { ReconstructResult } from '../../src/core/index.js';
import type { ExecEdge, EvidenceType } from '../../src/core/types.js';
import type { OrgSnapshot } from '../../src/ingestion/index.js';

function edge(to: string, evidenceTypes: EvidenceType[]): ExecEdge {
  return {
    from: 'apex_trigger:Account:AccountTrigger:before_triggers',
    to,
    kind: 'dependency',
    relationship: 'depends_on',
    state: 'confirmed',
    score: 1,
    evidence: evidenceTypes.map((type) => ({ type, ref: to })),
  };
}

function resultWith(edges: ExecEdge[]): ReconstructResult {
  return {
    skeleton: {
      target: { object: 'Account', event: 'update' },
      phases: [],
      candidateCount: 0,
      nodeCount: 0,
    },
    nodes: [],
    edges,
    risk: [],
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

const present = new Set(['apex_class:PresentService', 'apex_trigger:Account:AccountTrigger']);

describe('preflight', () => {
  it('exposes a version and a rule set', () => {
    expect(PREFLIGHT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PREFLIGHT_RULES.length).toBeGreaterThan(0);
  });

  it('emits a blocking finding for a source reference to a missing component', () => {
    const { blocking } = preflight({
      result: resultWith([edge('apex_class:MissingService', ['apex_static'])]),
      presentComponentIds: present,
    });
    expect(blocking).toHaveLength(1);
    expect(blocking[0]?.component).toBe('apex_class:MissingService');
    expect(blocking[0]?.ruleId).toBe('missing-component-reference');
  });

  it('does not fire when the component is present', () => {
    const { blocking } = preflight({
      result: resultWith([edge('apex_class:PresentService', ['apex_static'])]),
      presentComponentIds: present,
    });
    expect(blocking).toHaveLength(0);
  });

  it('does not fire when a dependency record confirms the target exists', () => {
    const { blocking } = preflight({
      result: resultWith([edge('apex_class:MissingService', ['apex_static', 'dependency_api'])]),
      presentComponentIds: present,
    });
    expect(blocking).toHaveLength(0);
  });

  it('does not fire on heuristic-only evidence', () => {
    const { blocking } = preflight({
      result: resultWith([edge('apex_class:MissingService', ['heuristic'])]),
      presentComponentIds: present,
    });
    expect(blocking).toHaveLength(0);
  });

  it('does not fire on objects or unresolved placeholders', () => {
    const { blocking } = preflight({
      result: resultWith([
        edge('object:Contact', ['flow_xml_static']),
        edge('unresolved:AccountTrigger', ['heuristic']),
      ]),
      presentComponentIds: present,
    });
    expect(blocking).toHaveLength(0);
  });

  it('maps a snapshot to component ids', () => {
    const ids = componentIdsFromSnapshot({
      meta: { apiVersion: '67.0', capturedAt: '', source: 'fixture', toolVersion: '0' },
      components: [{ type: 'ApexClass', fullName: 'AccountService', attributes: {} }],
    } as unknown as OrgSnapshot);
    expect(ids.has('apex_class:AccountService')).toBe(true);
  });
});

describe('runPrototype with preflight', () => {
  it('predicts a blocking finding when a referenced class is absent', () => {
    const snapshot = {
      meta: { apiVersion: '67.0', capturedAt: '', source: 'fixture', toolVersion: '0' },
      components: [
        {
          type: 'ApexTrigger',
          fullName: 'AccountTrigger',
          object: 'Account',
          attributes: { events: ['before update'], status: 'Active' },
          source:
            'trigger AccountTrigger on Account (before update) { MissingService.run(Trigger.new); }',
        },
      ],
    } as unknown as OrgSnapshot;

    const { outcome } = runPrototype(
      snapshot,
      { object: 'Account', event: 'update' },
      loadPhaseModel(),
      {
        sourceResolver: (component) => component.source,
      },
    );
    expect(outcome.predictionCategory).toBe('blocking_finding');
    expect(outcome.affectedComponents).toContain('apex_class:MissingService');
  });
});
