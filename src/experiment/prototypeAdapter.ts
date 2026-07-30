// Headless prototype adapter. Runs the read-only core against a materialised snapshot and normalises
// output into a prediction, never consuming ground truth. `no_blocking_finding` is never a proven pass.

import { reconstruct } from '../core/index.js';
import type {
  AnalysisTarget,
  PhaseModel,
  ReconstructResult,
  SourceResolver,
  WeightModel,
} from '../core/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';
import { componentIdsFromSnapshot, preflight } from './preflight.js';
import type { DiagnosticFinding } from './preflight.js';

export type PredictionCategory =
  | 'blocking_finding'
  | 'material_warning'
  | 'no_blocking_finding'
  | 'unresolved'
  | 'out_of_scope'
  | 'prototype_failure';

export interface ActionableFinding {
  category: PredictionCategory;
  component: string | null; // implicated component or edge source, when there is one
  reason: string;
  scope: 'confirmed' | 'inferred' | 'unresolved' | 'risk' | 'none';
}

export interface StageEvent {
  stage: string; // cascade layer
  ms: number; // per-layer wall-clock, from run meta
}

export interface PrototypeOutcome {
  predictionCategory: PredictionCategory;
  actionableFinding: ActionableFinding | null;
  affectedComponents: string[];
  stageEvents: StageEvent[];
  failed: boolean;
  error?: string;
}

function isClaim(state: string): boolean {
  return state === 'confirmed' || state === 'inferred';
}

// Reduce a reconstruction to a prediction. Preflight blocking findings take precedence - they rest on
// direct static evidence.
export function categorise(
  result: ReconstructResult,
  blocking: DiagnosticFinding[] = [],
): PrototypeOutcome {
  const stageEvents = result.meta.timings.map((timing) => ({ stage: timing.layer, ms: timing.ms }));
  if (blocking.length > 0) {
    const finding = blocking[0];
    return outcome('blocking_finding', stageEvents, {
      category: 'blocking_finding',
      component: finding?.component ?? null,
      reason: finding?.reason ?? 'blocking condition found',
      scope: 'confirmed',
    });
  }
  const flaggedRisks = result.risk.filter((indicator) => indicator.flagged);
  const unresolvedEdges = result.edges.filter((edge) => edge.state === 'unresolved');
  const claimNodes = result.nodes.filter((node) => isClaim(node.state));
  const allExcluded =
    result.nodes.length > 0 && claimNodes.length === 0 && unresolvedEdges.length === 0;

  if (flaggedRisks.length > 0) {
    const risk = flaggedRisks[0];
    return outcome('material_warning', stageEvents, {
      category: 'material_warning',
      component: risk?.nodes[0] ?? null,
      reason: `${risk?.label ?? 'risk'}${risk?.detail ? `: ${risk.detail}` : ''}`,
      scope: 'risk',
    });
  }
  if (unresolvedEdges.length > 0) {
    const edge = unresolvedEdges[0];
    return outcome('unresolved', stageEvents, {
      category: 'unresolved',
      component: edge?.from ?? null,
      reason: `unresolved reference from ${edge?.from ?? '?'} - not statically resolvable`,
      scope: 'unresolved',
    });
  }
  if (allExcluded) {
    return outcome('out_of_scope', stageEvents, {
      category: 'out_of_scope',
      component: null,
      reason: 'all participants excluded or out of scope',
      scope: 'none',
    });
  }
  if (claimNodes.length > 0) {
    return outcome('no_blocking_finding', stageEvents, {
      category: 'no_blocking_finding',
      component: null,
      reason: 'no statically detectable blocking condition; org validation still required',
      scope: 'none',
    });
  }
  return outcome('out_of_scope', stageEvents, {
    category: 'out_of_scope',
    component: null,
    reason: 'no in-scope participants found',
    scope: 'none',
  });
}

function outcome(
  category: PredictionCategory,
  stageEvents: StageEvent[],
  finding: ActionableFinding,
): PrototypeOutcome {
  return {
    predictionCategory: category,
    actionableFinding: finding,
    affectedComponents: finding.component ? [finding.component] : [],
    stageEvents,
    failed: false,
  };
}

export interface RunPrototypeOptions {
  sourceResolver?: SourceResolver;
  depthLimit?: number;
  weights?: WeightModel; // pass explicitly so a bundled caller does not rely on default asset paths
}

// Run the core against one snapshot and categorise. A core error becomes a prototype outcome, not a
// throw, so the harness records it.
export function runPrototype(
  snapshot: OrgSnapshot,
  target: AnalysisTarget,
  model: PhaseModel,
  options: RunPrototypeOptions = {},
): { outcome: PrototypeOutcome; result?: ReconstructResult } {
  try {
    const result = reconstruct(snapshot, target, model, {
      ...(options.sourceResolver ? { sourceResolver: options.sourceResolver } : {}),
      ...(options.depthLimit !== undefined ? { depthLimit: options.depthLimit } : {}),
      ...(options.weights ? { weights: options.weights } : {}),
      ...(snapshot.dependencies ? { dependencies: { records: snapshot.dependencies } } : {}),
    });
    // Preflight over project component inventory only - no ground truth.
    const { blocking } = preflight({
      result,
      presentComponentIds: componentIdsFromSnapshot(snapshot),
    });
    return { outcome: categorise(result, blocking), result };
  } catch (error) {
    return {
      outcome: {
        predictionCategory: 'prototype_failure',
        actionableFinding: {
          category: 'prototype_failure',
          component: null,
          reason: error instanceof Error ? error.message : String(error),
          scope: 'none',
        },
        affectedComponents: [],
        stageEvents: [],
        failed: true,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
