// L3 reference extraction. Third cascade layer: parse node bodies and read direct dependency
// records, then emit dependency edges and enrich node evidence. State is assigned here by rule that
// creates edge: direct dependency record and explicit parsed reference are `confirmed`,
// coarse Apex symbol reference is `inferred`, dynamic or unrecoverable target is `unresolved` with
// reason in evidence detail. Parse failure never drops node - missed component is most expensive
// error for reviewer. Edges leave with score 0; L4 fills score for ranking only. Pure; source and
// dependency records are injected, so no network and no filesystem coupling.

import type { MetadataComponent, MetadataDependencyRecord } from '../../ingestion/orgSnapshot.js';
import { parseApexTrigger } from '../parse/apexParser.js';
import { parseFlow } from '../parse/flowParser.js';
import type { ConfidenceState, Evidence, ExecEdge, ExecNode } from '../types.js';
import type { InventoryItem } from './inventory.js';

// Resolve raw source body for one component, or undefined when body is unavailable offline. Keyed on
// component so subflow expansion can reuse it for flows outside initial inventory.
export type SourceResolver = (component: MetadataComponent) => string | undefined;

export interface ExtractInput {
  nodes: ExecNode[];
  items: InventoryItem[];
  sourceResolver?: SourceResolver;
  dependencies?: MetadataDependencyRecord[];
}

export interface ExtractResult {
  nodes: ExecNode[]; // same nodes with extraction evidence appended
  edges: ExecEdge[]; // dependency edges, provisional score/state
}

// Map raw metadata type to node-id prefix, so dependency targets share id scheme nodes use.
const TYPE_PREFIX: Record<string, string> = {
  ApexClass: 'apex_class',
  ApexTrigger: 'apex_trigger',
  Flow: 'flow',
  CustomObject: 'object',
  ValidationRule: 'validation_rule',
};

function targetId(type: string, name: string): string {
  return `${TYPE_PREFIX[type] ?? type.toLowerCase()}:${name}`;
}

// Dependency edge with rule-assigned state and evidence. Score is filled at assembly for ranking.
function edge(from: string, to: string, state: ConfidenceState, evidence: Evidence[]): ExecEdge {
  return { from, to, kind: 'dependency', state, score: 0, evidence };
}

export function extract(input: ExtractInput): ExtractResult {
  const nodes = input.nodes.map((node) => ({ ...node, evidence: [...node.evidence] }));
  const edges: ExecEdge[] = [];
  const itemsByName = new Map(input.items.map((item) => [item.fullName, item]));
  const resolve = input.sourceResolver;

  for (const node of nodes) {
    const item = itemsByName.get(node.apiName);
    const source = item && resolve ? resolve(item.source) : undefined;
    if (source === undefined) {
      continue; // no body offline: keep L2 evidence, add nothing
    }
    if (
      node.type === 'flow_before' ||
      node.type === 'flow_after' ||
      node.type === 'process_builder'
    ) {
      extractFlow(node, source, edges);
    } else if (node.type === 'apex_trigger') {
      extractApex(node, source, edges);
    }
  }

  extractDependencyRecords(nodes, input.dependencies ?? [], edges);
  return { nodes, edges };
}

// Flow body: record references become edges to their objects, subflows to their flows, explicit
// trigger order becomes config_link evidence on node. Parse error is captured on node.
function extractFlow(node: ExecNode, source: string, edges: ExecEdge[]): void {
  const flow = parseFlow(source);
  if (flow.errors.length > 0) {
    node.evidence.push({
      type: 'flow_xml_static',
      ref: node.apiName,
      detail: flow.errors.join('; '),
    });
    return;
  }
  node.evidence.push({ type: 'flow_xml_static', ref: node.apiName });
  if (flow.triggerOrder !== undefined) {
    node.evidence.push({
      type: 'config_link',
      ref: node.apiName,
      detail: `trigger order ${String(flow.triggerOrder)}`,
    });
  }
  for (const reference of flow.references) {
    if (reference.kind === 'subflow' && reference.flowName) {
      // Explicit subflow call in Flow XML - confirmed reference.
      edges.push(
        edge(node.id, targetId('Flow', reference.flowName), 'confirmed', [
          { type: 'flow_xml_static', ref: node.apiName, detail: `subflow ${reference.flowName}` },
        ]),
      );
    } else if (reference.object) {
      // Explicit record reference in Flow XML - confirmed reference.
      edges.push(
        edge(node.id, targetId('CustomObject', reference.object), 'confirmed', [
          {
            type: 'flow_xml_static',
            ref: node.apiName,
            detail: `${reference.kind} on ${reference.object}`,
          },
        ]),
      );
    }
  }
}

// Apex body: coarse symbol references become inferred edges to classes; dynamic constructs become
// unresolved edges to one target per node, carrying reason.
function extractApex(node: ExecNode, source: string, edges: ExecEdge[]): void {
  const parsed = parseApexTrigger(source);
  node.evidence.push({ type: 'apex_static', ref: node.apiName });
  for (const symbol of parsed.symbolRefs) {
    // Coarse symbol reference, not corroborated dependency - inferred.
    edges.push(
      edge(node.id, targetId('ApexClass', symbol), 'inferred', [
        { type: 'apex_static', ref: node.apiName, detail: `references ${symbol}` },
      ]),
    );
  }
  for (const reason of parsed.dynamic) {
    // Dynamically built target cannot be resolved statically - unresolved.
    edges.push(
      edge(node.id, `unresolved:${node.apiName}`, 'unresolved', [
        { type: 'heuristic', ref: node.apiName, detail: reason },
      ]),
    );
  }
}

// Direct dependency records: each record whose component matches node becomes confirmed edge to
// its referenced target. Strongest signal - direct platform dependency record.
function extractDependencyRecords(
  nodes: ExecNode[],
  records: MetadataDependencyRecord[],
  edges: ExecEdge[],
): void {
  const nodesByName = new Map<string, ExecNode[]>();
  for (const node of nodes) {
    const bucket = nodesByName.get(node.apiName);
    if (bucket) bucket.push(node);
    else nodesByName.set(node.apiName, [node]);
  }
  for (const record of records) {
    const from = nodesByName.get(record.componentName);
    if (!from) continue;
    for (const node of from) {
      edges.push(
        edge(node.id, targetId(record.refType, record.refName), 'confirmed', [
          {
            type: 'dependency_api',
            ref: record.refName,
            detail: `${record.componentType} -> ${record.refType}`,
          },
        ]),
      );
    }
  }
}
