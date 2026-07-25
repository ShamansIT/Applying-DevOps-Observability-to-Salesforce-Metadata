// Domain types. Field names are contract: structured JSON export is compared against ground truth
// by these exact names, so renaming field breaks comparison. Two invariants are covered by
// tests - nothing expresses ordering within one phase, and excludeReason exists exactly when state
// is excluded.

/** Confidence in one reconstructed claim. Closed set. */
export type ConfidenceState = 'confirmed' | 'inferred' | 'unresolved' | 'excluded';

// manualGroundTruth is intentionally missing: core cannot even represent ground truth, so
// evaluation stays walled off from analysis.
export type EvidenceType =
  | 'dependency_api' // MetadataComponentDependency, direct record
  | 'flow_xml_static' // parsed Flow: start element, triggerType, object, refs
  | 'apex_static' // trigger header, events, coarse symbol refs
  | 'object_binding' // rule defined on target object (validation, duplicate, rollup)
  | 'config_link' // explicit config reference, e.g. flow trigger order
  | 'heuristic'; // naming convention, weakest signal

/** Salesforce artefact kind behind one node. */
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

// Phase key out of pinned phase model. String, not hard-coded union, so Order of Execution stays
// data rather than code constants; key is checked against loaded model at runtime.
export type PhaseKey = string;

/** One piece of evidence behind one node or edge. */
export interface Evidence {
  type: EvidenceType;
  ref: string;
  detail?: string;
}

// One reconstructed participant. No field for order within one phase, on purpose: platform only
// guarantees order between phases, so participants inside one phase form unordered set, sorted by
// stable id only to keep output deterministic.
export interface ExecNode {
  id: string; // stable `${type}:${object}:${apiName}`, independent of fetch order and run time
  apiName: string;
  label: string;
  type: NodeType;
  object: string;
  phase: PhaseKey;
  active: boolean;
  legacy?: boolean;
  namespace?: string; // set for managed-package components
  state: ConfidenceState;
  score: number; // weighted evidence score in [0, 1]
  evidence: Evidence[];
  excludeReason?: string; // required exactly when state is excluded
}

// Directed edge. phase_sequence edges come from phase model; dependency edges come from ingestion.
// Metrics split on this - phase ordering scored on first kind, dependency precision/recall on
// second.
export interface ExecEdge {
  from: string;
  to: string;
  kind: 'phase_sequence' | 'dependency';
  state: ConfidenceState;
  score: number;
  evidence: Evidence[];
}
