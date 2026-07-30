// L4 graph assembly. Fourth cascade layer: merge and dedupe nodes and edges by stable id, fill
// ranking score from evidence, finalise confidence state, and freeze output order. State is not
// derived from score: it is state assigned at creation, kept through finalisation, with scope
// exclusion winning first. Freeze makes output byte-identical across runs. Pure.

import { assertValidExecNode } from '../validate.js';
import type { PhaseModel } from '../phases/phaseModel.js';
import { finaliseConfidence, scoreEvidence, strongerState } from '../score/score.js';
import type { WeightModel } from '../score/weights.js';
import type { ConfidenceState, Evidence, ExecEdge, ExecNode } from '../types.js';

export interface AssembleInput {
  nodes: ExecNode[];
  edges: ExecEdge[];
  weights: WeightModel;
  phaseModel: PhaseModel;
}

export interface AssembleResult {
  nodes: ExecNode[];
  edges: ExecEdge[];
}

const ASYNC_EXCLUDE_REASON = 'asynchronous phase, out of analysis scope';

// Merge, dedupe, score for ranking and freeze. Node keeps any scope exclusion set earlier (e.g.
// inactive), and gains async exclusion when its phase is asynchronous.
export function assemble(input: AssembleInput): AssembleResult {
  const asyncPhases = new Set(
    input.phaseModel.phases.filter((phase) => !phase.sync).map((phase) => phase.key),
  );

  const nodes = mergeNodes(input.nodes).map((node) => scoreNode(node, input.weights, asyncPhases));
  const edges = mergeEdges(input.edges).map((edge) => scoreEdge(edge, input.weights));

  nodes.sort((a, b) => compare(a.id, b.id));
  edges.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.kind, b.kind));
  return { nodes, edges };
}

// Dedupe nodes by id, merging evidence and keeping strongest state. Excluded scope, once set, wins.
function mergeNodes(nodes: ExecNode[]): ExecNode[] {
  const byId = new Map<string, ExecNode>();
  for (const node of nodes) {
    const existing = byId.get(node.id);
    if (existing) {
      existing.evidence = dedupeEvidence([...existing.evidence, ...node.evidence]);
      existing.state = mergeState(existing, node);
    } else {
      byId.set(node.id, { ...node, evidence: dedupeEvidence(node.evidence) });
    }
  }
  return [...byId.values()];
}

// Dedupe edges by (from, to, kind), merging evidence and keeping strongest state.
function mergeEdges(edges: ExecEdge[]): ExecEdge[] {
  const byKey = new Map<string, ExecEdge>();
  for (const edge of edges) {
    const key = `${edge.from} ${edge.to} ${edge.kind}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.evidence = dedupeEvidence([...existing.evidence, ...edge.evidence]);
      const merged = mergeEdgeState(existing.state, edge.state);
      // Stronger-state edge also wins the relationship type, so a confirmed dependency record beats
      // an inferred symbol reference on the same pair.
      if (merged !== existing.state && edge.relationship !== undefined) {
        existing.relationship = edge.relationship;
      }
      existing.state = merged;
    } else {
      byKey.set(key, { ...edge, evidence: dedupeEvidence(edge.evidence) });
    }
  }
  return [...byKey.values()];
}

// Node state after merge. Any excluded scope wins; otherwise take strongest non-excluded state.
function mergeState(a: ExecNode, b: ExecNode): ConfidenceState {
  if (a.excludeReason) return a.state;
  if (b.excludeReason) {
    a.excludeReason = b.excludeReason;
    return 'excluded';
  }
  return mergeEdgeState(a.state, b.state);
}

// Strongest of two states for merge. Excluded stays excluded.
function mergeEdgeState(a: ConfidenceState, b: ConfidenceState): ConfidenceState {
  if (a === 'excluded' || b === 'excluded') {
    return 'excluded';
  }
  return strongerState(a, b);
}

// Fill ranking score, apply async scope exclusion, finalise state, freeze evidence order.
function scoreNode(node: ExecNode, weights: WeightModel, asyncPhases: Set<string>): ExecNode {
  const evidence = sortEvidence(node.evidence);
  const score = scoreEvidence(evidence, weights);
  let excludeReason = node.excludeReason;
  if (excludeReason === undefined && asyncPhases.has(node.phase)) {
    excludeReason = ASYNC_EXCLUDE_REASON;
  }
  const state = finaliseConfidence(node.state, evidence, excludeReason);
  const scored: ExecNode = { ...node, evidence, score, state };
  if (excludeReason !== undefined) {
    scored.excludeReason = excludeReason;
  } else {
    delete scored.excludeReason;
  }
  assertValidExecNode(scored);
  return scored;
}

// Fill ranking score and finalise edge state. Edges carry no scope exclusion.
function scoreEdge(edge: ExecEdge, weights: WeightModel): ExecEdge {
  const evidence = sortEvidence(edge.evidence);
  const score = scoreEvidence(evidence, weights);
  return { ...edge, evidence, score, state: finaliseConfidence(edge.state, evidence) };
}

function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const byKey = new Map<string, Evidence>();
  for (const item of evidence) {
    byKey.set(`${item.type} ${item.ref} ${item.detail ?? ''}`, item);
  }
  return [...byKey.values()];
}

function sortEvidence(evidence: Evidence[]): Evidence[] {
  return dedupeEvidence(evidence).sort(
    (a, b) =>
      compare(a.type, b.type) || compare(a.ref, b.ref) || compare(a.detail ?? '', b.detail ?? ''),
  );
}

// ASCII compare, no locale, so freeze is byte-identical anywhere.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
