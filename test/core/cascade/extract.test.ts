import { describe, expect, it } from 'vitest';
import { classify } from '../../../src/core/cascade/classify.js';
import { extract } from '../../../src/core/cascade/extract.js';
import type { SourceResolver } from '../../../src/core/cascade/extract.js';
import { inventory } from '../../../src/core/cascade/inventory.js';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import type {
  MetadataComponent,
  MetadataDependencyRecord,
  OrgSnapshot,
} from '../../../src/ingestion/index.js';

const MODEL = loadPhaseModel();

const FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>AutoLaunchedFlow</processType>
  <start><object>Account</object><triggerType>RecordAfterSave</triggerType><triggerOrder>50</triggerOrder></start>
  <recordUpdates><name>U</name><object>Contact</object></recordUpdates>
  <subflows><name>S</name><flowName>Shared_Logic</flowName></subflows>
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

const RESOLVER: SourceResolver = (component) =>
  component.type === 'ApexTrigger' ? APEX : component.type === 'Flow' ? FLOW_XML : undefined;

function run(dependencies?: MetadataDependencyRecord[]) {
  const items = inventory(SNAPSHOT, { object: 'Account', event: 'update' });
  const nodes = classify(items, MODEL);
  return extract({
    nodes,
    items,
    sourceResolver: RESOLVER,
    ...(dependencies ? { dependencies } : {}),
  });
}

describe('extract (L3)', () => {
  it('emits flow record and subflow edges and config-link evidence', () => {
    const { nodes, edges } = run();
    const flowNode = nodes.find((n) => n.type === 'flow_after');
    expect(flowNode?.evidence.some((e) => e.type === 'flow_xml_static')).toBe(true);
    expect(flowNode?.evidence.some((e) => e.type === 'config_link')).toBe(true);
    expect(edges.some((e) => e.to === 'object:Contact')).toBe(true);
    expect(edges.some((e) => e.to === 'flow:Shared_Logic')).toBe(true);
  });

  it('emits apex symbol edges and marks dynamic references unresolvable', () => {
    const { edges } = run();
    expect(edges.some((e) => e.to === 'apex_class:AccountService')).toBe(true);
    const dynamic = edges.find((e) => e.to.startsWith('unresolved:'));
    expect(dynamic?.evidence[0]?.type).toBe('heuristic');
    expect(dynamic?.evidence[0]?.detail).toMatch(/dynamic SOQL/i);
  });

  it('turns matching dependency records into dependency_api edges', () => {
    const { edges } = run([
      {
        componentName: 'AccountTrigger',
        componentType: 'ApexTrigger',
        refName: 'AccountService',
        refType: 'ApexClass',
      },
    ]);
    const apiEdge = edges.find((e) => e.evidence.some((ev) => ev.type === 'dependency_api'));
    expect(apiEdge?.to).toBe('apex_class:AccountService');
  });

  it('keeps nodes and adds no edges when no source is available', () => {
    const items = inventory(SNAPSHOT, { object: 'Account', event: 'update' });
    const nodes = classify(items, MODEL);
    const result = extract({ nodes, items }); // no resolver
    expect(result.nodes).toHaveLength(nodes.length);
    expect(result.edges).toHaveLength(0);
  });

  it('captures flow parse error as evidence without dropping node', () => {
    const items = inventory(SNAPSHOT, { object: 'Account', event: 'update' });
    const nodes = classify(items, MODEL);
    const result = extract({
      nodes,
      items,
      sourceResolver: (component) => (component.type === 'Flow' ? '<broken' : undefined),
    });
    const flowNode = result.nodes.find((n) => n.type === 'flow_after');
    expect(flowNode).toBeDefined();
    expect(flowNode?.evidence.some((e) => e.detail?.includes('invalid'))).toBe(true);
  });
});
