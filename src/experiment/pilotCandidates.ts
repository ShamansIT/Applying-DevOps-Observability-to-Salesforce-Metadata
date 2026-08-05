// Candidate formal-pilot register. Nine scenarios - declarative/programmatic/mixed x valid/static-fail/
// risk - each a real deployable project with a clean and a mutated form, a variant-specific ground truth
// and a justified expected prototype category. Candidate only, not org-validated.

import { createHash } from 'node:crypto';
import type { AnalysisTarget } from '../core/index.js';
import type { GroundTruth, GroundTruthEdge, GroundTruthNode } from '../evaluation/groundTruth.js';
import type { ScenarioCluster } from '../evaluation/scenario.js';
import type { FileMap } from './mutation.js';
import { projectChecksum } from './project.js';
import type {
  Candidate,
  CandidateManifest,
  CandidateVariant,
  ExpectedPrototypeCategory,
} from './reconstructionEval.js';

// --- Metadata builders (deployable sfdx layout the snapshot builder parses) ---

const PROJECT_FILES: FileMap = {
  'sfdx-project.json': `${JSON.stringify(
    { packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' },
    null,
    2,
  )}\n`,
  'config/project-scratch-def.json': `${JSON.stringify(
    { orgName: 'candidate', edition: 'Developer', features: [], settings: {} },
    null,
    2,
  )}\n`,
};

const CLS_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n</ApexClass>\n';
const TRG_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n</ApexTrigger>\n';

function apexClass(name: string, obj: string, body: string): FileMap {
  return {
    [`force-app/main/default/classes/${name}.cls`]: `public with sharing class ${name} {\n  public static void run(List<${obj}> records) {\n${body}\n  }\n}\n`,
    [`force-app/main/default/classes/${name}.cls-meta.xml`]: CLS_META,
  };
}

function apexTrigger(name: string, obj: string, body: string): FileMap {
  return {
    [`force-app/main/default/triggers/${name}.trigger`]: `trigger ${name} on ${obj} (before update) {\n${body}\n}\n`,
    [`force-app/main/default/triggers/${name}.trigger-meta.xml`]: TRG_META,
  };
}

// An after-save record-triggered flow with one record operation and, optionally, a subflow call. After-
// save is required: the modelled operations create a related record, update the triggering record, or
// invoke a subflow - none of which a before-save flow may do (Salesforce restricts before-save to $Record
// field updates via Assignment/Decision/Get/Loop only). Required deploy fields - <label>, canvas
// coordinates, a connected Start and element connectors - make the Flow valid. The parser reads only
// start, record ops and subflows, so the reconstructed graph and ground truth are unchanged by the
// coordinates and connectors.
function flow(
  name: string,
  obj: string,
  op: { tag: string; object: string },
  subflow?: string,
): FileMap {
  const opName = `${op.tag}_${name}`;
  const callName = subflow ? `Call_${subflow}` : '';
  // recordUpdates re-updates the triggering record (Id = $Record.Id); recordCreates sets one field.
  const opConfig =
    op.tag === 'recordUpdates'
      ? `    <filterLogic>and</filterLogic>\n    <filters>\n      <field>Id</field>\n      <operator>EqualTo</operator>\n      <value>\n        <elementReference>$Record.Id</elementReference>\n      </value>\n    </filters>\n    <inputAssignments>\n      <field>Description</field>\n      <value>\n        <stringValue>touched</stringValue>\n      </value>\n    </inputAssignments>\n`
      : `    <inputAssignments>\n      <field>LastName</field>\n      <value>\n        <stringValue>Auto</stringValue>\n      </value>\n    </inputAssignments>\n    <storeOutputAutomatically>true</storeOutputAutomatically>\n`;
  // With a subflow, the record op connects on to the Subflow element; otherwise it is the last element.
  const opConnector = subflow
    ? `    <connector>\n      <targetReference>${callName}</targetReference>\n    </connector>\n`
    : '';
  const subflowXml = subflow
    ? `  <subflows>\n    <name>${callName}</name>\n    <label>${callName}</label>\n    <locationX>176</locationX>\n    <locationY>350</locationY>\n    <flowName>${subflow}</flowName>\n  </subflows>\n`
    : '';
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n` +
    `  <apiVersion>67.0</apiVersion>\n  <label>${name}</label>\n  <status>Active</status>\n` +
    `  <processType>AutoLaunchedFlow</processType>\n` +
    `  <start>\n    <locationX>50</locationX>\n    <locationY>0</locationY>\n` +
    `    <connector>\n      <targetReference>${opName}</targetReference>\n    </connector>\n` +
    `    <object>${obj}</object>\n    <recordTriggerType>Update</recordTriggerType>\n` +
    `    <triggerType>RecordAfterSave</triggerType>\n  </start>\n` +
    `  <${op.tag}>\n    <name>${opName}</name>\n    <label>${opName}</label>\n` +
    `    <locationX>176</locationX>\n    <locationY>158</locationY>\n` +
    opConfig +
    opConnector +
    `    <object>${op.object}</object>\n  </${op.tag}>\n` +
    subflowXml +
    `</Flow>\n`;
  return { [`force-app/main/default/flows/${name}.flow-meta.xml`]: xml };
}

// A called subflow: a valid autolaunched flow whose Start is connected to one record-create element, so
// it deploys ("nothing is connected to the Start element" otherwise). Its internals are not scored - the
// static_fail mutation deletes it, and ground truth carries only the caller's invokes edge.
function subflowDefinition(name: string): FileMap {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n` +
    `  <apiVersion>67.0</apiVersion>\n  <label>${name}</label>\n  <status>Active</status>\n` +
    `  <processType>AutoLaunchedFlow</processType>\n` +
    `  <start>\n    <locationX>50</locationX>\n    <locationY>0</locationY>\n` +
    `    <connector>\n      <targetReference>Create_${name}</targetReference>\n    </connector>\n  </start>\n` +
    `  <recordCreates>\n    <name>Create_${name}</name>\n    <label>Create_${name}</label>\n` +
    `    <locationX>176</locationX>\n    <locationY>158</locationY>\n` +
    `    <inputAssignments>\n      <field>LastName</field>\n      <value>\n        <stringValue>Auto</stringValue>\n      </value>\n    </inputAssignments>\n` +
    `    <object>Contact</object>\n    <storeOutputAutomatically>true</storeOutputAutomatically>\n  </recordCreates>\n` +
    `</Flow>\n`;
  return { [`force-app/main/default/flows/${name}.flow-meta.xml`]: xml };
}

