// L5 optional expansion. Fifth cascade layer, off by default: expand referenced targets (subflows,
// transitive flows) to configured depth, so deeper reach is deliberate choice, not always-on
// cost. Cycle guard keyed on stable id means flow that calls itself, directly or in ring, is
// visited once and never loops. Depth 0 returns input untouched. Materialized nodes leave with
// provisional score; L4 assembly scores and freezes them. Pure; source and snapshot injected.

import type { MetadataComponent, OrgSnapshot } from '../../ingestion/orgSnapshot.js';
import { parseFlow } from '../parse/flowParser.js';
import type { ExecEdge, ExecNode, NodeType, PhaseKey } from '../types.js';
import type { SourceResolver } from './extract.js';

// Materialize one referenced target: node plus its own outbound edges. Undefined when target is
// not expandable (unknown kind or component absent).
export type ExpandTarget = (targetId: string, parentPhase: PhaseKey) => ExpandResult | undefined;

export interface ExpandResult {
  node: ExecNode;
  edges: ExecEdge[];
}

export interface ExpandInput {
  nodes: ExecNode[];
  edges: ExecEdge[];
  depthLimit: number; // 0 keeps expansion off
  expandTarget: ExpandTarget;
}

interface Frontier {
  id: string;
  parentPhase: PhaseKey;
}

// Expand referenced targets breadth-first to depth. Order does not matter for output: L4 freezes it.
export function expand(input: ExpandInput): { nodes: ExecNode[]; edges: ExecEdge[] } {
  if (input.depthLimit <= 0) {
    return { nodes: input.nodes, edges: input.edges };
  }
  const nodes = [...input.nodes];
  const edges = [...input.edges];
  const known = new Set(nodes.map((node) => node.id));
  const phaseOf = new Map(nodes.map((node) => [node.id, node.phase]));

  let frontier = referencedTargets(edges, known, phaseOf);
  for (let depth = 0; depth < input.depthLimit; depth += 1) {
    const next: Frontier[] = [];
    for (const { id, parentPhase } of frontier) {
      if (known.has(id)) {
        continue; // cycle guard: already materialized
      }
      const hop = input.expandTarget(id, parentPhase);
      if (!hop) {
        continue;
      }
      known.add(hop.node.id);
      nodes.push(hop.node);
      edges.push(...hop.edges);
      for (const edge of hop.edges) {
        if (!known.has(edge.to)) {
          next.push({ id: edge.to, parentPhase: hop.node.phase });
        }
      }
    }
    frontier = next;
  }
  return { nodes, edges };
}

// Edge targets not yet materialized, each tagged with its source node's phase.
function referencedTargets(
  edges: ExecEdge[],
  known: Set<string>,
  phaseOf: Map<string, PhaseKey>,
): Frontier[] {
  const out: Frontier[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!known.has(edge.to) && !seen.has(edge.to)) {
      seen.add(edge.to);
      out.push({ id: edge.to, parentPhase: phaseOf.get(edge.from) ?? '' });
    }
  }
  return out;
}

// Build ExpandTarget that resolves `flow:<Name>` targets to their snapshot component, parses
// body, and returns subflow node in caller's phase plus its outbound references. Subflow runs
// within caller's phase, so it inherits parentPhase.
export function subflowExpander(snapshot: OrgSnapshot, resolver: SourceResolver): ExpandTarget {
  const flows = new Map<string, MetadataComponent>();
  for (const component of snapshot.components) {
    if (component.type === 'Flow') {
      flows.set(component.fullName, component);
    }
  }

  return (targetId, parentPhase) => {
    if (!targetId.startsWith('flow:')) {
      return undefined;
    }
    const name = targetId.slice('flow:'.length);
    const component = flows.get(name);
    if (!component) {
      return undefined;
    }
    const type: NodeType = parentPhase.includes('before') ? 'flow_before' : 'flow_after';
    const node: ExecNode = {
      id: targetId,
      apiName: name,
      label: name,
      type,
      object: component.object ?? '',
      phase: parentPhase,
      active: true,
      state: 'inferred',
      score: 0,
      evidence: [{ type: 'flow_xml_static', ref: name, detail: 'expanded subflow' }],
    };

    const edges: ExecEdge[] = [];
    const source = resolver(component);
    if (source !== undefined) {
      const flow = parseFlow(source);
      for (const reference of flow.references) {
        if (reference.kind === 'subflow' && reference.flowName) {
          edges.push(
            refEdge(targetId, `flow:${reference.flowName}`, name, `subflow ${reference.flowName}`),
          );
        } else if (reference.object) {
          edges.push(
            refEdge(
              targetId,
              `object:${reference.object}`,
              name,
              `${reference.kind} on ${reference.object}`,
            ),
          );
        }
      }
    }
    return { node, edges };
  };
}

function refEdge(from: string, to: string, ref: string, detail: string): ExecEdge {
  return {
    from,
    to,
    kind: 'dependency',
    state: 'unresolved',
    score: 0,
    evidence: [{ type: 'flow_xml_static', ref, detail }],
  };
}
