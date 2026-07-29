import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** One phase of Salesforce Order of Execution. */
export interface Phase {
  key: string;
  label: string;
  sync: boolean; // false for asynchronous phases
  legacy?: boolean; // true for legacy automations still found in orgs
}

// Pinned phase model, loaded from phases.v<NN>.json. Data, not code constants: release change
// means new file and new run, never silent classifier change.
export interface PhaseModel {
  apiVersion: string | null; // pinned Salesforce API version, or null while provisional
  provisional: boolean; // true until phase list is verified against pinned docs
  source: string[]; // documentation URLs model was pinned against
  accessed: string | null; // date sources were accessed, or null while provisional
  note?: string;
  phases: Phase[];
}

const DEFAULT_PHASE_FILE = 'phases.v67.json';

// Load phase model from phases/ folder (default: pinned file). Reads file next to this module, so
// pinned phases.v<NN>.json swaps in without code changes.
export function loadPhaseModel(fileName: string = DEFAULT_PHASE_FILE): PhaseModel {
  const path = fileURLToPath(new URL(`./${fileName}`, import.meta.url));
  return loadPhaseModelFromPath(path);
}

// Load phase model from an explicit path. For callers whose bundle sits away from the data file, so
// module-relative resolution would miss - they pass the path themselves.
export function loadPhaseModelFromPath(path: string): PhaseModel {
  const model = JSON.parse(readFileSync(path, 'utf8')) as PhaseModel;
  validatePhaseModel(model);
  return model;
}

// Structural checks, release-independent: non-empty, and keys unique.
export function validatePhaseModel(model: PhaseModel): void {
  if (model.phases.length === 0) {
    throw new Error('phase model has no phases');
  }
  const keys = model.phases.map((p) => p.key);
  const duplicates = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (duplicates.length > 0) {
    throw new Error(`phase model has duplicate phase keys: ${duplicates.join(', ')}`);
  }
}

// Ordered phase keys - between-phase order platform guarantees.
export function phaseKeys(model: PhaseModel): string[] {
  return model.phases.map((p) => p.key);
}

// Index of key in pinned order, or -1 when key is not in model.
export function phaseIndex(model: PhaseModel, key: string): number {
  return model.phases.findIndex((p) => p.key === key);
}
