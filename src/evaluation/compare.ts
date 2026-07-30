// Comparison procedure. Diffs one reconstruction against its ground truth. Edge identity is
// (from, to, relationship), so a right pair with the wrong relationship is not a free match. Scoring
// separates what static analysis should catch from what it cannot: only statically-detectable
// expected elements enter precision and recall; runtime-only and out-of-scope expectations are scored
// apart, and correct handling of a runtime-only edge is to NOT claim it. Only claimed elements
// (confirmed or inferred) count as positives; unresolved and excluded are explicit uncertainty, not
// false claims. Adjudication controls scoring: `scorable` counts, `ambiguous` sits out of
// denominators, `boundary` is scored only by its own accuracy, `excluded` is never scored. Pure.

import type { ConfidenceState, ExecEdge, ExecNode, ReconstructResult } from '../core/index.js';
import type { AdjudicationStatus, Detectability, GroundTruth } from './groundTruth.js';

export interface ConfidenceDistribution {
  confirmed: number;
  inferred: number;
  unresolved: number;
  excluded: number;
}

export interface ComparisonMetrics {
  scenarioId: string;

  // Node scoring, over statically-detectable scorable expected nodes.
  expectedNodes: number;
  claimedNodes: number;
  nodeTruePositives: number;
  nodePrecision: number;
  nodeRecall: number;
  phaseAccuracy: number;

  // Edge scoring, over statically-detectable scorable expected edges, matched on relationship too.
  expected: number;
  claimed: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  relationshipAccuracy: number; // of pairs the tool found, share with the right relationship

  // Placed backbone over statically-detectable expected nodes and edges.
  orderedPathCoverage: number;

  // Final-graph quality signals. Named to make clear they are final-graph, not first-feedback.
  finalEdgeNoiseRate: number; // spurious claimed edges over claimed edges
  finalExpectedEdgeOmissionRate: number; // missed static-direct expected edges over that set

  // Detectability handling and out-of-denominator counts.
  runtimeOnlyExpected: number; // expected edges static analysis cannot resolve
  runtimeOnlyHandled: number; // of those, the tool did not falsely claim
  boundaryTotal: number;
  boundaryAccuracy: number;
  ambiguousExcluded: number;

  distribution: ConfidenceDistribution;
}

function key(from: string, to: string, relationship: string | undefined): string {
  return `${from} ${to} ${relationship ?? ''}`;
}

