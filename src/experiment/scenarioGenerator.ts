// Scenario generator. Crosses topology instances with mutation families into disjoint pilot and main
// scenarios, each with a manifest and a design-expectation ground truth derived from topology, not a run.

import { applyMutation } from './mutation.js';
import type {
  FailureClass,
  FileMap,
  MutationDetectability,
  MutationFamily,
  MutationManifest,
  MutationSpec,
  OracleStage,
} from './mutation.js';
import { generateTopologyInstances } from './topologyGenerator.js';
import type {
  Cluster,
  Complexity,
  ExpectedEdge,
  ExpectedNode,
  TopologyInstance,
} from './topologyGenerator.js';

// Design-expectation truth (layer A): what a correct outcome should be, derived before any run. The
// observed oracle result (layer B) is added later and never silently overwrites this.
export interface DesignExpectation {
  validationOutcome: 'pass' | 'fail';
  failureClass: FailureClass;
  detectability: MutationDetectability;
  requiredOracleStages: OracleStage[];
  affectedComponents: string[];
  expectedNodes: ExpectedNode[];
  expectedEdges: ExpectedEdge[];
  rationale: string;
}

export interface GeneratedScenario {
  id: string;
  kind: 'pilot' | 'main';
  topologyFamilyId: string;
  topologyInstanceId: string;
  cluster: Cluster;
  complexity: Complexity;
  mutationFamily: MutationFamily;
  mutationSpec: MutationSpec;
  mutationManifest: MutationManifest;
  designExpectation: DesignExpectation;
  changedFileHashes: Record<string, string>;
}

type RequiredKind = 'apex' | 'flow' | 'any';

interface FileTargets {
  apex: string; // empty when the instance has no apex
  flow: string; // empty when the instance has no flow
  anyFile: string;
}

interface FamilyPlan {
  family: MutationFamily;
  kind: RequiredKind;
  spec: (id: string, files: FileTargets) => MutationSpec;
}

function base(id: string, family: MutationFamily, seed: number): MutationSpec {
  return {
    id,
    family,
    seed,
    baseTopologyId: '',
    target: { object: 'Account', event: 'update' },
  };
}

// Each family and the file kind it needs, plus how to target it deterministically.
const FAMILY_PLANS: FamilyPlan[] = [
  {
    family: 'control_noop',
    kind: 'any',
    spec: (id, f) => ({ ...base(id, 'control_noop', 1), file: f.anyFile }),
  },
  {
    family: 'valid_impacting',
    kind: 'any',
    spec: (id, f) => ({ ...base(id, 'valid_impacting', 1), file: f.anyFile }),
  },
  {
    family: 'cross_object_impact',
    kind: 'any',
    spec: (id, f) => ({ ...base(id, 'cross_object_impact', 1), file: f.anyFile }),
  },
  {
    family: 'missing_field_reference',
    kind: 'apex',
    spec: (id, f) => ({
      ...base(id, 'missing_field_reference', 1),
      file: f.apex,
      token: 'records',
    }),
  },
  {
    family: 'missing_dependency',
    kind: 'apex',
    spec: (id, f) => ({ ...base(id, 'missing_dependency', 1), removeFile: f.apex }),
  },
  {
    family: 'apex_compile_break',
    kind: 'apex',
    spec: (id, f) => ({ ...base(id, 'apex_compile_break', 1), file: f.apex }),
  },
  {
    family: 'recursion_risk',
    kind: 'apex',
    spec: (id, f) => ({ ...base(id, 'recursion_risk', 1), file: f.apex }),
  },
  {
    family: 'dynamic_unresolved',
    kind: 'apex',
    spec: (id, f) => ({ ...base(id, 'dynamic_unresolved', 1), file: f.apex }),
  },
  {
    family: 'runtime_failure',
    kind: 'apex',
    spec: (id, f) => ({ ...base(id, 'runtime_failure', 1), file: f.apex }),
  },
  {
    family: 'test_only_failure',
    kind: 'apex',
    spec: (id, f) => ({ ...base(id, 'test_only_failure', 1), file: f.apex }),
  },
  {
    family: 'flow_reference_break',
    kind: 'flow',
    spec: (id, f) => ({
      ...base(id, 'flow_reference_break', 1),
      file: f.flow,
      token: 'recordCreates',
    }),
  },
  {
    family: 'inactive_component',
    kind: 'flow',
    spec: (id, f) => ({
      ...base(id, 'inactive_component', 1),
      file: f.flow,
      token: 'Active',
      replacement: 'Draft',
    }),
  },
];

