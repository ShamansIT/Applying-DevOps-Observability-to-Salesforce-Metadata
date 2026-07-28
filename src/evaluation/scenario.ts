// SCENARIO entity - evaluation side only. One controlled benchmark: object, DML event, cluster for
// chapter-5 split, expansion depth, and snapshot it runs against. Evaluation depends on core; core
// never depends on evaluation, so ground truth cannot reach analysis.

import { readFileSync } from 'node:fs';
import type { DmlEvent } from '../core/index.js';

// Cluster drives chapter-5 programmatic-vs-declarative split.
export type ScenarioCluster = 'programmatic' | 'declarative' | 'mixed';

export interface Scenario {
  id: string;
  object: string;
  event: DmlEvent; // DML operation; analysis target event
  cluster: ScenarioCluster;
  depthLimit: number; // L5 depth; 0 unless scenario tests expansion
  snapshot: string; // snapshot file path, relative to repository root
  notes?: string;
}

const DML_EVENTS = new Set<string>(['create', 'update', 'delete', 'undelete']);
const CLUSTERS = new Set<string>(['programmatic', 'declarative', 'mixed']);

// Structural checks so malformed scenario fails loudly, not silently.
export function validateScenario(scenario: Scenario): void {
  if (!scenario.id || !scenario.object) {
    throw new Error('scenario: id and object are required');
  }
  if (!DML_EVENTS.has(scenario.event)) {
    throw new Error(`scenario ${scenario.id}: event must be a DML event`);
  }
  if (!CLUSTERS.has(scenario.cluster)) {
    throw new Error(`scenario ${scenario.id}: cluster must be programmatic, declarative or mixed`);
  }
  if (typeof scenario.depthLimit !== 'number' || scenario.depthLimit < 0) {
    throw new Error(`scenario ${scenario.id}: depthLimit must be a non-negative number`);
  }
  if (!scenario.snapshot) {
    throw new Error(`scenario ${scenario.id}: snapshot path is required`);
  }
}

export function loadScenario(path: string): Scenario {
  const scenario = JSON.parse(readFileSync(path, 'utf8')) as Scenario;
  validateScenario(scenario);
  return scenario;
}
