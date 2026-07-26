// Risk indicators. Review-attention signals computed after assembly. Deterministic and heuristic
// signals are kept apart and each carries its character, so UI never mixes them and fakes
// precision method does not claim. Pure; thresholds come from scenario config with defaults.

import type { PhaseModel } from '../phases/phaseModel.js';
import { phaseIndex } from '../phases/phaseModel.js';
import type { ExecEdge, ExecNode } from '../types.js';
import type { InventoryItem } from '../cascade/inventory.js';

export type RiskCharacter = 'deterministic' | 'heuristic';

// One indicator: primary value, whether it crosses attention threshold, and implicated nodes.
export interface RiskIndicator {
  key: string;
  label: string;
  character: RiskCharacter;
  value: number;
  flagged: boolean;
  detail?: string;
  nodes: string[]; // sorted node ids this indicator points at
}

// Attention thresholds, tunable per scenario. Defaults are placeholder until calibration.
export interface RiskConfig {
  fanThreshold: number; // combined degree over which a node draws attention
  densityThreshold: number; // active automations on one object over which density flags
  lowConfidenceThreshold: number; // share of low-confidence over which cluster flags
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  fanThreshold: 5,
  densityThreshold: 10,
  lowConfidenceThreshold: 0.5,
};

export interface RiskInput {
  nodes: ExecNode[];
  edges: ExecEdge[];
  items: InventoryItem[];
  phaseModel: PhaseModel;
  config?: Partial<RiskConfig>;
}

// Compute all seven indicators in fixed order.
export function computeRisk(input: RiskInput): RiskIndicator[] {
  const config = { ...DEFAULT_RISK_CONFIG, ...input.config };
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  return [
    fanInOut(input.nodes, input.edges, config),
    crossPhaseCoupling(input.edges, nodesById, input.phaseModel),
    unresolvedReferences(input.edges),
    lowConfidenceCluster(input.nodes, config),
    deferredReachability(input.nodes, input.phaseModel),
    recursionHint(input.edges, nodesById),
    automationDensity(input.items, config),
  ];
}

function sorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// 1. Fan-in / fan-out - node degree over edges. Deterministic within reconstructed graph.
function fanInOut(nodes: ExecNode[], edges: ExecEdge[], config: RiskConfig): RiskIndicator {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const flagged = nodes.filter((node) => (degree.get(node.id) ?? 0) > config.fanThreshold);
  const max = Math.max(0, ...[...degree.values()]);
  return {
    key: 'fan_in_out',
    label: 'Fan-in / fan-out',
    character: 'deterministic',
    value: flagged.length,
    flagged: flagged.length > 0,
    detail: `max degree ${String(max)}`,
    nodes: sorted(flagged.map((node) => node.id)),
  };
}

// 2. Cross-phase coupling - edges whose ends sit in different phases. Deterministic given phases.
function crossPhaseCoupling(
  edges: ExecEdge[],
  nodesById: Map<string, ExecNode>,
  model: PhaseModel,
): RiskIndicator {
  const implicated: string[] = [];
  let count = 0;
  for (const edge of edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (from && to && phaseIndex(model, from.phase) !== phaseIndex(model, to.phase)) {
      count += 1;
      implicated.push(from.id, to.id);
    }
  }
  return {
    key: 'cross_phase_coupling',
    label: 'Cross-phase coupling',
    character: 'deterministic',
    value: count,
    flagged: count > 0,
    nodes: sorted(implicated),
  };
}

// 3. Unresolved references - share of unresolved edges. Deterministic given state.
function unresolvedReferences(edges: ExecEdge[]): RiskIndicator {
  const unresolved = edges.filter((edge) => edge.state === 'unresolved');
  const share = edges.length > 0 ? unresolved.length / edges.length : 0;
  return {
    key: 'unresolved_references',
    label: 'Unresolved references',
    character: 'deterministic',
    value: round(share),
    flagged: unresolved.length > 0,
    detail: `${String(unresolved.length)} of ${String(edges.length)} edges`,
    nodes: sorted(unresolved.map((edge) => edge.from)),
  };
}

// 4. Low-confidence cluster - share of inferred/unresolved nodes. Deterministic by aggregation.
function lowConfidenceCluster(nodes: ExecNode[], config: RiskConfig): RiskIndicator {
  const low = nodes.filter((node) => node.state === 'inferred' || node.state === 'unresolved');
  const share = nodes.length > 0 ? low.length / nodes.length : 0;
  return {
    key: 'low_confidence_cluster',
    label: 'Low-confidence cluster',
    character: 'deterministic',
    value: round(share),
    flagged: share > config.lowConfidenceThreshold,
    detail: `${String(low.length)} of ${String(nodes.length)} nodes`,
    nodes: sorted(low.map((node) => node.id)),
  };
}

// 5. Deferred / post-commit reachability - nodes in asynchronous phases. Heuristic (runtime-dependent).
function deferredReachability(nodes: ExecNode[], model: PhaseModel): RiskIndicator {
  const asyncPhases = new Set(
    model.phases.filter((phase) => !phase.sync).map((phase) => phase.key),
  );
  const deferred = nodes.filter((node) => asyncPhases.has(node.phase));
  return {
    key: 'deferred_post_commit_reachability',
    label: 'Deferred / post-commit reachability',
    character: 'heuristic',
    value: deferred.length,
    flagged: deferred.length > 0,
    nodes: sorted(deferred.map((node) => node.id)),
  };
}

// 6. Recursion / re-entry hint - node whose logic writes back to its own object. Heuristic.
function recursionHint(edges: ExecEdge[], nodesById: Map<string, ExecNode>): RiskIndicator {
  const implicated: string[] = [];
  for (const edge of edges) {
    const from = nodesById.get(edge.from);
    if (from && edge.to === `object:${from.object}`) {
      implicated.push(from.id);
    }
  }
  return {
    key: 'recursion_reentry_hint',
    label: 'Recursion / re-entry hint',
    character: 'heuristic',
    value: implicated.length,
    flagged: implicated.length > 0,
    nodes: sorted(implicated),
  };
}

// 7. Automation density per object - active record-triggered automations on object. Deterministic.
function automationDensity(items: InventoryItem[], config: RiskConfig): RiskIndicator {
  const active = items.filter((item) => item.active);
  return {
    key: 'automation_density_per_object',
    label: 'Automation density per object',
    character: 'deterministic',
    value: active.length,
    flagged: active.length > config.densityThreshold,
    detail: `${String(active.length)} active automations`,
    nodes: [],
  };
}

// Round share to three places, so freeze stays byte-identical.
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
