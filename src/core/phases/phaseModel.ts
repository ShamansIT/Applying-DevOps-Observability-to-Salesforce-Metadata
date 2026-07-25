import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** One phase of Salesforce Order of Execution */
export interface Phase {
  key: string;
  label: string;
  /** `false` for asynchronous phases */
  sync: boolean;
  /** `true` for legacy automations still present in orgs */
  legacy?: boolean;
}

/**
 * Release-pinned phase model, loaded from `phases.v<NN>.json`
 */
export interface PhaseModel {
  /** Pinned Salesforce API version, or `null` while provisional */
  apiVersion: string | null;
  /** `true` until phase list is verified line-by-line against pinned docs */
  provisional: boolean;
  /** Source URLs for Order-of-Execution documentation model was pinned against */
  source: string[];
  /** Date the sources were accessed, or `null` while provisional */
  accessed: string | null;
  note?: string;
  phases: Phase[];
}

const DEFAULT_PHASE_FILE = 'phases.provisional.json';

/**
 * Load phase model from the `phases/` directory (default: provisional file). Reads file
 * next to this module sopinned `phases.v<NN>.json` can be swapped in without code changes.
 */
export function loadPhaseModel(fileName: string = DEFAULT_PHASE_FILE): PhaseModel {
  const path = fileURLToPath(new URL(`./${fileName}`, import.meta.url));
  const model = JSON.parse(readFileSync(path, 'utf8')) as PhaseModel;
  validatePhaseModel(model);
  return model;
}

/** Structural checks independent of any release: non-empty, and phase keys unique. */
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

/** Ordered phase keys - between-phase order platform guarantees */
export function phaseKeys(model: PhaseModel): string[] {
  return model.phases.map((p) => p.key);
}

/** Index of a phase key in pinned order, or -1 if key is not in model */
export function phaseIndex(model: PhaseModel, key: string): number {
  return model.phases.findIndex((p) => p.key === key);
}
