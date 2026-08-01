// Candidate formal-pilot register. Nine scenarios - declarative/programmatic/mixed x valid/static-fail/
// risk - from existing families, provisional design ground truth. Candidate only, not org-validated.

import type { GroundTruth, GroundTruthEdge, GroundTruthNode } from '../evaluation/groundTruth.js';
import type { ScenarioCluster } from '../evaluation/scenario.js';
import type { FileMap } from './mutation.js';
import { generateTopologyInstances } from './topologyGenerator.js';
import type { ExpectedNode, TopologyInstance } from './topologyGenerator.js';
import type { Candidate, CandidateVariant } from './reconstructionEval.js';

function phaseIndex(nodes: ExpectedNode[]): Map<string, string> {
  return new Map(nodes.map((node) => [node.id, node.phase]));
}

// Provisional ground truth from a topology's design expected graph.
function provisionalGroundTruth(instance: TopologyInstance, id: string): GroundTruth {
  const phases = phaseIndex(instance.expectedNodes);
  const nodes: GroundTruthNode[] = instance.expectedNodes.map((node) => ({
    id: node.id,
    phase: node.phase,
    type: node.type,
    detectability: 'static-direct',
  }));
  const edges: GroundTruthEdge[] = instance.expectedEdges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    relationship: edge.relationship,
    phase: phases.get(edge.from) ?? 'before_save_flows',
    detectability: edge.detectability,
  }));
  return { id, nodes, edges, source: 'provisional-design', notes: 'candidate, not org-validated' };
}

// Remove the first Apex class (and meta) or first flow, so a referenced component is absent - a direct
// static failure.
function removeFirstComponent(files: FileMap): FileMap {
  const next = { ...files };
  const cls = Object.keys(next)
    .sort()
    .find((path) => /\/classes\/[^/]+\.cls$/.test(path));
  if (cls) {
    delete next[cls];
    delete next[cls.replace(/\.cls$/, '.cls-meta.xml')];
    return next;
  }
  const flow = Object.keys(next)
    .sort()
    .find((path) => /\/flows\/[^/]+\.flow-meta\.xml$/.test(path));
  if (flow) delete next[flow];
  return next;
}

// Add a dynamic SOQL construct static analysis cannot resolve to the first trigger.
function addDynamicToTrigger(files: FileMap, object: string): FileMap {
  const triggerPath = Object.keys(files)
    .sort()
    .find((path) => path.endsWith('.trigger'));
  if (!triggerPath) return files;
  const source = files[triggerPath] ?? '';
  const injected = source.replace(
    /\)\s*\{\n/,
    (match) =>
      `${match}    String q = 'SELECT Id FROM ${object}';\n    List<SObject> rows = Database.query(q);\n    System.debug(rows.size());\n`,
  );
  return { ...files, [triggerPath]: injected };
}

function variantFiles(instance: TopologyInstance, variant: CandidateVariant): FileMap {
  if (variant === 'static_fail') return removeFirstComponent(instance.files);
  if (variant === 'risk') return addDynamicToTrigger(instance.files, instance.params.primaryObject);
  return instance.files;
}

const VARIANTS: CandidateVariant[] = ['valid', 'static_fail', 'risk'];
const CLUSTER_FAMILIES: { cluster: ScenarioCluster; family: string }[] = [
  { cluster: 'declarative', family: 'declarative_single' },
  { cluster: 'programmatic', family: 'programmatic_single' },
  { cluster: 'mixed', family: 'mixed_single' },
];

// Nine candidate scenarios: three clusters times three variants.
export function pilotCandidates(): Candidate[] {
  const instances = generateTopologyInstances(1, 'cand');
  const byFamily = new Map(instances.map((instance) => [instance.familyId, instance]));
  const candidates: Candidate[] = [];
  for (const { cluster, family } of CLUSTER_FAMILIES) {
    const instance = byFamily.get(family);
    if (!instance) continue;
    for (const variant of VARIANTS) {
      const id = `cand-${cluster}-${variant}`;
      candidates.push({
        id,
        cluster,
        variant,
        target: { object: instance.params.primaryObject, event: instance.params.event },
        files: variantFiles(instance, variant),
        groundTruth: provisionalGroundTruth(instance, id),
        salesforceValidated: false,
      });
    }
  }
  return candidates;
}
