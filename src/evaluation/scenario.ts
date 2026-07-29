// SCENARIO entity - evaluation side only. One controlled benchmark: object, DML event, cluster for
// programmatic-vs-declarative split, expansion depth, and snapshot it runs against. Beyond identity
// it carries benchmark provenance - fixed task prompt put to operator and tool, starting point,
// complexity and expansion profile, link to its ground-truth record, why it is in set, and pinned
// versions - so selection is transparent and run is reproducible. Evaluation depends on core; core
// never depends on evaluation, so ground truth cannot reach analysis.

import { readFileSync } from 'node:fs';
import type { DmlEvent } from '../core/index.js';

// Cluster drives programmatic-vs-declarative split across benchmark.
export type ScenarioCluster = 'programmatic' | 'declarative' | 'mixed';

// Coarse difficulty band, set when scenario is chosen, not measured from output.
export type ComplexityLevel = 'low' | 'medium' | 'high';

// Why scenario carries given structural weight - counts of participants and whether it reaches
// beyond triggering object. Descriptive, drives selection rationale, never fed to analysis.
export interface ComplexityProfile {
  level: ComplexityLevel;
  automationCount: number; // participants expected to fire for event
  crossObject: boolean; // reaches records of another object
}

// Whether scenario exercises subflow expansion and to what depth. Kept apart from `depthLimit`,
// which is runtime knob; this states intent behind that knob.
export interface ExpansionProfile {
  usesExpansion: boolean;
  maxDepth: number; // deepest expansion scenario means to exercise
  notes?: string;
}

// Pinned versions so run reproduces: model API level, prototype build, and snapshot identifier.
export interface ScenarioVersions {
  apiVersion: string; // Order-of-Execution model level scenario is pinned to
  toolVersion: string; // prototype build that authored record
  snapshot: string; // snapshot identifier scenario binds to
}

export interface Scenario {
  id: string;
  object: string;
  event: DmlEvent; // DML operation; analysis target event
  cluster: ScenarioCluster;
  depthLimit: number; // L5 runtime depth; 0 unless scenario tests expansion
  snapshot: string; // snapshot file path, relative to repository root
  taskPrompt: string; // fixed question put to operator and tool
  startingPoint: string; // artefact or screen operator begins from
  complexityProfile: ComplexityProfile;
  expansionProfile: ExpansionProfile;
  groundTruthReference: string; // ground-truth record id or path this scenario scores against
  inclusionRationale: string; // why scenario earns place in benchmark
  versions: ScenarioVersions;
  notes?: string;
}

const DML_EVENTS = new Set<string>(['create', 'update', 'delete', 'undelete']);
const CLUSTERS = new Set<string>(['programmatic', 'declarative', 'mixed']);
const LEVELS = new Set<string>(['low', 'medium', 'high']);

function requireText(value: unknown, id: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`scenario ${id}: ${field} is required`);
  }
}

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
  requireText(scenario.taskPrompt, scenario.id, 'taskPrompt');
  requireText(scenario.startingPoint, scenario.id, 'startingPoint');
  requireText(scenario.groundTruthReference, scenario.id, 'groundTruthReference');
  requireText(scenario.inclusionRationale, scenario.id, 'inclusionRationale');
  validateComplexity(scenario.complexityProfile, scenario.id);
  validateExpansion(scenario.expansionProfile, scenario.id);
  validateVersions(scenario.versions, scenario.id);
}

function validateComplexity(profile: ComplexityProfile | undefined, id: string): void {
  if (!profile || !LEVELS.has(profile.level)) {
    throw new Error(`scenario ${id}: complexityProfile.level must be low, medium or high`);
  }
  if (typeof profile.automationCount !== 'number' || profile.automationCount < 0) {
    throw new Error(`scenario ${id}: complexityProfile.automationCount must be non-negative`);
  }
  if (typeof profile.crossObject !== 'boolean') {
    throw new Error(`scenario ${id}: complexityProfile.crossObject must be boolean`);
  }
}

function validateExpansion(profile: ExpansionProfile | undefined, id: string): void {
  if (!profile || typeof profile.usesExpansion !== 'boolean') {
    throw new Error(`scenario ${id}: expansionProfile.usesExpansion must be boolean`);
  }
  if (typeof profile.maxDepth !== 'number' || profile.maxDepth < 0) {
    throw new Error(`scenario ${id}: expansionProfile.maxDepth must be non-negative`);
  }
}

function validateVersions(versions: ScenarioVersions | undefined, id: string): void {
  if (!versions) {
    throw new Error(`scenario ${id}: versions are required`);
  }
  requireText(versions.apiVersion, id, 'versions.apiVersion');
  requireText(versions.toolVersion, id, 'versions.toolVersion');
  requireText(versions.snapshot, id, 'versions.snapshot');
}

export function loadScenario(path: string): Scenario {
  const scenario = JSON.parse(readFileSync(path, 'utf8')) as Scenario;
  validateScenario(scenario);
  return scenario;
}