function findFile(instance: TopologyInstance, matcher: RegExp): string | undefined {
  return Object.keys(instance.files)
    .sort()
    .find((path) => matcher.test(path));
}

function targets(instance: TopologyInstance): FileTargets {
  const apex =
    findFile(instance, /\/classes\/[^/]+\.cls$/) ??
    findFile(instance, /\/triggers\/[^/]+\.trigger$/) ??
    '';
  const flow = findFile(instance, /\/flows\/[^/]+\.flow-meta\.xml$/) ?? '';
  const anyFile = apex || flow || Object.keys(instance.files).sort()[0] || '';
  return { apex, flow, anyFile };
}

function applicablePlans(instance: TopologyInstance): FamilyPlan[] {
  const t = targets(instance);
  return FAMILY_PLANS.filter((plan) => {
    if (plan.kind === 'apex') return t.apex !== '';
    if (plan.kind === 'flow') return t.flow !== '';
    return true;
  });
}

function designExpectation(
  instance: TopologyInstance,
  manifest: MutationManifest,
): DesignExpectation {
  return {
    validationOutcome: manifest.expectedValidity === 'invalid' ? 'fail' : 'pass',
    failureClass: manifest.expectedFailureClass,
    detectability: manifest.detectability,
    requiredOracleStages: manifest.requiredOracleStages,
    affectedComponents: manifest.expectedAffectedComponents,
    expectedNodes: instance.expectedNodes,
    expectedEdges: instance.expectedEdges,
    rationale: `${manifest.family} applied to ${instance.instanceId}: ${manifest.operations[0]?.detail ?? 'change'}`,
  };
}

function scenariosFor(
  instance: TopologyInstance,
  kind: 'pilot' | 'main',
  mutationsPer: number,
  rotation: number,
): GeneratedScenario[] {
  const plans = applicablePlans(instance);
  if (plans.length === 0) return [];
  const t = targets(instance);
  const chosen: FamilyPlan[] = [];
  for (let i = 0; i < mutationsPer && i < plans.length; i += 1) {
    chosen.push(plans[(rotation + i) % plans.length] as FamilyPlan);
  }
  return chosen.map((plan) => {
    const id = `${kind}-${instance.instanceId}-${plan.family}`;
    const spec: MutationSpec = {
      ...plan.spec(id, t),
      baseTopologyId: instance.instanceId,
      target: { object: instance.params.primaryObject, event: instance.params.event },
    };
    const { manifest } = applyMutation(instance.files, spec);
    return {
      id,
      kind,
      topologyFamilyId: instance.familyId,
      topologyInstanceId: instance.instanceId,
      cluster: instance.cluster,
      complexity: instance.complexity,
      mutationFamily: plan.family,
      mutationSpec: spec,
      mutationManifest: manifest,
      designExpectation: designExpectation(instance, manifest),
      changedFileHashes: manifest.changedFileHashes,
    };
  });
}

function benchmarkInstances(): TopologyInstance[] {
  return [
    ...generateTopologyInstances(3, 'main'),
    ...generateTopologyInstances(3, 'pilot').slice(0, 9),
  ];
}

// Generate the full benchmark: 72 main scenarios (24 instances x 3 mutations) and 18 pilot scenarios
// (9 held-out instances x 2 mutations), disjoint by namespace.
export function generateBenchmark(): { pilot: GeneratedScenario[]; main: GeneratedScenario[] } {
  const mainInstances = generateTopologyInstances(3, 'main');
  const main = mainInstances.flatMap((instance, index) => scenariosFor(instance, 'main', 3, index));

  const pilotInstances = generateTopologyInstances(3, 'pilot').slice(0, 9);
  const pilot = pilotInstances.flatMap((instance, index) =>
    scenariosFor(instance, 'pilot', 2, index),
  );

  return { pilot, main };
}

// Index from topology instance id to its clean base file map, so the live runner can re-materialise a
// scenario from its recorded instance id.
export function topologyFilesIndex(): Map<string, FileMap> {
  return new Map(benchmarkInstances().map((instance) => [instance.instanceId, instance.files]));
}

// Index from topology instance id to the full instance, so the clean-topology gate can validate a base
// before its scenarios run.
export function topologyInstanceIndex(): Map<string, TopologyInstance> {
  return new Map(benchmarkInstances().map((instance) => [instance.instanceId, instance]));
}
