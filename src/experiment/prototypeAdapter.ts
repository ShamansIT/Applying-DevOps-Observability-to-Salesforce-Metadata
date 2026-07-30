// Headless prototype adapter. Runs the same read-only analysis core the VS Code extension runs,
// against a materialised scenario's snapshot, and normalises its output into an experiment prediction.
// It never consumes ground truth. Categorisation maps what the core actually produces - confidence
// states, unresolved references, and risk indicators - onto prediction categories. The core is not a
// validator, so `blocking_finding` (a definite statically-proven broken reference) is reserved for a
// future validator and is not emitted here; the strongest current assertion is a material warning.
// `no_blocking_finding` is never labelled a proven pass: org validation is still required.

import { reconstruct } from '../core/index.js';
import type {
  AnalysisTarget,
  PhaseModel,
  ReconstructResult,
  SourceResolver,
} from '../core/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';

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

// Reduce a reconstruction to a prediction. Pure: given the graph, the category and the first
// actionable finding are deterministic.
export function categorise(result: ReconstructResult): PrototypeOutcome {
  const stageEvents = result.meta.timings.map((timing) => ({ stage: timing.layer, ms: timing.ms }));
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
}

// Run the core against one snapshot and categorise. A core error is a prototype outcome, not a thrown
// exception, so the harness records it rather than aborting the run.
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
      ...(snapshot.dependencies ? { dependencies: { records: snapshot.dependencies } } : {}),
    });
    return { outcome: categorise(result), result };
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
