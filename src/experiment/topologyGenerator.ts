// Parameterised topology generator. Each family is a template producing structurally distinct
// deployable instances - source files, expected graph, fingerprint, checksum - from parameters.

import { createHash } from 'node:crypto';
import type { FileMap } from './mutation.js';

export const TEMPLATE_VERSION = '1.0.0';

export type Cluster = 'declarative' | 'programmatic' | 'mixed';
export type Complexity = 'low' | 'medium' | 'high';
export type Detectability =
  'static-direct' | 'static-inferred' | 'risk-only' | 'runtime-only' | 'out-of-scope';

export interface TopologyParams {
  familyId: string;
  primaryObject: string;
  secondaryObject?: string;
  event: 'create' | 'update';
  timing: 'before' | 'after';
  flows: number;
  triggers: number;
  handlers: number;
  validationRules: number;
  crossObject: boolean;
  recursion: boolean;
  dynamic: boolean;
}

export interface ExpectedNode {
  id: string;
  phase: string;
  type: string;
}

export interface ExpectedEdge {
  from: string;
  to: string;
  relationship: 'invokes' | 'writes' | 'reads' | 'triggers' | 'depends_on';
  detectability: Detectability;
}

export interface StructuralFingerprint {
  componentTypeCounts: Record<string, number>;
  nodeCount: number;
  edgeCount: number;
  relationshipDistribution: Record<string, number>;
  maxPathDepth: number;
  phaseSpan: number;
  branchingFactor: number;
  crossObjectEdges: number;
  declarativeRatio: number;
  hasCycle: boolean;
}

export interface TopologyInstance {
  familyId: string;
  instanceId: string;
  templateVersion: string;
  seed: number;
  cluster: Cluster;
  complexity: Complexity;
  params: TopologyParams;
  files: FileMap;
  expectedNodes: ExpectedNode[];
  expectedEdges: ExpectedEdge[];
  fingerprint: StructuralFingerprint;
  checksum: string;
}

const TIMING_PHASE: Record<'before' | 'after', { trigger: string; flow: string }> = {
  before: { trigger: 'before_triggers', flow: 'before_save_flows' },
  after: { trigger: 'after_triggers', flow: 'after_save_flows' },
};

function triggerEvents(event: 'create' | 'update', timing: 'before' | 'after'): string {
  const verb = event === 'create' ? 'insert' : 'update';
  return `${timing} ${verb}`;
}

