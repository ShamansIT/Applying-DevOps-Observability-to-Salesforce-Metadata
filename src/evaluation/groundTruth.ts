// GROUND_TRUTH set - evaluation side only, sole home of manualGroundTruth. Core cannot even
// represent this, so analysis never consumes truth. Ground truth describes the expected world - which
// nodes and typed relationships should exist, how detectable each is from static evidence, why it is
// there and where it came from, and how it is scored. It does NOT prescribe the prototype's confidence
// state: the prototype decides confirmed or inferred from its own evidence rules, and comparison scores
// presence and detectability, not the confidence label. Ground truth is hashed before runs and the
// hash is stored with results, so truth cannot be quietly tuned to match output.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { RelationshipKind } from '../core/index.js';

// Kept name for callers; the relationship vocabulary lives in core.
export type RelationshipType = RelationshipKind;

// How reachable a claim is from static metadata. `static-direct` should be caught with certainty;
// `static-inferred` is coarser; `risk-only` is a risk signal, not a hard edge; `runtime-only` cannot
// be established statically and correct behaviour is to leave it unresolved; `out-of-scope` is never
// scored as a static miss.
export type Detectability =
  'static-direct' | 'static-inferred' | 'risk-only' | 'runtime-only' | 'out-of-scope';

// How a claim is scored. `scorable` counts in metrics; `ambiguous` sits out of denominators;
// `boundary` marks an edge-of-scope case scored apart; `excluded` is recorded but never scored.
export type AdjudicationStatus = 'scorable' | 'ambiguous' | 'boundary' | 'excluded';

// One expected node. Id follows same stable scheme reconstructed nodes use, so comparison matches by
// key. Phase is where correct reconstruction should place it.
export interface GroundTruthNode {
  id: string;
  phase: string;
  type?: string;
  expectedPresence?: boolean; // defaults to true; false marks a node that should NOT appear
  detectability?: Detectability; // defaults to static-direct
  rationale?: string;
  source?: string;
  adjudication?: AdjudicationStatus;
}

// One expected relationship. Ids follow same stable scheme reconstructed edges use; relationship type
// is part of the identity, so a right pair with the wrong relationship is not a match.
export interface GroundTruthEdge {
  from: string;
  to: string;
  relationship: RelationshipKind;
  phase: string;
  expectedPresence?: boolean; // defaults to true; false marks an edge that should NOT be claimed
  detectability?: Detectability; // defaults to static-direct
  rationale?: string;
  source?: string;
  adjudication?: AdjudicationStatus;
}

// Something kept out of scope on purpose - asynchronous work, unrecoverable dynamic target - so its
// absence from output is expected, not a miss.
export interface GroundTruthExclusion {
  ref: string;
  reason: string;
}

export interface GroundTruth {
  id: string;
  nodes?: GroundTruthNode[];
  edges: GroundTruthEdge[];
  exclusions?: GroundTruthExclusion[];
  source?: string;
  notes?: string;
}

const RELATIONSHIPS = new Set<string>(['invokes', 'writes', 'reads', 'triggers', 'depends_on']);
const ADJUDICATIONS = new Set<string>(['scorable', 'ambiguous', 'boundary', 'excluded']);
const DETECTABILITIES = new Set<string>([
  'static-direct',
  'static-inferred',
  'risk-only',
  'runtime-only',
  'out-of-scope',
]);

function checkAdjudication(value: unknown, id: string, where: string): void {
  if (value !== undefined && !ADJUDICATIONS.has(value as string)) {
    throw new Error(
      `ground truth ${id}: ${where} adjudication must be scorable, ambiguous, boundary or excluded`,
    );
  }
}

function checkDetectability(value: unknown, id: string, where: string): void {
  if (value !== undefined && !DETECTABILITIES.has(value as string)) {
    throw new Error(`ground truth ${id}: ${where} detectability is not a known value`);
  }
}

export function validateGroundTruth(truth: GroundTruth): void {
  if (!truth.id) {
    throw new Error('ground truth: id is required');
  }
  if (!Array.isArray(truth.edges)) {
    throw new Error(`ground truth ${truth.id}: edges must be an array`);
  }
  for (const [index, node] of (truth.nodes ?? []).entries()) {
    if (!node.id || !node.phase) {
      throw new Error(`ground truth ${truth.id}: node ${String(index)} missing id or phase`);
    }
    checkDetectability(node.detectability, truth.id, `node ${String(index)}`);
    checkAdjudication(node.adjudication, truth.id, `node ${String(index)}`);
  }
  for (const [index, edge] of truth.edges.entries()) {
    if (!edge.from || !edge.to || !edge.phase) {
      throw new Error(`ground truth ${truth.id}: edge ${String(index)} missing from, to or phase`);
    }
    if (!RELATIONSHIPS.has(edge.relationship)) {
      throw new Error(`ground truth ${truth.id}: edge ${String(index)} relationship is not known`);
    }
    checkDetectability(edge.detectability, truth.id, `edge ${String(index)}`);
    checkAdjudication(edge.adjudication, truth.id, `edge ${String(index)}`);
  }
  for (const [index, exclusion] of (truth.exclusions ?? []).entries()) {
    if (!exclusion.ref || !exclusion.reason) {
      throw new Error(`ground truth ${truth.id}: exclusion ${String(index)} missing ref or reason`);
    }
  }
}

export function loadGroundTruth(path: string): GroundTruth {
  const truth = JSON.parse(readFileSync(path, 'utf8')) as GroundTruth;
  validateGroundTruth(truth);
  return truth;
}

// Canonical JSON: keys sorted at every level, so hash depends on content not formatting or order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Hash ground truth over canonical form, so edge order and whitespace do not change it. Stored with
// results as tamper-evident stamp.
export function hashGroundTruth(truth: GroundTruth): string {
  return createHash('sha256').update(canonical(truth)).digest('hex');
}
