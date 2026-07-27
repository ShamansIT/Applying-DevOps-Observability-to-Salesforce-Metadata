// Structured JSON export. Input to comparison procedure: nodes, edges, phase order, states,
// evidence, risk, and run meta. Deterministic - timings are latency, not graph, so they are dropped
// here and kept in run log. Same graph yields byte-identical JSON, so double-run stays deep-equal
// and comparison matches by key. Pure.

import type { ReconstructResult } from '../core/cascade/reconstruct.js';

// Run meta without timings, since timings vary run to run and would break byte-identical export.
export interface ExportMeta {
  object: string;
  event: string;
  snapshotApiVersion: string | null;
  phaseModelApiVersion: string | null;
  depthLimit: number;
  truncated: boolean;
  degraded: string[];
}

export interface StructuredExport {
  meta: ExportMeta;
  phaseOrder: string[]; // phase keys in pinned order
  nodes: ReconstructResult['nodes'];
  edges: ReconstructResult['edges'];
  risk: ReconstructResult['risk'];
}

// Build export object from one run result. Timings excluded on purpose.
export function toStructuredExport(result: ReconstructResult): StructuredExport {
  return {
    meta: {
      object: result.meta.object,
      event: result.meta.event,
      snapshotApiVersion: result.meta.snapshotApiVersion,
      phaseModelApiVersion: result.meta.phaseModelApiVersion,
      depthLimit: result.meta.depthLimit,
      truncated: result.meta.truncated,
      degraded: result.meta.degraded,
    },
    phaseOrder: result.skeleton.phases.map((phase) => phase.phase),
    nodes: result.nodes,
    edges: result.edges,
    risk: result.risk,
  };
}

// Serialize export as formatted JSON with trailing newline. Deterministic given deterministic graph.
export function exportJson(result: ReconstructResult): string {
  return `${JSON.stringify(toStructuredExport(result), null, 2)}\n`;
}