function pair(from: string, to: string): string {
  return `${from} ${to}`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function adjudicationOf(item: { adjudication?: AdjudicationStatus }): AdjudicationStatus {
  return item.adjudication ?? 'scorable';
}

function detectabilityOf(item: { detectability?: Detectability }): Detectability {
  return item.detectability ?? 'static-direct';
}

function isPresent(item: { expectedPresence?: boolean }): boolean {
  return item.expectedPresence !== false;
}

// Static analysis is meant to reach static-direct and static-inferred claims.
function isStatic(detectability: Detectability): boolean {
  return detectability === 'static-direct' || detectability === 'static-inferred';
}

function isClaim(state: ConfidenceState): boolean {
  return state === 'confirmed' || state === 'inferred';
}

export function compare(result: ReconstructResult, truth: GroundTruth): ComparisonMetrics {
  const nodeMetrics = compareNodes(result.nodes, truth);
  const edgeMetrics = compareEdges(result.edges, result.nodes, truth);
  const boundary = boundaryHandling(result, truth);

  const placed = nodeMetrics.placedNodes + edgeMetrics.placedEdges;
  const backbone = nodeMetrics.expectedNodes + edgeMetrics.expected;

  return {
    scenarioId: truth.id,
    expectedNodes: nodeMetrics.expectedNodes,
    claimedNodes: nodeMetrics.claimedNodes,
    nodeTruePositives: nodeMetrics.truePositives,
    nodePrecision: ratio(
      nodeMetrics.truePositives,
      nodeMetrics.truePositives + nodeMetrics.falsePositives,
    ),
    nodeRecall: ratio(nodeMetrics.truePositives, nodeMetrics.expectedNodes),
    phaseAccuracy: ratio(nodeMetrics.phaseHits, nodeMetrics.truePositives),
    expected: edgeMetrics.expected,
    claimed: edgeMetrics.claimed,
    truePositives: edgeMetrics.truePositives,
    falsePositives: edgeMetrics.falsePositives,
    falseNegatives: edgeMetrics.falseNegatives,
    precision: ratio(
      edgeMetrics.truePositives,
      edgeMetrics.truePositives + edgeMetrics.falsePositives,
    ),
    recall: ratio(edgeMetrics.truePositives, edgeMetrics.expected),
    f1: harmonic(
      ratio(edgeMetrics.truePositives, edgeMetrics.truePositives + edgeMetrics.falsePositives),
      ratio(edgeMetrics.truePositives, edgeMetrics.expected),
    ),
    relationshipAccuracy: ratio(edgeMetrics.relationshipHits, edgeMetrics.pairMatches),
    orderedPathCoverage: ratio(placed, backbone),
    finalEdgeNoiseRate: ratio(edgeMetrics.falsePositives, edgeMetrics.claimed),
    finalExpectedEdgeOmissionRate: ratio(edgeMetrics.missedDirect, edgeMetrics.expectedDirect),
    runtimeOnlyExpected: edgeMetrics.runtimeOnlyExpected,
    runtimeOnlyHandled: edgeMetrics.runtimeOnlyHandled,
    boundaryTotal: boundary.total,
    boundaryAccuracy: boundary.total === 0 ? 1 : ratio(boundary.handled, boundary.total),
    ambiguousExcluded: nodeMetrics.ambiguous + edgeMetrics.ambiguous,
    distribution: distributionOf(result),
  };
}

function harmonic(precision: number, recall: number): number {
  return ratio(2 * precision * recall, precision + recall);
}

interface NodeMetrics {
  expectedNodes: number;
  claimedNodes: number;
  truePositives: number;
  falsePositives: number;
  phaseHits: number;
  placedNodes: number;
  ambiguous: number;
}

function compareNodes(nodes: ExecNode[], truth: GroundTruth): NodeMetrics {
  const claimNodes = nodes.filter((node) => isClaim(node.state));
  const claimIds = new Set(claimNodes.map((node) => node.id));
  const phaseById = new Map(nodes.map((node) => [node.id, node.phase]));
  const expectedAllIds = new Set((truth.nodes ?? []).filter(isPresent).map((node) => node.id));

  let expectedNodes = 0;
  let truePositives = 0;
  let phaseHits = 0;
  let placedNodes = 0;
  let ambiguous = 0;

  for (const node of truth.nodes ?? []) {
    if (!isPresent(node)) {
      continue;
    }
    const adjudication = adjudicationOf(node);
    if (adjudication === 'excluded' || adjudication === 'boundary') {
      continue;
    }
    if (adjudication === 'ambiguous') {
      ambiguous += 1;
      continue;
    }
    if (!isStatic(detectabilityOf(node))) {
      continue; // runtime-only or out-of-scope nodes are not static positives
    }
    expectedNodes += 1;
    if (claimIds.has(node.id)) {
      truePositives += 1;
      if (phaseById.get(node.id) === node.phase) {
        phaseHits += 1;
        placedNodes += 1;
      }
    }
  }

  const falsePositives = claimNodes.filter((node) => !expectedAllIds.has(node.id)).length;
  return {
    expectedNodes,
    claimedNodes: claimNodes.length,
    truePositives,
    falsePositives,
    phaseHits,
    placedNodes,
    ambiguous,
  };
}

interface EdgeMetrics {
  expected: number;
  claimed: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  placedEdges: number;
  relationshipHits: number;
  pairMatches: number;
  missedDirect: number;
  expectedDirect: number;
  runtimeOnlyExpected: number;
  runtimeOnlyHandled: number;
  ambiguous: number;
}

function compareEdges(edges: ExecEdge[], nodes: ExecNode[], truth: GroundTruth): EdgeMetrics {
  const claimedEdges = edges.filter((edge) => isClaim(edge.state));
  const claimedKeys = new Set(
    claimedEdges.map((edge) => key(edge.from, edge.to, edge.relationship)),
  );
  const claimedPairs = new Set(claimedEdges.map((edge) => pair(edge.from, edge.to)));
  const relationshipByPair = new Map(
    claimedEdges.map((edge) => [pair(edge.from, edge.to), edge.relationship]),
  );
  const expectedPresentKeys = new Set(
    truth.edges.filter(isPresent).map((edge) => key(edge.from, edge.to, edge.relationship)),
  );
  const phaseByNode = new Map(nodes.map((node) => [node.id, node.phase]));

  let expected = 0;
  let truePositives = 0;
  let placedEdges = 0;
  let relationshipHits = 0;
  let pairMatches = 0;
  let missedDirect = 0;
  let expectedDirect = 0;
  let runtimeOnlyExpected = 0;
  let runtimeOnlyHandled = 0;
  let ambiguous = 0;

  for (const edge of truth.edges) {
    if (!isPresent(edge)) {
      continue;
    }
    const adjudication = adjudicationOf(edge);
    if (adjudication === 'excluded' || adjudication === 'boundary') {
      continue;
    }
    if (adjudication === 'ambiguous') {
      ambiguous += 1;
      continue;
    }
    const detectability = detectabilityOf(edge);
    if (!isStatic(detectability)) {
      // Runtime-only or out-of-scope: correct behaviour is not to claim it as a positive.
      if (detectability === 'runtime-only') {
        runtimeOnlyExpected += 1;
        if (!claimedPairs.has(pair(edge.from, edge.to))) {
          runtimeOnlyHandled += 1;
        }
      }
      continue;
    }
    expected += 1;
    if (detectability === 'static-direct') {
      expectedDirect += 1;
    }
    if (claimedKeys.has(key(edge.from, edge.to, edge.relationship))) {
      truePositives += 1;
      if (phaseByNode.get(edge.from) === edge.phase) {
        placedEdges += 1;
      }
    } else if (detectability === 'static-direct') {
      missedDirect += 1;
    }
    if (claimedPairs.has(pair(edge.from, edge.to))) {
      pairMatches += 1;
      if (relationshipByPair.get(pair(edge.from, edge.to)) === edge.relationship) {
        relationshipHits += 1;
      }
    }
  }

  const falsePositives = claimedEdges.filter(
    (edge) => !expectedPresentKeys.has(key(edge.from, edge.to, edge.relationship)),
  ).length;
  return {
    expected,
    claimed: claimedEdges.length,
    truePositives,
    falsePositives,
    falseNegatives: expected - truePositives,
    placedEdges,
    relationshipHits,
    pairMatches,
    missedDirect,
    expectedDirect,
    runtimeOnlyExpected,
    runtimeOnlyHandled,
    ambiguous,
  };
}

// Boundary items are edge-of-scope: correct handling is to leave them unresolved or excluded, never a
// positive claim. A matching confirmed or inferred element fails the boundary.
function boundaryHandling(
  result: ReconstructResult,
  truth: GroundTruth,
): { total: number; handled: number } {
  const claimNodeIds = new Set(
    result.nodes.filter((node) => isClaim(node.state)).map((node) => node.id),
  );
  const claimEdgeKeys = new Set(
    result.edges
      .filter((edge) => isClaim(edge.state))
      .map((edge) => key(edge.from, edge.to, edge.relationship)),
  );

  let total = 0;
  let handled = 0;
  for (const node of truth.nodes ?? []) {
    if (adjudicationOf(node) !== 'boundary') {
      continue;
    }
    total += 1;
    if (!claimNodeIds.has(node.id)) {
      handled += 1;
    }
  }
  for (const edge of truth.edges) {
    if (adjudicationOf(edge) !== 'boundary') {
      continue;
    }
    total += 1;
    if (!claimEdgeKeys.has(key(edge.from, edge.to, edge.relationship))) {
      handled += 1;
    }
  }
  return { total, handled };
}

// Confidence-state counts across nodes and edges together, so the output's certainty is visible.
function distributionOf(result: ReconstructResult): ConfidenceDistribution {
  const distribution: ConfidenceDistribution = {
    confirmed: 0,
    inferred: 0,
    unresolved: 0,
    excluded: 0,
  };
  for (const element of [...result.nodes, ...result.edges]) {
    distribution[element.state] += 1;
  }
  return distribution;
}
