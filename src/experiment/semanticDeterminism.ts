// Full semantic determinism. Judged on the whole canonical graph - nodes, edges, relationships, phases,
// states, evidence and risk - not the prediction category. Each repetition hashed; mismatch names the aspect.

import { createHash } from 'node:crypto';
import type { ReconstructResult } from '../core/index.js';

interface CanonicalGraph {
  nodes: { id: string; type: string; phase: string; state: string }[];
  edges: {
    from: string;
    to: string;
    relationship: string;
    kind: string;
    state: string;
    evidence: string[];
  }[];
  risk: { key: string; flagged: boolean; nodes: string[] }[];
}

function canonicalObject(result: ReconstructResult): CanonicalGraph {
  return {
    nodes: result.nodes
      .map((node) => ({ id: node.id, type: node.type, phase: node.phase, state: node.state }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: result.edges
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        relationship: edge.relationship ?? '',
        kind: edge.kind,
        state: edge.state,
        evidence: [...new Set(edge.evidence.map((item) => item.type))].sort(),
      }))
      .sort((a, b) =>
        `${a.from}|${a.to}|${a.relationship}` < `${b.from}|${b.to}|${b.relationship}` ? -1 : 1,
      ),
    risk: result.risk
      .map((indicator) => ({
        key: indicator.key,
        flagged: indicator.flagged,
        nodes: [...indicator.nodes].sort(),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}

export function canonicalReconstruction(result: ReconstructResult): string {
  return JSON.stringify(canonicalObject(result));
}

export function repetitionHash(result: ReconstructResult): string {
  return createHash('sha256').update(canonicalReconstruction(result)).digest('hex');
}

export interface DeterminismResult {
  deterministic: boolean;
  hashes: string[]; // one per repetition
  mismatch: { repetition: number; aspect: 'nodes' | 'edges' | 'risk' } | null;
}

// Compare a list of reconstructions. The first repetition is the reference; a later one that differs is
// reported with the first section (nodes, edges or risk) that changed.
export function compareRepetitions(results: ReconstructResult[]): DeterminismResult {
  const canonicals = results.map(canonicalObject);
  const hashes = results.map(repetitionHash);
  const reference = canonicals[0];
  if (!reference) return { deterministic: true, hashes, mismatch: null };
  for (let i = 1; i < canonicals.length; i += 1) {
    const current = canonicals[i];
    if (!current) continue;
    for (const aspect of ['nodes', 'edges', 'risk'] as const) {
      if (JSON.stringify(reference[aspect]) !== JSON.stringify(current[aspect])) {
        return { deterministic: false, hashes, mismatch: { repetition: i, aspect } };
      }
    }
  }
  return { deterministic: true, hashes, mismatch: null };
}
