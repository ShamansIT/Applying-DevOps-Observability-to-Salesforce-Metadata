// Raw per-attempt storage. Every metric is a reduction; this is what it audits against - materialised
// hash, prototype output and reps, every CLI stdout/stderr, timing, design, observed, comparison.
// Redacted before write, so no token, auth URL, username or path reaches a raw file.

import type { FileMap, OracleStage } from './mutation.js';
import type { ObservedFailureClass, Outcome, PollingEvent, ValidationResult } from './oracle.js';
import type { PredictionCategory, PrototypeOutcome } from './prototypeAdapter.js';
import type { RaceTimestamps } from './race.js';
import type { DesignExpectation } from './scenarioGenerator.js';
import type { TruthRecord } from './exceptions.js';
import type { ProcRunner } from './oracle.js';
import { redact } from './storage.js';

export interface CliCall {
  file: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
}

// Wrap a runner so every call is recorded for raw storage. The wrapper is transparent - it forwards
// arguments and options and returns the same result, only observing.
export function capturingRunner(inner: ProcRunner): { run: ProcRunner; calls: CliCall[] } {
  const calls: CliCall[] = [];
  const run: ProcRunner = async (file, args, options) => {
    const result = await inner(file, args, options);
    calls.push({ file, args, code: result.code, stdout: result.stdout, stderr: result.stderr });
    return result;
  };
  return { run, calls };
}

export interface StageObservation {
  stage: OracleStage;
  outcome: Outcome;
  failureClass: ObservedFailureClass;
  message: string;
}

export interface RawAttemptRecord {
  scenarioId: string;
  attemptId: string;
  status: string;
  materialisedProjectHash: string;
  prototype: {
    prediction: PredictionCategory;
    repetitions: PredictionCategory[];
    deterministic: boolean;
    raw: PrototypeOutcome;
  };
  oracle: {
    combined: { outcome: Outcome; failureClass: ObservedFailureClass; message: string };
    stages: StageObservation[];
    runtimeReviewNeeded: boolean;
    pollingEvents: PollingEvent[];
  };
  cliCalls: CliCall[];
  timingEvents: Record<string, string>; // nanosecond marks as strings, so bigints serialise
  raceLeadsMs: number[];
  designExpectation: DesignExpectation;
  comparison: TruthRecord;
}

export interface RawAttemptInput {
  scenarioId: string;
  attemptId: string;
  status: string;
  materialisedProjectHash: string;
  prediction: PredictionCategory;
  prototypeRepetitions: PredictionCategory[];
  prototype: PrototypeOutcome;
  oracle: ValidationResult;
  stages: StageObservation[];
  runtimeReviewNeeded: boolean;
  pollingEvents: PollingEvent[];
  cliCalls: CliCall[];
  timestamps: RaceTimestamps;
  raceLeadsMs: number[];
  designExpectation: DesignExpectation;
  comparison: TruthRecord;
}

function timingEvents(ts: RaceTimestamps): Record<string, string> {
  return {
    t0Ns: ts.t0Ns.toString(),
    prototypeFirstActionableNs: ts.prototypeFirstActionableNs.toString(),
    prototypeCompletedNs: ts.prototypeCompletedNs.toString(),
    orgFirstActionableNs: ts.orgFirstActionableNs.toString(),
    orgValidationCompletedNs: ts.orgValidationCompletedNs.toString(),
  };
}

export function buildRawAttempt(input: RawAttemptInput): RawAttemptRecord {
  const repetitions = input.prototypeRepetitions;
  const deterministic = repetitions.every((p) => p === repetitions[0]);
  return {
    scenarioId: input.scenarioId,
    attemptId: input.attemptId,
    status: input.status,
    materialisedProjectHash: input.materialisedProjectHash,
    prototype: {
      prediction: input.prediction,
      repetitions,
      deterministic,
      raw: input.prototype,
    },
    oracle: {
      combined: {
        outcome: input.oracle.outcome,
        failureClass: input.oracle.failureClass,
        message: input.oracle.message,
      },
      stages: input.stages,
      runtimeReviewNeeded: input.runtimeReviewNeeded,
      pollingEvents: input.pollingEvents,
    },
    cliCalls: input.cliCalls,
    timingEvents: timingEvents(input.timestamps),
    raceLeadsMs: input.raceLeadsMs,
    designExpectation: input.designExpectation,
    comparison: input.comparison,
  };
}

export function rawAttemptPath(record: RawAttemptRecord): string {
  return `raw/${record.scenarioId}/${record.attemptId}.json`;
}

// Serialise raw records to a redacted path-to-content map, ready to fold into a result bundle.
export function rawAttemptFiles(records: RawAttemptRecord[]): FileMap {
  const files: FileMap = {};
  for (const record of records) {
    files[rawAttemptPath(record)] = redact(`${JSON.stringify(record, null, 2)}\n`);
  }
  return files;
}
