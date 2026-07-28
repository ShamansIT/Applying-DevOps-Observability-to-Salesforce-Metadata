// GROUND_TRUTH_EDGE set - evaluation side only, sole home of manualGroundTruth. Core cannot even
// represent this, so analysis never consumes truth. Ground truth is hashed before runs and hash is
// stored with results, so truth cannot be quietly tuned to match output.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ConfidenceState } from '../core/index.js';

// One expected edge. Ids follow same stable scheme reconstructed edges use, so comparison
// matches by key. Expected state is what correct reconstruction should reach.
export interface GroundTruthEdge {
  from: string;
  to: string;
  phase: string;
  expected: Extract<ConfidenceState, 'confirmed' | 'inferred'>;
}

export interface GroundTruth {
  id: string;
  edges: GroundTruthEdge[];
}

export function validateGroundTruth(truth: GroundTruth): void {
  if (!truth.id) {
    throw new Error('ground truth: id is required');
  }
  if (!Array.isArray(truth.edges)) {
    throw new Error(`ground truth ${truth.id}: edges must be an array`);
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
