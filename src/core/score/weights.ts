import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EvidenceType } from '../types.js';

// Weight model, loaded from config/weights.json. Data, not code constants: calibration replaces
// values without touching scorer, and run records which set it used. Held provisional until
// calibration search runs.
export interface WeightModel {
  provisional: boolean;
  note?: string;
  evidenceWeights: Record<EvidenceType, number>;
  thresholds: { confirmed: number; inferred: number };
}

const EVIDENCE_TYPES: EvidenceType[] = [
  'dependency_api',
  'flow_xml_static',
  'apex_static',
  'object_binding',
  'config_link',
  'heuristic',
];

// config/ sits at repository root, three levels up from this module.
const DEFAULT_WEIGHTS_URL = new URL('../../../config/weights.json', import.meta.url);

// Load weight model (default: pinned config file). Validates before returning.
export function loadWeights(url: URL = DEFAULT_WEIGHTS_URL): WeightModel {
  const model = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as WeightModel;
  validateWeights(model);
  return model;
}

// Structural checks: every evidence type weighted in [0, 1], thresholds in [0, 1], and confirmed
// threshold at or above inferred so state resolution stays monotonic.
export function validateWeights(model: WeightModel): void {
  for (const type of EVIDENCE_TYPES) {
    const weight = model.evidenceWeights[type];
    if (typeof weight !== 'number' || weight < 0 || weight > 1) {
      throw new Error(`weights: evidence weight for ${type} must be number in [0, 1]`);
    }
  }
  const { confirmed, inferred } = model.thresholds;
  if (typeof confirmed !== 'number' || typeof inferred !== 'number') {
    throw new Error('weights: thresholds must be numbers');
  }
  if (confirmed < inferred) {
    throw new Error('weights: confirmed threshold must be at or above inferred threshold');
  }
}
