// GROUND_TRUTH set - evaluation side only, sole home of manualGroundTruth. Core cannot even
// represent this, so analysis never consumes truth. Record holds what correct reconstruction should
// reach: expected nodes and typed relationships, each with why it is there, where it came from, and
// how it is scored (scorable, ambiguous, boundary, excluded), plus deliberate exclusions kept out of
// scope. Ground truth is hashed before runs and hash is stored with results, so truth cannot be
// quietly tuned to match output.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ConfidenceState } from '../core/index.js';

// How relationship reads. Typed so ground truth records kind of dependency, not bare edge.
export type RelationshipType = 'invokes' | 'writes' | 'reads' | 'triggers' | 'depends_on';

// How claim is scored. `scorable` counts in metrics; `ambiguous` sits out of denominator; `boundary`
// marks edge-of-scope case handled separately; `excluded` is recorded but never scored.
export type AdjudicationStatus = 'scorable' | 'ambiguous' | 'boundary' | 'excluded';

// One expected node. Id follows same stable scheme reconstructed nodes use, so comparison matches by
// key. Phase is where correct reconstruction should place it.
export interface GroundTruthNode {
  id: string;
  phase: string;
  type?: string; // node kind, when author pins it
  rationale?: string; // why node belongs
  source?: string; // where expectation comes from - metadata, docs, org inspection
  adjudication?: AdjudicationStatus; // defaults to scorable when absent
}

// One expected relationship. Ids follow same stable scheme reconstructed edges use. Expected state is
// what correct reconstruction should reach.
export interface GroundTruthEdge {
  from: string;
  to: string;
  phase: string;
  expected: Extract<ConfidenceState, 'confirmed' | 'inferred'>;
  relationship?: RelationshipType; // kind of dependency, when author types it
  rationale?: string;
  source?: string;
  adjudication?: AdjudicationStatus; // defaults to scorable when absent
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
  source?: string; // provenance of record as a whole
  notes?: string;
}

const RELATIONSHIPS = new Set<string>(['invokes', 'writes', 'reads', 'triggers', 'depends_on']);
const ADJUDICATIONS = new Set<string>(['scorable', 'ambiguous', 'boundary', 'excluded']);

function checkAdjudication(value: unknown, id: string, where: string): void {
  if (value !== undefined && !ADJUDICATIONS.has(value as string)) {
    throw new Error(
      `ground truth ${id}: ${where} adjudication must be scorable, ambiguous, boundary or excluded`,
    );
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
    checkAdjudication(node.adjudication, truth.id, `node ${String(index)}`);
  }
  for (const [index, edge] of truth.edges.entries()) {
    if (!edge.from || !edge.to || !edge.phase) {
      throw new Error(`ground truth ${truth.id}: edge ${String(index)} missing from, to or phase`);
    }
    if (edge.expected !== 'confirmed' && edge.expected !== 'inferred') {
      throw new Error(
        `ground truth ${truth.id}: edge ${String(index)} expected must be confirmed or inferred`,
      );
    }
    if (edge.relationship !== undefined && !RELATIONSHIPS.has(edge.relationship)) {
      throw new Error(`ground truth ${truth.id}: edge ${String(index)} relationship is not known`);
    }
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
