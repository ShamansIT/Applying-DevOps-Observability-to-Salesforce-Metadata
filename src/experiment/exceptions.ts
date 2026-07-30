// Two-layer truth and exception queue. Design expectation and observed oracle result are stored apart;
// on disagreement or failure an exception is queued. Adjudication is append-only.

import type { AttemptResult } from './liveRunner.js';
import type { GeneratedScenario } from './scenarioGenerator.js';

export type TruthStatus = 'agree' | 'requires_adjudication';

export interface TruthRecord {
  scenarioId: string;
  designExpectation: {
    validationOutcome: 'pass' | 'fail';
    failureClass: string;
    detectability: string;
  };
  observedOracle: {
    validationOutcome: 'pass' | 'fail' | 'not_run';
    failureClass: string;
  };
  status: TruthStatus;
}

// Compare the two truth layers for one complete attempt. Disagreement on the outcome, or on the
// failure class when both failed, needs adjudication. A run that did not complete cannot confirm.
export function compareTruth(scenario: GeneratedScenario, attempt: AttemptResult): TruthRecord {
  const design = scenario.designExpectation;
  const observed = attempt.oracle;
  let status: TruthStatus = 'agree';
  if (attempt.status !== 'complete') {
    status = 'requires_adjudication';
  } else if (design.validationOutcome !== observed.outcome) {
    status = 'requires_adjudication';
  } else if (
    design.validationOutcome === 'fail' &&
    observed.outcome === 'fail' &&
    design.failureClass !== observed.failureClass &&
    observed.failureClass !== 'unknown'
  ) {
    status = 'requires_adjudication';
  }
  return {
    scenarioId: scenario.id,
    designExpectation: {
      validationOutcome: design.validationOutcome,
      failureClass: design.failureClass,
      detectability: design.detectability,
    },
    observedOracle: { validationOutcome: observed.outcome, failureClass: observed.failureClass },
    status,
  };
}

export type ExceptionType =
  | 'setup_failure'
  | 'prototype_crash'
  | 'infrastructure_failure'
  | 'unexpected_pass'
  | 'unexpected_fail'
  | 'failure_class_mismatch'
  | 'prototype_oracle_disagreement';

export interface Exception {
  scenarioId: string;
  topologyFamily: string;
  topologyInstance: string;
  mutationFamily: string;
  type: ExceptionType;
  designOutcome: 'pass' | 'fail';
  observedOutcome: 'pass' | 'fail' | 'not_run';
  prototypePrediction: string;
  suggestedAdjudications: string[];
}

function exceptionFor(scenario: GeneratedScenario, attempt: AttemptResult): Exception | null {
  const design = scenario.designExpectation;
  const observed = attempt.oracle;
  const shared = {
    scenarioId: scenario.id,
    topologyFamily: scenario.topologyFamilyId,
    topologyInstance: scenario.topologyInstanceId,
    mutationFamily: scenario.mutationFamily,
    designOutcome: design.validationOutcome,
    observedOutcome: observed.outcome,
    prototypePrediction: attempt.prototype.predictionCategory,
  };

  if (attempt.status === 'setup_failed') {
    return { ...shared, type: 'setup_failure', suggestedAdjudications: ['regenerate', 'exclude'] };
  }
  if (attempt.status === 'prototype_failed') {
    return {
      ...shared,
      type: 'prototype_crash',
      suggestedAdjudications: ['investigate', 'exclude'],
    };
  }
  if (attempt.status === 'infrastructure_failed') {
    return {
      ...shared,
      type: 'infrastructure_failure',
      suggestedAdjudications: ['retry', 'exclude'],
    };
  }
  // Complete attempts: check the two truth layers and the prototype/oracle relationship.
  if (design.validationOutcome === 'fail' && observed.outcome === 'pass') {
    return {
      ...shared,
      type: 'unexpected_pass',
      suggestedAdjudications: ['accept-observed', 'reclassify-runtime-only', 'exclude'],
    };
  }
  if (design.validationOutcome === 'pass' && observed.outcome === 'fail') {
    return {
      ...shared,
      type: 'unexpected_fail',
      suggestedAdjudications: ['accept-observed', 'fix-topology', 'exclude'],
    };
  }
  if (
    design.validationOutcome === 'fail' &&
    observed.outcome === 'fail' &&
    design.failureClass !== observed.failureClass &&
    observed.failureClass !== 'unknown'
  ) {
    return {
      ...shared,
      type: 'failure_class_mismatch',
      suggestedAdjudications: ['accept-observed', 'keep-design', 'adjudicate'],
    };
  }
  // Prototype disagreed with a failing oracle by not raising a concern - worth review, not critical.
  const raisedConcern = ['blocking_finding', 'material_warning', 'unresolved'].includes(
    attempt.prototype.predictionCategory,
  );
  if (observed.outcome === 'fail' && !raisedConcern) {
    return {
      ...shared,
      type: 'prototype_oracle_disagreement',
      suggestedAdjudications: ['review', 'add-diagnostic-rule'],
    };
  }
  return null;
}

// Machine-generated exception queue: only scenarios that need a human look.
export function buildExceptionQueue(
  scenarios: GeneratedScenario[],
  attempts: AttemptResult[],
): Exception[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const exceptions: Exception[] = [];
  for (const attempt of attempts) {
    const scenario = byId.get(attempt.scenarioId);
    if (!scenario) continue;
    const exception = exceptionFor(scenario, attempt);
    if (exception) exceptions.push(exception);
  }
  return exceptions;
}

export interface AdjudicationRecord {
  scenarioId: string;
  decision: string;
  rationale: string;
  by: string;
  at: string;
}

// Append-only: an adjudication is added, never overwriting a prior record or the design/observed truth.
export function appendAdjudication(
  log: readonly AdjudicationRecord[],
  record: AdjudicationRecord,
): AdjudicationRecord[] {
  return [...log, record];
}
