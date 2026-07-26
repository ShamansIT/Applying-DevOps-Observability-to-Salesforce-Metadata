// L2 phase classification. Second cascade layer: assign each inventory item its phase from pinned
// model and turn it into ExecNode. Mapping is data-driven off phase keys, so release change swaps
// phases.v<NN>.json without touching this code. Pure.
//
// Interim confidence: skeleton nodes carry state `inferred` with score 0. Scoring and final state
// resolution need calibrated weights and land in graph assembly, not here - see docs/modules
// /cascade.md and ADR 005. Inactive participants are marked `excluded` with reason, since inactive
// automation does not fire.

import type { PhaseModel } from '../phases/phaseModel.js';
import { phaseIndex } from '../phases/phaseModel.js';
import type { Evidence, EvidenceType, ExecNode, NodeType, PhaseKey } from '../types.js';
import type { InventoryItem, SaveTiming } from './inventory.js';

// Single-phase node kinds to their phase key. apex_trigger is absent: it splits by timing below.
const NODE_PHASE: Partial<Record<NodeType, PhaseKey>> = {
  flow_before: 'before_save_flows',
  flow_after: 'after_save_flows',
  validation_rule: 'custom_validation',
  duplicate_rule: 'duplicate_rules',
  workflow_rule: 'workflow_rules',
  process_builder: 'after_save_flows',
  rollup_field: 'rollup_summary',
};

// Apex trigger save timing to phase key. Trigger firing in both timings becomes one node per phase.
const TIMING_PHASE: Record<SaveTiming, PhaseKey> = {
  before: 'before_triggers',
  after: 'after_triggers',
};

// Evidence type that classification can stand behind at this layer, per node kind. Config-derived,
// not parsed bodies.
const EVIDENCE_TYPE: Partial<Record<NodeType, EvidenceType>> = {
  flow_before: 'config_link',
  flow_after: 'config_link',
  apex_trigger: 'apex_static',
  validation_rule: 'object_binding',
  duplicate_rule: 'object_binding',
  workflow_rule: 'object_binding',
  process_builder: 'object_binding',
  rollup_field: 'object_binding',
};

// Turn inventory into phase-classified nodes. Order follows input; caller sorts by id at emit time.
export function classify(items: InventoryItem[], model: PhaseModel): ExecNode[] {
  const nodes: ExecNode[] = [];
  for (const item of items) {
    if (item.nodeType === 'apex_trigger') {
      for (const timing of item.timings) {
        nodes.push(triggerNode(item, timing, model));
      }
      continue;
    }
    const phase = NODE_PHASE[item.nodeType];
    if (!phase) {
      continue; // apex_class, unknown: not phase participant at this layer
    }
    nodes.push(
      nodeFor(
        item,
        phase,
        `${item.nodeType}:${item.object}:${item.fullName}`,
        item.fullName,
        model,
      ),
    );
  }
  return nodes;
}

// One node for one Apex trigger in one save timing. id and label carry timing so both phases stay
// distinct and unique.
function triggerNode(item: InventoryItem, timing: SaveTiming, model: PhaseModel): ExecNode {
  const phase = TIMING_PHASE[timing];
  const id = `apex_trigger:${item.object}:${item.fullName}:${phase}`;
  return nodeFor(item, phase, id, `${item.fullName} (${timing})`, model);
}

// Assemble node with phase check, evidence and interim state. Throws when mapped phase is absent
// from pinned model, which would mean classifier and model drifted apart.
function nodeFor(
  item: InventoryItem,
  phase: PhaseKey,
  id: string,
  label: string,
  model: PhaseModel,
): ExecNode {
  if (phaseIndex(model, phase) < 0) {
    throw new Error(`classify: phase ${phase} not in pinned model for ${item.nodeType}`);
  }
  const excluded = !item.active;
  const node: ExecNode = {
    id,
    apiName: item.fullName,
    label,
    type: item.nodeType,
    object: item.object,
    phase,
    active: item.active,
    state: excluded ? 'excluded' : 'inferred',
    score: 0,
    evidence: evidenceFor(item),
  };
  if (item.namespace !== undefined) {
    node.namespace = item.namespace;
  }
  if (item.legacy) {
    node.legacy = true;
  }
  if (excluded) {
    node.excludeReason = 'inactive';
  }
  return node;
}

// Single evidence record backing phase assignment at this layer.
function evidenceFor(item: InventoryItem): Evidence[] {
  const type = EVIDENCE_TYPE[item.nodeType] ?? 'heuristic';
  return [{ type, ref: item.fullName }];
}
