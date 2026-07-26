// Cascade orchestrator. Runs L1 then L2 in contract order, emits skeleton after L1 so it can
// render while later layers keep working, and records per-layer timings inside run meta. Node and
// skeleton output stay byte-identical across runs; only timings vary, so they live in meta and are
// excluded from determinism checks. Pure apart from injected clock.

import type { PhaseModel } from '../phases/phaseModel.js';
import type { ExecNode, PhaseKey } from '../types.js';
import type { OrgSnapshot } from '../../ingestion/orgSnapshot.js';
import { classify } from './classify.js';
import { inventory } from './inventory.js';
import type { AnalysisTarget, DmlEvent } from './inventory.js';

// Cascade layers that have run at emit time. L1 inventory, L2 phase classification.
export type CascadeLayer = 'L1' | 'L2';

// One phase and its member nodes. Nodes inside phase are unordered set, sorted by id for
// output only.
export interface PhaseGroup {
  phase: PhaseKey;
  label: string;
  sync: boolean;
  legacy: boolean;
  nodes: ExecNode[];
}

// Phase-ordered skeleton. Every model phase appears in pinned order, so backbone renders even before
// any node lands in it.
export interface Skeleton {
  target: AnalysisTarget;
  phases: PhaseGroup[];
  candidateCount: number; // participants found by L1
  nodeCount: number; // classified nodes placed by L2
}

// Wall-clock cost of one layer, in milliseconds. Non-deterministic by nature, kept out of graph.
export interface LayerTiming {
  layer: CascadeLayer;
  ms: number;
}

// One analysis run record: parameters, per-layer timings, degrade flags. Degrade list is empty on
// full run and names each activated fallback otherwise.
export interface AnalysisRun {
  object: string;
  event: DmlEvent;
  snapshotApiVersion: string | null;
  phaseModelApiVersion: string | null;
  timings: LayerTiming[];
  degraded: string[];
}

// One skeleton emission, tagged with layer that produced it.
export interface CascadeEmission {
  layer: CascadeLayer;
  skeleton: Skeleton;
}

export interface ReconstructOptions {
  emit?: (emission: CascadeEmission) => void; // progressive render hook
  clock?: () => number; // milliseconds source; injected for deterministic tests
}

export interface ReconstructResult {
  skeleton: Skeleton;
  nodes: ExecNode[]; // flat, sorted by id
  meta: AnalysisRun;
}

const NOOP_EMIT = (): void => undefined;

// Run cascade for one (object, event) against one snapshot and pinned model.
export function reconstruct(
  snapshot: OrgSnapshot,
  target: AnalysisTarget,
  model: PhaseModel,
  options: ReconstructOptions = {},
): ReconstructResult {
  const emit = options.emit ?? NOOP_EMIT;
  const clock = options.clock ?? defaultClock;
  const timings: LayerTiming[] = [];

  const startL1 = clock();
  const items = inventory(snapshot, target);
  timings.push({ layer: 'L1', ms: clock() - startL1 });
  emit({ layer: 'L1', skeleton: buildSkeleton(target, [], items.length, model) });

  const startL2 = clock();
  const nodes = sortById(classify(items, model));
  timings.push({ layer: 'L2', ms: clock() - startL2 });
  const skeleton = buildSkeleton(target, nodes, items.length, model);
  emit({ layer: 'L2', skeleton });

  return {
    skeleton,
    nodes,
    meta: {
      object: target.object,
      event: target.event,
      snapshotApiVersion: snapshot.meta.apiVersion,
      phaseModelApiVersion: model.apiVersion,
      timings,
      degraded: [],
    },
  };
}

// Group nodes into pinned phase order. Every phase appears, empty or not, so backbone is stable.
function buildSkeleton(
  target: AnalysisTarget,
  nodes: ExecNode[],
  candidateCount: number,
  model: PhaseModel,
): Skeleton {
  const byPhase = new Map<PhaseKey, ExecNode[]>();
  for (const node of nodes) {
    const bucket = byPhase.get(node.phase);
    if (bucket) {
      bucket.push(node);
    } else {
      byPhase.set(node.phase, [node]);
    }
  }
  const phases: PhaseGroup[] = model.phases.map((phase) => ({
    phase: phase.key,
    label: phase.label,
    sync: phase.sync,
    legacy: phase.legacy ?? false,
    nodes: sortById(byPhase.get(phase.key) ?? []),
  }));
  return { target, phases, candidateCount, nodeCount: nodes.length };
}

// Deterministic order by stable id. ASCII compare, no locale, so output is byte-identical anywhere.
function sortById(nodes: ExecNode[]): ExecNode[] {
  return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Default milliseconds source. Prefers monotonic clock, falls back to wall clock. Only feeds meta
// timings, never graph output.
function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
