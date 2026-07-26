import { describe, expect, it } from 'vitest';
import { reconstruct } from '../../../src/core/cascade/reconstruct.js';
import type { SourceResolver } from '../../../src/core/cascade/extract.js';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../../src/core/score/index.js';
import type { MetadataComponent, OrgSnapshot } from '../../../src/ingestion/index.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

const FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>AutoLaunchedFlow</processType>
  <start><object>Account</object><triggerType>RecordAfterSave</triggerType></start>
  <recordUpdates><name>U</name><object>Contact</object></recordUpdates>
  <subflows><name>S</name><flowName>Shared_Logic</flowName></subflows>
</Flow>`;

const SUB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>AutoLaunchedFlow</processType>
  <recordUpdates><name>U</name><object>Case</object></recordUpdates>
</Flow>`;

const APEX = `trigger AccountTrigger on Account (before update) {
  AccountService.run(Trigger.new);
  List<SObject> r = Database.query('SELECT Id FROM ' + o);
}`;

const COMPONENTS: MetadataComponent[] = [
  {
    type: 'Flow',
    fullName: 'Account_After',
    object: 'Account',
    attributes: { triggerType: 'RecordAfterSave', status: 'Active' },
  },
  {
    type: 'ApexTrigger',
    fullName: 'AccountTrigger',
    object: 'Account',
    attributes: { events: ['before update'], status: 'Active' },
  },
  {
    type: 'Flow',
    fullName: 'Shared_Logic',
    object: 'Account',
    attributes: { processType: 'AutoLaunchedFlow' },
  },
];

const SNAPSHOT: OrgSnapshot = {
  meta: {
    apiVersion: '67.0',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'fixture',
    toolVersion: '0.0.1',
  },
  components: COMPONENTS,
};

const TARGET = { object: 'Account', event: 'update' as const };

const RESOLVER: SourceResolver = (component) => {
  if (component.type === 'ApexTrigger') return APEX;
  if (component.fullName === 'Account_After') return FLOW_XML;
  if (component.fullName === 'Shared_Logic') return SUB_XML;
  return undefined;
};

const DEPENDENCIES = [
  {
    componentName: 'AccountTrigger',
    componentType: 'ApexTrigger',
    refName: 'AccountService',
    refType: 'ApexClass',
  },
];

describe('reconstruct full cascade (L3-L5)', () => {
  it('extracts edges, scores nodes and returns seven risk indicators', () => {
    const result = reconstruct(SNAPSHOT, TARGET, MODEL, {
      sourceResolver: RESOLVER,
      dependencies: { records: DEPENDENCIES },
      weights: WEIGHTS,
    });
    expect(result.edges.some((e) => e.to === 'object:Contact')).toBe(true);
    expect(result.edges.some((e) => e.to === 'flow:Shared_Logic')).toBe(true);
    const apiEdge = result.edges.find((e) => e.to === 'apex_class:AccountService');
    expect(apiEdge?.state).toBe('confirmed'); // dependency_api weight lifts it
    expect(result.risk).toHaveLength(7);
  });

  it('runs offline with no source or dependencies and stays valid', () => {
    const result = reconstruct(SNAPSHOT, TARGET, MODEL, { weights: WEIGHTS });
    expect(result.edges).toEqual([]);
    expect(result.meta.degraded).toEqual([]);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('degrades dependency edges to unresolved and flags meta when truncated', () => {
    const result = reconstruct(SNAPSHOT, TARGET, MODEL, {
      sourceResolver: RESOLVER,
      dependencies: { records: DEPENDENCIES, truncated: true },
      weights: WEIGHTS,
    });
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.degraded).toContain('dependency_truncated');
    const apiEdge = result.edges.find((e) => e.to === 'apex_class:AccountService');
    expect(apiEdge?.state).toBe('unresolved');
  });

  it('marks dynamic apex references unresolved', () => {
    const result = reconstruct(SNAPSHOT, TARGET, MODEL, {
      sourceResolver: RESOLVER,
      weights: WEIGHTS,
    });
    const dynamic = result.edges.find((e) => e.to.startsWith('unresolved:'));
    expect(dynamic?.state).toBe('unresolved');
  });

  it('expands subflows only when depth is set', () => {
    const base = reconstruct(SNAPSHOT, TARGET, MODEL, {
      sourceResolver: RESOLVER,
      weights: WEIGHTS,
    });
    expect(base.nodes.some((n) => n.id === 'flow:Shared_Logic')).toBe(false);

    const deep = reconstruct(SNAPSHOT, TARGET, MODEL, {
      sourceResolver: RESOLVER,
      weights: WEIGHTS,
      depthLimit: 1,
    });
    expect(deep.nodes.some((n) => n.id === 'flow:Shared_Logic')).toBe(true);
    expect(deep.edges.some((e) => e.from === 'flow:Shared_Logic' && e.to === 'object:Case')).toBe(
      true,
    );
    expect(deep.meta.depthLimit).toBe(1);
  });

  it('is byte-identical across two runs, timings aside', () => {
    const opts = {
      sourceResolver: RESOLVER,
      dependencies: { records: DEPENDENCIES },
      weights: WEIGHTS,
      depthLimit: 1,
    };
    const a = reconstruct(SNAPSHOT, TARGET, MODEL, opts);
    const b = reconstruct(SNAPSHOT, TARGET, MODEL, opts);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
    expect(a.skeleton).toEqual(b.skeleton);
    expect(a.risk).toEqual(b.risk);
  });
});
