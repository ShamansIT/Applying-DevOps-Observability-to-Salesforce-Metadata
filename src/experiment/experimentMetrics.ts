// Experiment metrics over normalised scenario runs. A scenario run is the reduced record the harness
// stores per scenario: what the mutation was, what the prototype predicted, what the oracle returned,
// and the race timing. Metrics are computed at scenario level: detection recall and precision over
// statically-detectable invalid scenarios, false-warning rate on valid scenarios, feedback-timing
// summaries, and a policy-gate simulation. Pure - no filesystem, no org.

import type { MutationDetectability, FailureClass } from './mutation.js';
import type { ObservedFailureClass, Outcome } from './oracle.js';
import type { PredictionCategory } from './prototypeAdapter.js';
import type { RaceTiming } from './race.js';

export interface ScenarioRun {
  scenarioId: string;
  cluster: 'declarative' | 'programmatic' | 'mixed';
  complexity: 'low' | 'medium' | 'high';
  expectedValidity: 'valid' | 'invalid';
  expectedFailureClass: FailureClass;
  detectability: MutationDetectability;
  prediction: PredictionCategory;
  oracleOutcome: Outcome;
  oracleFailureClass: ObservedFailureClass;
  timing: RaceTiming;
}

export interface DetectionMetrics {
  staticInvalid: number;
  detectedStaticInvalid: number;
  recall: number;
  valid: number;
  falseWarnings: number;
  falseWarningRate: number;
  precision: number; // raised-on-invalid over all raised
}

export interface TimingMetrics {
  n: number;
  prototypeFirstShare: number;
  leadP50Ms: number;
  leadP95Ms: number;
  prototypeTtfafP50Ms: number;
  baselineTtfafP50Ms: number;
}

export interface PolicyGateMetrics {
  validationsAvoided: number; // prototype raised a blocking-grade concern, org run could be skipped
  failuresInterceptedLocally: number; // invalid scenarios the prototype flagged before the oracle
  validFalselyBlocked: number; // valid scenarios the prototype would have blocked
  requireOrgConfirmation: number; // unresolved or clean, still need the org
}

export interface ExperimentMetrics {
  n: number;
  detection: DetectionMetrics;
  timing: TimingMetrics;
  policyGate: PolicyGateMetrics;
}

const CONCERN: ReadonlySet<PredictionCategory> = new Set([
  'blocking_finding',
  'material_warning',
  'unresolved',
]);

const BLOCKING: ReadonlySet<PredictionCategory> = new Set(['blocking_finding', 'material_warning']);

function isStatic(d: MutationDetectability): boolean {
  return d === 'static-direct' || d === 'static-inferred';
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 1000;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0] ?? 0;
  const pos = (ordered.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  const lowV = ordered[low] ?? 0;
  const highV = ordered[high] ?? 0;
  return Math.round((lowV + (highV - lowV) * (pos - low)) * 1000) / 1000;
}

function detection(runs: ScenarioRun[]): DetectionMetrics {
  const staticInvalid = runs.filter(
    (r) => r.expectedValidity === 'invalid' && isStatic(r.detectability),
  );
  const valid = runs.filter((r) => r.expectedValidity === 'valid');
  const detectedStaticInvalid = staticInvalid.filter((r) => CONCERN.has(r.prediction)).length;
  const falseWarnings = valid.filter((r) => BLOCKING.has(r.prediction)).length;
  const raisedInvalid = runs.filter(
    (r) => r.expectedValidity === 'invalid' && CONCERN.has(r.prediction),
  ).length;
  const raisedTotal = runs.filter((r) => CONCERN.has(r.prediction)).length;
  return {
    staticInvalid: staticInvalid.length,
    detectedStaticInvalid,
    recall: ratio(detectedStaticInvalid, staticInvalid.length),
    valid: valid.length,
    falseWarnings,
    falseWarningRate: ratio(falseWarnings, valid.length),
    precision: ratio(raisedInvalid, raisedTotal),
  };
}

function timing(runs: ScenarioRun[]): TimingMetrics {
  const leads = runs.map((r) => r.timing.leadTimeMs);
  return {
    n: runs.length,
    prototypeFirstShare: ratio(runs.filter((r) => r.timing.prototypeFirst).length, runs.length),
    leadP50Ms: quantile(leads, 0.5),
    leadP95Ms: quantile(leads, 0.95),
    prototypeTtfafP50Ms: quantile(
      runs.map((r) => r.timing.prototypeTtfafMs),
      0.5,
    ),
    baselineTtfafP50Ms: quantile(
      runs.map((r) => r.timing.baselineTtfafMs),
      0.5,
    ),
  };
}

function policyGate(runs: ScenarioRun[]): PolicyGateMetrics {
  return {
    validationsAvoided: runs.filter((r) => BLOCKING.has(r.prediction)).length,
    failuresInterceptedLocally: runs.filter(
      (r) => r.expectedValidity === 'invalid' && CONCERN.has(r.prediction),
    ).length,
    validFalselyBlocked: runs.filter(
      (r) => r.expectedValidity === 'valid' && BLOCKING.has(r.prediction),
    ).length,
    requireOrgConfirmation: runs.filter((r) => !BLOCKING.has(r.prediction)).length,
  };
}

export function computeExperimentMetrics(runs: ScenarioRun[]): ExperimentMetrics {
  return {
    n: runs.length,
    detection: detection(runs),
    timing: timing(runs),
    policyGate: policyGate(runs),
  };
}