function apexClass(name: string, obj: string, body: string): FileMap {
  return {
    [`force-app/main/default/classes/${name}.cls`]: `public with sharing class ${name} {\n  public static void run(List<${obj}> records) {\n${body}\n  }\n}\n`,
    [`force-app/main/default/classes/${name}.cls-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n</ApexClass>\n`,
  };
}

function apexTrigger(
  name: string,
  obj: string,
  events: string,
  handler: string,
  dynamic: boolean,
): FileMap {
  const dyn = dynamic ? `    String q = 'SELECT Id FROM ' + obj;\n    Database.query(q);\n` : '';
  return {
    [`force-app/main/default/triggers/${name}.trigger`]: `trigger ${name} on ${obj} (${events}) {\n${dyn}    ${handler}.run(Trigger.new);\n}\n`,
    [`force-app/main/default/triggers/${name}.trigger-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n</ApexTrigger>\n`,
  };
}

function flow(
  name: string,
  obj: string,
  event: 'create' | 'update',
  timing: 'before' | 'after',
  target: string,
): FileMap {
  const triggerType = timing === 'before' ? 'RecordBeforeSave' : 'RecordAfterSave';
  const recordType = event === 'create' ? 'Create' : 'Update';
  return {
    [`force-app/main/default/flows/${name}.flow-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n  <processType>AutoLaunchedFlow</processType>\n  <start>\n    <object>${obj}</object>\n    <recordTriggerType>${recordType}</recordTriggerType>\n    <triggerType>${triggerType}</triggerType>\n  </start>\n  <recordCreates>\n    <name>Create_${target}</name>\n    <object>${target}</object>\n  </recordCreates>\n</Flow>\n`,
  };
}

function validationRule(obj: string, name: string): FileMap {
  return {
    [`force-app/main/default/objects/${obj}/validationRules/${name}.validationRule-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">\n  <fullName>${name}</fullName>\n  <active>true</active>\n  <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>\n  <errorMessage>Name is required</errorMessage>\n</ValidationRule>\n`,
  };
}

const PROJECT_FILES: FileMap = {
  'sfdx-project.json': `${JSON.stringify(
    { packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' },
    null,
    2,
  )}\n`,
  'config/project-scratch-def.json': `${JSON.stringify(
    { orgName: 'eval', edition: 'Developer', features: [], settings: {} },
    null,
    2,
  )}\n`,
};

// Build one topology from parameters: the deployable file map plus the graph the core should
// reconstruct. Ids follow the core's stable scheme so provisional ground truth matches reconstruction.
function buildTopology(
  params: TopologyParams,
  instanceId: string,
  seed: number,
  prefix: string,
): TopologyInstance {
  const obj = params.primaryObject;
  const target = params.crossObject && params.secondaryObject ? params.secondaryObject : obj;
  const phases = TIMING_PHASE[params.timing];
  let files: FileMap = { ...PROJECT_FILES };
  const nodes: ExpectedNode[] = [];
  const edges: ExpectedEdge[] = [];
  const pfx = prefix;

  const handlerNames = Array.from(
    { length: params.handlers },
    (_, i) => `${pfx}${obj}Handler${i + 1}`,
  );
  for (const handler of handlerNames) {
    const body = params.recursion
      ? `    update records;`
      : params.crossObject && params.secondaryObject
        ? `    List<${params.secondaryObject}> out = new List<${params.secondaryObject}>();`
        : `    System.debug(records.size());`;
    files = { ...files, ...apexClass(handler, obj, body) };
  }

  for (let t = 0; t < params.triggers; t += 1) {
    const name = `${pfx}${obj}Trigger${t + 1}`;
    const handler = handlerNames[t % Math.max(1, handlerNames.length)] ?? `${obj}Handler1`;
    files = {
      ...files,
      ...apexTrigger(
        name,
        obj,
        triggerEvents(params.event, params.timing),
        handler,
        params.dynamic,
      ),
    };
    const triggerId = `apex_trigger:${obj}:${name}:${phases.trigger}`;
    nodes.push({ id: triggerId, phase: phases.trigger, type: 'apex_trigger' });
    if (params.handlers > 0) {
      edges.push({
        from: triggerId,
        to: `apex_class:${handler}`,
        relationship: 'invokes',
        detectability: 'static-inferred',
      });
    }
    if (params.recursion) {
      edges.push({
        from: triggerId,
        to: `object:${obj}`,
        relationship: 'writes',
        detectability: 'risk-only',
      });
    }
    if (params.dynamic) {
      edges.push({
        from: triggerId,
        to: `object:${params.secondaryObject ?? obj}`,
        relationship: 'reads',
        detectability: 'runtime-only',
      });
    }
  }

  for (let f = 0; f < params.flows; f += 1) {
    const name = `${pfx}${obj}_Flow${f + 1}`;
    files = { ...files, ...flow(name, obj, params.event, params.timing, target) };
    const flowType = params.timing === 'before' ? 'flow_before' : 'flow_after';
    const flowId = `${flowType}:${obj}:${name}`;
    nodes.push({ id: flowId, phase: phases.flow, type: flowType });
    edges.push({
      from: flowId,
      to: `object:${target}`,
      relationship: 'writes',
      detectability: 'static-direct',
    });
  }

  for (let v = 0; v < params.validationRules; v += 1) {
    const name = `${pfx}Require_Field_${v + 1}`;
    files = { ...files, ...validationRule(obj, name) };
    nodes.push({
      id: `validation_rule:${obj}:${obj}.${name}`,
      phase: 'custom_validation',
      type: 'validation_rule',
    });
  }

  const fingerprint = fingerprintOf(params, nodes, edges);
  return {
    familyId: params.familyId,
    instanceId,
    templateVersion: TEMPLATE_VERSION,
    seed,
    cluster: clusterOf(params),
    complexity: complexityOf(nodes.length + edges.length),
    params,
    files,
    expectedNodes: nodes,
    expectedEdges: edges,
    fingerprint,
    checksum: createHash('sha256')
      .update(
        JSON.stringify(
          Object.keys(files)
            .sort()
            .map((k) => [k, files[k]]),
        ),
      )
      .digest('hex'),
  };
}

function clusterOf(params: TopologyParams): Cluster {
  const declarative = params.flows > 0 || params.validationRules > 0;
  const programmatic = params.triggers > 0 || params.handlers > 0;
  if (declarative && programmatic) return 'mixed';
  return programmatic ? 'programmatic' : 'declarative';
}

function complexityOf(size: number): Complexity {
  if (size <= 3) return 'low';
  if (size <= 7) return 'medium';
  return 'high';
}

function fingerprintOf(
  params: TopologyParams,
  nodes: ExpectedNode[],
  edges: ExpectedEdge[],
): StructuralFingerprint {
  const componentTypeCounts: Record<string, number> = {};
  for (const node of nodes) {
    componentTypeCounts[node.type] = (componentTypeCounts[node.type] ?? 0) + 1;
  }
  const relationshipDistribution: Record<string, number> = {};
  for (const edge of edges) {
    relationshipDistribution[edge.relationship] =
      (relationshipDistribution[edge.relationship] ?? 0) + 1;
  }
  const phases = new Set(nodes.map((n) => n.phase));
  const declarativeNodes = nodes.filter(
    (n) => n.type.startsWith('flow') || n.type === 'validation_rule',
  ).length;
  return {
    componentTypeCounts,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    relationshipDistribution,
    maxPathDepth: edges.length > 0 ? 1 : 0,
    phaseSpan: phases.size,
    branchingFactor: nodes.length > 0 ? Math.round((edges.length / nodes.length) * 100) / 100 : 0,
    crossObjectEdges: edges.filter((e) => e.to === `object:${params.secondaryObject ?? '__none__'}`)
      .length,
    declarativeRatio:
      nodes.length > 0 ? Math.round((declarativeNodes / nodes.length) * 100) / 100 : 0,
    hasCycle: params.recursion,
  };
}

// Each family produces distinct instances by varying object, event, timing and counts - not by
// renaming. Three instances per family, structurally different.
const FAMILIES: Record<string, (index: number) => TopologyParams> = {
  declarative_single: (i) =>
    base('declarative_single', {
      primaryObject: ['Account', 'Opportunity', 'Case'][i] ?? 'Account',
      flows: i + 1,
      validationRules: i,
      timing: i % 2 === 0 ? 'before' : 'after',
    }),
  programmatic_single: (i) =>
    base('programmatic_single', {
      primaryObject: ['Account', 'Contact', 'Lead'][i] ?? 'Account',
      triggers: 1,
      handlers: i + 1,
      timing: i % 2 === 0 ? 'before' : 'after',
    }),
  mixed_single: (i) =>
    base('mixed_single', {
      primaryObject: ['Account', 'Opportunity', 'Case'][i] ?? 'Account',
      flows: i + 1,
      triggers: 1,
      handlers: 1,
      validationRules: 1,
    }),
  declarative_cross: (i) =>
    base('declarative_cross', {
      primaryObject: ['Account', 'Opportunity', 'Case'][i] ?? 'Account',
      secondaryObject: ['Task', 'Contact', 'Event'][i] ?? 'Task',
      flows: i + 1,
      crossObject: true,
      timing: 'after',
    }),
  programmatic_cross: (i) =>
    base('programmatic_cross', {
      primaryObject: ['Account', 'Contact', 'Lead'][i] ?? 'Account',
      secondaryObject: ['Contact', 'Case', 'Task'][i] ?? 'Contact',
      triggers: 1,
      handlers: i + 1,
      crossObject: true,
    }),
  mixed_cross: (i) =>
    base('mixed_cross', {
      primaryObject: ['Account', 'Opportunity', 'Case'][i] ?? 'Account',
      secondaryObject: ['Task', 'Contact', 'Event'][i] ?? 'Task',
      flows: 1,
      triggers: 1,
      handlers: 1,
      crossObject: true,
    }),
  recursion: (i) =>
    base('recursion', {
      primaryObject: ['Account', 'Contact', 'Opportunity'][i] ?? 'Account',
      triggers: 1,
      handlers: 1,
      recursion: true,
      timing: i % 2 === 0 ? 'before' : 'after',
    }),
  dynamic: (i) =>
    base('dynamic', {
      primaryObject: ['Account', 'Contact', 'Case'][i] ?? 'Account',
      secondaryObject: ['Contact', 'Task', 'Lead'][i] ?? 'Contact',
      triggers: 1,
      handlers: 1,
      dynamic: true,
      crossObject: true,
    }),
};

function base(familyId: string, over: Partial<TopologyParams>): TopologyParams {
  return {
    familyId,
    primaryObject: 'Account',
    event: 'update',
    timing: 'before',
    flows: 0,
    triggers: 0,
    handlers: 0,
    validationRules: 0,
    crossObject: false,
    recursion: false,
    dynamic: false,
    ...over,
  };
}

export const TOPOLOGY_FAMILIES = Object.keys(FAMILIES);

// Generate all topology instances: each family, three structurally distinct instances. A tag
// namespaces component names, so a pilot set and a main set never share file content.
export function generateTopologyInstances(instancesPerFamily = 3, tag = ''): TopologyInstance[] {
  const out: TopologyInstance[] = [];
  for (const [familyId, make] of Object.entries(FAMILIES)) {
    for (let i = 0; i < instancesPerFamily; i += 1) {
      const params = make(i);
      const id = `${tag ? `${tag}-` : ''}${familyId}-${String(i + 1).padStart(2, '0')}`;
      // Per-instance component prefix so no two instances ever generate byte-identical files.
      const prefix = `${id.replace(/[^A-Za-z0-9]/g, '_')}_`;
      out.push(buildTopology(params, id, 1000 + i, prefix));
    }
  }
  return out;
}
