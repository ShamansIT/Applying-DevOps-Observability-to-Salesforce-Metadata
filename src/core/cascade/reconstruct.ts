// Cascade orchestrator. Runs layers in contract order - L1 inventory, L2 classify, L3 extract,
// optional L5 expand, L4 assemble, then risk - and emits skeleton after L1 so it can render while
// later layers keep working. Per-layer timings live in run meta and are excluded from determinism
// checks; node, edge, skeleton and risk output stay byte-identical across runs. Pure apart from
// injected clock, source resolver and dependency records - no network.

import type { PhaseModel } from '../phases/phaseModel.js';
import type { ExecEdge, ExecNode, PhaseKey } from '../types.js';
import type { MetadataDependencyRecord, OrgSnapshot } from '../../ingestion/orgSnapshot.js';
import { computeRisk } from '../risk/indicators.js';
import type { RiskConfig, RiskIndicator } from '../risk/indicators.js';
import { loadWeights } from '../score/weights.js';
import type { WeightModel } from '../score/weights.js';
import { assemble } from './assemble.js';
import { classify } from './classify.js';
import { extract } from './extract.js';
import type { SourceResolver } from './extract.js';
import { expand, subflowExpander } from './expand.js';
import { inventory } from './inventory.js';
import type { AnalysisTarget, DmlEvent } from './inventory.js';

// Cascade layers, in run order. Timings are recorded per layer that runs.
export type CascadeLayer = 'L1' | 'L2' | 'L3' | 'L5' | 'L4';

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
  nodeCount: number; // classified nodes placed by L2 and later
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
  depthLimit: number;
  truncated: boolean;
  timings: LayerTiming[];
  degraded: string[];
}

// One skeleton emission, tagged with layer that produced it.
export interface CascadeEmission {
  layer: CascadeLayer;
  skeleton: Skeleton;
}

// Direct dependency records plus whether source query was cut short by its row cap.
export interface DependencyInput {
  records: MetadataDependencyRecord[];
  truncated?: boolean;
}

export interface ReconstructOptions {
  emit?: (emission: CascadeEmission) => void; // progressive render hook
  clock?: () => number; // milliseconds source; injected for deterministic tests
  sourceResolver?: SourceResolver; // body lookup for parsing; offline when absent
  dependencies?: DependencyInput; // direct dependency records, when captured
  depthLimit?: number; // L5 expansion depth; 0 keeps it off
  weights?: WeightModel; // scoring model; loaded from config when absent
  riskConfig?: Partial<RiskConfig>; // per-scenario risk thresholds
}

export interface ReconstructResult {
  skeleton: Skeleton;
  nodes: ExecNode[]; // flat, sorted by id
  edges: ExecEdge[]; // dependency edges, sorted
  risk: RiskIndicator[];
  meta: AnalysisRun;
}

const NOOP_EMIT = (): void => undefined;
const NO_SOURCE: SourceResolver = () => undefined;

// Run cascade for one (object, event) against one snapshot and pinned model.
export function reconstruct(
  snapshot: OrgSnapshot,
  target: AnalysisTarget,
  model: PhaseModel,
  options: ReconstructOptions = {},
): ReconstructResult {
  const emit = options.emit ?? NOOP_EMIT;
  const clock = options.clock ?? defaultClock;
  const weights = options.weights ?? loadWeights();
  const depthLimit = options.depthLimit ?? 0;
  const timings: LayerTiming[] = [];
  const timed = <T>(layer: CascadeLayer, run: () => T): T => {
    const start = clock();
    const value = run();
    timings.push({ layer, ms: clock() - start });
    return value;
  };

  const items = timed('L1', () => inventory(snapshot, target));
  emit({ layer: 'L1', skeleton: buildSkeleton(target, [], items.length, model) });

  const classified = timed('L2', () => classify(items, model));
  emit({ layer: 'L2', skeleton: buildSkeleton(target, sortById(classified), items.length, model) });

  const extracted = timed('L3', () =>
    extract({
      nodes: classified,
      items,
      ...(options.sourceResolver ? { sourceResolver: options.sourceResolver } : {}),
      ...(options.dependencies ? { dependencies: options.dependencies.records } : {}),
    }),
  );

  const expanded =
    depthLimit > 0
      ? timed('L5', () =>
          expand({
            nodes: extracted.nodes,
            edges: extracted.edges,
            depthLimit,
            expandTarget: subflowExpander(snapshot, options.sourceResolver ?? NO_SOURCE),
          }),
        )
      : extracted;

  const assembled = timed('L4', () =>
    assemble({ nodes: expanded.nodes, edges: expanded.edges, weights, phaseModel: model }),
  );

  const degraded: string[] = [];
  let truncated = false;
  if (options.dependencies?.truncated) {
    truncated = true;
    degraded.push('dependency_truncated');
    degradeDependencyEdges(assembled.edges); // incomplete records: affected claims become unresolved
  }

  const skeleton = buildSkeleton(target, assembled.nodes, items.length, model);
  emit({ layer: 'L4', skeleton });

  const risk = computeRisk({
    nodes: assembled.nodes,
    edges: assembled.edges,
    items,
    phaseModel: model,
    ...(options.riskConfig ? { config: options.riskConfig } : {}),
  });

  return {
    skeleton,
    nodes: assembled.nodes,
    edges: assembled.edges,
    risk,
    meta: {
      object: target.object,
      event: target.event,
      snapshotApiVersion: snapshot.meta.apiVersion,
      phaseModelApiVersion: model.apiVersion,
      depthLimit,
      truncated,
      timings,
      degraded,
    },
  };
}

// Truncated dependency query hides records, so any edge backed by dependency record degrades to
// unresolved - tool reports incompleteness rather than optimistic picture. State change keeps
// freeze order, since edges sort by (from, to, kind).
function degradeDependencyEdges(edges: ExecEdge[]): void {
  for (const edge of edges) {
    if (edge.evidence.some((item) => item.type === 'dependency_api')) {
      edge.state = 'unresolved';
    }
  }
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