function validationRule(obj: string, name: string): FileMap {
  return {
    [`force-app/main/default/objects/${obj}/validationRules/${name}.validationRule-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">\n  <fullName>${name}</fullName>\n  <active>true</active>\n  <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>\n  <errorMessage>Name is required</errorMessage>\n</ValidationRule>\n`,
  };
}

// --- Ground-truth helpers (ids follow the core's stable scheme) ---

const TRIGGER_PHASE = 'before_triggers';
// After-save phase: the modelled flows create/update related or own records and (declarative static_fail)
// call a subflow - operations Salesforce permits only in after-save record-triggered flows, never before-
// save. See the protocol amendment in docs/EXPERIMENT.md.
const FLOW_PHASE = 'after_save_flows';
const VR_PHASE = 'custom_validation';

function gtNode(id: string, phase: string, type: string): GroundTruthNode {
  return { id, phase, type, detectability: 'static-direct' };
}

function triggerId(obj: string, name: string): string {
  return `apex_trigger:${obj}:${name}:${TRIGGER_PHASE}`;
}
function flowId(obj: string, name: string): string {
  return `flow_after:${obj}:${name}`;
}

// --- Assembly ---

const OBJ = 'Account';
const TARGET: AnalysisTarget = { object: 'Account', event: 'update' };

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function manifest(operation: string, clean: FileMap, mutated: FileMap): CandidateManifest {
  const paths = new Set([...Object.keys(clean), ...Object.keys(mutated)]);
  const changedFiles: string[] = [];
  const changedFileHashes: Record<string, string> = {};
  for (const path of [...paths].sort()) {
    if (clean[path] !== mutated[path]) {
      changedFiles.push(path);
      const content = mutated[path];
      changedFileHashes[path] = content === undefined ? 'deleted' : sha256(content);
    }
  }
  return { operation, changedFiles, changedFileHashes, effective: changedFiles.length > 0 };
}

function fingerprint(files: FileMap): string {
  const counts: Record<string, number> = {
    apexClass: 0,
    apexTrigger: 0,
    flow: 0,
    validationRule: 0,
  };
  for (const path of Object.keys(files)) {
    if (/\/classes\/[^/]+\.cls$/.test(path)) counts.apexClass = (counts.apexClass ?? 0) + 1;
    else if (/\/triggers\/[^/]+\.trigger$/.test(path))
      counts.apexTrigger = (counts.apexTrigger ?? 0) + 1;
    else if (/\/flows\/[^/]+\.flow-meta\.xml$/.test(path)) counts.flow = (counts.flow ?? 0) + 1;
    else if (/validationRule-meta\.xml$/.test(path)) {
      counts.validationRule = (counts.validationRule ?? 0) + 1;
    }
  }
  return createHash('sha256')
    .update(`${JSON.stringify(counts)}|${Object.keys(files).sort().join(',')}`)
    .digest('hex')
    .slice(0, 16);
}

interface Spec {
  cluster: ScenarioCluster;
  variant: CandidateVariant;
  operation: string;
  clean: FileMap;
  mutated: FileMap;
  groundTruth: (id: string) => GroundTruth;
  designExpectation: Candidate['designExpectation'];
  expected: ExpectedPrototypeCategory;
}

function assemble(spec: Spec): Candidate {
  const id = `cand-${spec.cluster}-${spec.variant}`;
  return {
    id,
    cluster: spec.cluster,
    variant: spec.variant,
    target: TARGET,
    cleanFiles: spec.clean,
    mutatedFiles: spec.mutated,
    cleanHash: projectChecksum(spec.clean),
    mutatedHash: projectChecksum(spec.mutated),
    fingerprint: fingerprint(spec.mutated),
    mutationManifest: manifest(spec.operation, spec.clean, spec.mutated),
    designExpectation: spec.designExpectation,
    expectedPrototypeCategory: spec.expected,
    groundTruth: spec.groundTruth(id),
    salesforceValidated: false,
  };
}

// Programmatic: a trigger invokes a handler class.
function programmatic(): Candidate[] {
  const trg = 'Prog_Trigger';
  const handler = 'Prog_Handler';
  const base: FileMap = {
    ...PROJECT_FILES,
    ...apexClass(handler, OBJ, '    System.debug(records.size());'),
    ...apexTrigger(trg, OBJ, `    ${handler}.run(Trigger.new);`),
  };
  const invokeEdge = (id: string): GroundTruthEdge => ({
    from: triggerId(OBJ, trg),
    to: `apex_class:${handler}`,
    relationship: 'invokes',
    phase: TRIGGER_PHASE,
    detectability: 'static-inferred',
    source: id,
  });

  const validMutated: FileMap = {
    ...base,
    [`force-app/main/default/classes/${handler}.cls`]: `public with sharing class ${handler} {\n  public static void run(List<${OBJ}> records) {\n    System.debug(records.size());\n  }\n  public static Integer sizeOf(List<${OBJ}> records) {\n    return records.size();\n  }\n}\n`,
  };
  const failMutated: FileMap = { ...base };
  delete failMutated[`force-app/main/default/classes/${handler}.cls`];
  delete failMutated[`force-app/main/default/classes/${handler}.cls-meta.xml`];
  const riskMutated: FileMap = {
    ...base,
    [`force-app/main/default/triggers/${trg}.trigger`]: `trigger ${trg} on ${OBJ} (before update) {\n    String q = 'SELECT Id FROM ${OBJ}';\n    List<SObject> rows = Database.query(q);\n    System.debug(rows.size());\n    ${handler}.run(Trigger.new);\n}\n`,
  };

  return [
    assemble({
      cluster: 'programmatic',
      variant: 'valid',
      operation: 'add a valid method to the handler',
      clean: base,
      mutated: validMutated,
      groundTruth: (id) => ({
        id,
        nodes: [gtNode(triggerId(OBJ, trg), TRIGGER_PHASE, 'apex_trigger')],
        edges: [invokeEdge(id)],
      }),
      designExpectation: {
        validationOutcome: 'pass',
        failureClass: 'none',
        detectability: 'out-of-scope',
      },
      expected: 'no_concern',
    }),
    assemble({
      cluster: 'programmatic',
      variant: 'static_fail',
      operation: 'remove the referenced handler class',
      clean: base,
      mutated: failMutated,
      groundTruth: (id) => ({
        id,
        nodes: [gtNode(triggerId(OBJ, trg), TRIGGER_PHASE, 'apex_trigger')],
        edges: [invokeEdge(id)],
      }),
      designExpectation: {
        validationOutcome: 'fail',
        failureClass: 'missing_dependency',
        detectability: 'static-direct',
      },
      expected: 'blocking',
    }),
    assemble({
      cluster: 'programmatic',
      variant: 'risk',
      operation: 'add a dynamic SOQL query to the trigger',
      clean: base,
      mutated: riskMutated,
      groundTruth: (id) => ({
        id,
        nodes: [gtNode(triggerId(OBJ, trg), TRIGGER_PHASE, 'apex_trigger')],
        edges: [
          invokeEdge(id),
          {
            from: triggerId(OBJ, trg),
            to: `object:${OBJ}`,
            relationship: 'reads',
            phase: TRIGGER_PHASE,
            detectability: 'runtime-only',
            source: id,
          },
        ],
      }),
      designExpectation: {
        validationOutcome: 'pass',
        failureClass: 'none',
        detectability: 'runtime-only',
      },
      expected: 'risk_or_unresolved',
    }),
  ];
}

// Mixed: a trigger, a handler, a flow and a validation rule.
function mixed(): Candidate[] {
  const trg = 'Mix_Trigger';
  const handler = 'Mix_Handler';
  const flw = 'Mix_Flow';
  const base: FileMap = {
    ...PROJECT_FILES,
    ...apexClass(handler, OBJ, '    System.debug(records.size());'),
    ...apexTrigger(trg, OBJ, `    ${handler}.run(Trigger.new);`),
    ...flow(flw, OBJ, { tag: 'recordCreates', object: 'Contact' }),
    ...validationRule(OBJ, 'Mix_Require_Name'),
  };
  const nodes = (): GroundTruthNode[] => [
    gtNode(triggerId(OBJ, trg), TRIGGER_PHASE, 'apex_trigger'),
    gtNode(flowId(OBJ, flw), FLOW_PHASE, 'flow_after'),
    gtNode(`validation_rule:${OBJ}:${OBJ}.Mix_Require_Name`, VR_PHASE, 'validation_rule'),
  ];
  const staticEdges = (id: string): GroundTruthEdge[] => [
    {
      from: triggerId(OBJ, trg),
      to: `apex_class:${handler}`,
      relationship: 'invokes',
      phase: TRIGGER_PHASE,
      detectability: 'static-inferred',
      source: id,
    },
    {
      from: flowId(OBJ, flw),
      to: 'object:Contact',
      relationship: 'writes',
      phase: FLOW_PHASE,
      detectability: 'static-direct',
      source: id,
    },
  ];

  const validMutated: FileMap = { ...base, ...validationRule(OBJ, 'Mix_Require_Industry') };
  const failMutated: FileMap = { ...base };
  delete failMutated[`force-app/main/default/classes/${handler}.cls`];
  delete failMutated[`force-app/main/default/classes/${handler}.cls-meta.xml`];
  const riskMutated: FileMap = {
    ...base,
    [`force-app/main/default/triggers/${trg}.trigger`]: `trigger ${trg} on ${OBJ} (before update) {\n    String q = 'SELECT Id FROM ${OBJ}';\n    List<SObject> rows = Database.query(q);\n    System.debug(rows.size());\n    ${handler}.run(Trigger.new);\n}\n`,
  };

  return [
    assemble({
      cluster: 'mixed',
      variant: 'valid',
      operation: 'add a second validation rule',
      clean: base,
      mutated: validMutated,
      groundTruth: (id) => ({
        id,
        nodes: [
          ...nodes(),
          gtNode(`validation_rule:${OBJ}:${OBJ}.Mix_Require_Industry`, VR_PHASE, 'validation_rule'),
        ],
        edges: staticEdges(id),
      }),
      designExpectation: {
        validationOutcome: 'pass',
        failureClass: 'none',
        detectability: 'out-of-scope',
      },
      expected: 'no_concern',
    }),
    assemble({
      cluster: 'mixed',
      variant: 'static_fail',
      operation: 'remove the referenced handler class',
      clean: base,
      mutated: failMutated,
      groundTruth: (id) => ({ id, nodes: nodes(), edges: staticEdges(id) }),
      designExpectation: {
        validationOutcome: 'fail',
        failureClass: 'missing_dependency',
        detectability: 'static-direct',
      },
      expected: 'blocking',
    }),
    assemble({
      cluster: 'mixed',
      variant: 'risk',
      operation: 'add a dynamic SOQL query to the trigger',
      clean: base,
      mutated: riskMutated,
      groundTruth: (id) => ({
        id,
        nodes: nodes(),
        edges: [
          ...staticEdges(id),
          {
            from: triggerId(OBJ, trg),
            to: `object:${OBJ}`,
            relationship: 'reads',
            phase: TRIGGER_PHASE,
            detectability: 'runtime-only',
            source: id,
          },
        ],
      }),
      designExpectation: {
        validationOutcome: 'pass',
        failureClass: 'none',
        detectability: 'runtime-only',
      },
      expected: 'risk_or_unresolved',
    }),
  ];
}

// Declarative: flows and validation rules, no Apex. Static failure is a missing subflow; risk is a flow
// updating its own trigger object (re-entry).
function declarative(): Candidate[] {
  // valid: a flow writing to a related object, plus a validation rule; the mutation adds a rule.
  const dvFlow = 'Dec_Flow';
  const validBase: FileMap = {
    ...PROJECT_FILES,
    ...flow(dvFlow, OBJ, { tag: 'recordCreates', object: 'Contact' }),
    ...validationRule(OBJ, 'Dec_Require_Name'),
  };
  const validMutated: FileMap = { ...validBase, ...validationRule(OBJ, 'Dec_Require_Industry') };

  // static_fail: a flow calls a subflow; the mutation removes the subflow definition.
  const dsfFlow = 'Dec_Caller';
  const dsfSub = 'Dec_Sub';
  const failBase: FileMap = {
    ...PROJECT_FILES,
    ...flow(dsfFlow, OBJ, { tag: 'recordCreates', object: 'Contact' }, dsfSub),
    ...subflowDefinition(dsfSub),
  };
  const failMutated: FileMap = { ...failBase };
  delete failMutated[`force-app/main/default/flows/${dsfSub}.flow-meta.xml`];

  // risk: a flow that updates its own trigger object - a re-entry hint.
  const drFlow = 'Dec_Reentry';
  const riskBase: FileMap = {
    ...PROJECT_FILES,
    ...flow(drFlow, OBJ, { tag: 'recordCreates', object: 'Contact' }),
  };
  const riskMutated: FileMap = {
    ...PROJECT_FILES,
    ...flow(drFlow, OBJ, { tag: 'recordUpdates', object: OBJ }),
  };

  return [
    assemble({
      cluster: 'declarative',
      variant: 'valid',
      operation: 'add a second validation rule',
      clean: validBase,
      mutated: validMutated,
      groundTruth: (id) => ({
        id,
        nodes: [
          gtNode(flowId(OBJ, dvFlow), FLOW_PHASE, 'flow_after'),
          gtNode(`validation_rule:${OBJ}:${OBJ}.Dec_Require_Name`, VR_PHASE, 'validation_rule'),
          gtNode(`validation_rule:${OBJ}:${OBJ}.Dec_Require_Industry`, VR_PHASE, 'validation_rule'),
        ],
        edges: [
          {
            from: flowId(OBJ, dvFlow),
            to: 'object:Contact',
            relationship: 'writes',
            phase: FLOW_PHASE,
            detectability: 'static-direct',
            source: id,
          },
        ],
      }),
      designExpectation: {
        validationOutcome: 'pass',
        failureClass: 'none',
        detectability: 'out-of-scope',
      },
      expected: 'no_concern',
    }),
    assemble({
      cluster: 'declarative',
      variant: 'static_fail',
      operation: 'remove the called subflow',
      clean: failBase,
      mutated: failMutated,
      groundTruth: (id) => ({
        id,
        nodes: [gtNode(flowId(OBJ, dsfFlow), FLOW_PHASE, 'flow_after')],
        edges: [
          {
            from: flowId(OBJ, dsfFlow),
            to: `flow:${dsfSub}`,
            relationship: 'invokes',
            phase: FLOW_PHASE,
            detectability: 'static-direct',
            source: id,
          },
        ],
      }),
      designExpectation: {
        validationOutcome: 'fail',
        failureClass: 'flow_reference',
        detectability: 'static-direct',
      },
      expected: 'blocking',
    }),
    assemble({
      cluster: 'declarative',
      variant: 'risk',
      operation: 'change the flow to update its own trigger object',
      clean: riskBase,
      mutated: riskMutated,
      groundTruth: (id) => ({
        id,
        nodes: [gtNode(flowId(OBJ, drFlow), FLOW_PHASE, 'flow_after')],
        edges: [
          {
            from: flowId(OBJ, drFlow),
            to: `object:${OBJ}`,
            relationship: 'writes',
            phase: FLOW_PHASE,
            detectability: 'risk-only',
            source: id,
          },
        ],
      }),
      designExpectation: {
        validationOutcome: 'pass',
        failureClass: 'none',
        detectability: 'risk-only',
      },
      expected: 'risk_or_unresolved',
    }),
  ];
}

// Nine candidate scenarios: three clusters times three variants.
export function pilotCandidates(): Candidate[] {
  return [...declarative(), ...programmatic(), ...mixed()];
}
