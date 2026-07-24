// Core domain types - the contract for the analysis engine's output.
//
// Field names here are part of the contract: the structured JSON export is compared against
// Ground Truth / Expected Execution Maps by these exact names. Two invariants are
// enforced by tests (see `invariants.test`): no field can express intra-phase ordering, and
// `excludeReason` is present exactly when `state` is `excluded`.

/** Confidence in a reconstructed claim. Closed set. */
export type ConfidenceState = 'confirmed' | 'inferred' | 'unresolved' | 'excluded';

/**
 * Code-level evidence types. `manualGroundTruth` is deliberately absent: the core
 * physically cannot consume ground truth, which keeps evaluation isolated from analysis.
 */
export type EvidenceType =
  | 'dependency_api' // MetadataComponentDependency, direct record
  | 'flow_xml_static' // parsed Flow: start element, triggerType, object, refs
  | 'apex_static' // trigger header, events, coarse symbol refs
  | 'object_binding' // rule defined on the target object (VR, DR, rollup)
  | 'config_link' // explicit config reference, e.g. flow trigger order
  | 'heuristic'; // naming convention, lowest weight

/** Kind of Salesforce artefact a node represents. */
export type NodeType =
  | 'flow_before'
  | 'flow_after'
  | 'apex_trigger'
  | 'validation_rule'
  | 'duplicate_rule'
  | 'workflow_rule'
  | 'process_builder'
  | 'assignment_rule'
  | 'escalation_rule'
  | 'rollup_field'
  | 'apex_class'
  | 'unknown';

/**
 * Phase key from the release-pinned phase model (`phases.v<NN>.json`). Kept as string rather
 * than hard-coded union, so the Order of Execution stays release-pinned data and not code
 * constants; keys are validated against the loaded phase model at runtime.
 */
export type PhaseKey = string;

/** One piece of evidence supporting a node or an edge. */
export interface Evidence {
  type: EvidenceType;
  ref: string;
  detail?: string;
}

/**
 * Reconstructed participant in the execution flow.
 *
 * There is deliberately no field expressing order *within* phase: the platform guarantees order
 * only *between* phases, so nodes in a phase are an unordered set, sorted only by stable `id` for
 * output determinism.
 */
export interface ExecNode {
  /** Stable id `${type}:${object}:${apiName}` - independent of fetch order and run time. */
  id: string;
  apiName: string;
  label: string;
  type: NodeType;
  object: string;
  phase: PhaseKey;
  active: boolean;
  legacy?: boolean;
  /** Namespace for managed-package component. */
  namespace?: string;
  state: ConfidenceState;
  /** Weighted evidence score in [0, 1]. */
  score: number;
  evidence: Evidence[];
  /** Required exactly when `state` is `excluded`: reason for the scope exclusion. */
  excludeReason?: string;
}

/**
 * Directed edge. `phase_sequence` edges are generated from the phase model; `dependency` edges
 * come from ingestion. Metrics split on this: phase-ordering accuracy uses the first, dependency
 * precision/recall the second.
 */
export interface ExecEdge {
  from: string;
  to: string;
  kind: 'phase_sequence' | 'dependency';
  state: ConfidenceState;
  score: number;
  evidence: Evidence[];
}
