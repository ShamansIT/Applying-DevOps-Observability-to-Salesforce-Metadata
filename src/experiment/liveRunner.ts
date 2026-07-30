// Live scenario runner. One per-scenario lifecycle - materialise to disk and checksum-verify, prototype
// determinism reps, one shared-t0 race against the stage oracle, scenario run, raw record, teardown.
// Boundaries injected, so it is mock-tested with no org.

import type { AnalysisTarget, PhaseModel, WeightModel } from '../core/index.js';
import type { FileMap } from './mutation.js';
import { buildScenario } from './materialise.js';
import type { ProcRunner, ValidationResult } from './oracle.js';
import { runPrototype } from './prototypeAdapter.js';
import type {
  PredictionCategory,
  PrototypeOutcome,
  RunPrototypeOptions,
} from './prototypeAdapter.js';
import { runRace } from './race.js';
import type { NanoClock, RaceTiming, RaceTimestamps } from './race.js';
import { snapshotFromFiles } from './snapshotBuilder.js';
import type { GeneratedScenario } from './scenarioGenerator.js';
import type { ScenarioRun } from './experimentMetrics.js';
import { materialiseVerified } from './workspace.js';
import type { Workspace } from './workspace.js';
import { runStageOracle } from './stageOracle.js';
import type { StageOracleOutcome } from './stageOracle.js';
import type { OrgProvisioner } from './orgProvisioner.js';
import { buildRawAttempt, capturingRunner } from './rawStorage.js';
import type { RawAttemptRecord, StageObservation } from './rawStorage.js';
import { compareTruth } from './exceptions.js';
import type { TruthRecord } from './exceptions.js';

export type AttemptStatus =
  'complete' | 'prototype_failed' | 'infrastructure_failed' | 'setup_failed' | 'timed_out';

export interface LiveDeps {
  baseFilesFor: (topologyInstanceId: string) => FileMap;
  model: PhaseModel;
  weights?: WeightModel; // pass explicitly so a bundled runner does not rely on default asset paths
  procRunner: ProcRunner;
  now: NanoClock;
  alias: string; // shared org for dry-run stages
  workspace: Workspace;
  timeoutMs?: number; // per CLI call, default 10 minutes
  provisioner?: OrgProvisioner; // required for runtime scenarios
  prototypeReps?: number; // determinism repetitions, default 5
  raceReps?: number; // prototype-timing repetitions for the timing subset, default 5
  timingSubset?: ReadonlySet<string>; // scenario ids that get race repetitions
  keepWorkspace?: boolean; // leave the materialised project on disk for debugging
}

export interface AttemptResult {
  scenarioId: string;
  attemptId: string;
  status: AttemptStatus;
  materialisedChecksum: string;
  prototype: PrototypeOutcome;
  prototypeDeterministic: boolean;
  prototypeRepetitions: PredictionCategory[];
  oracle: ValidationResult;
  oracleStages: StageObservation[];
  timing: RaceTiming;
  raceLeadsMs: number[];
  scenarioRun: ScenarioRun;
  comparison: TruthRecord;
  raw: RawAttemptRecord;
}

const DEFAULT_TIMEOUT_MS = 600_000;

function msBetween(from: bigint, to: bigint): number {
  return Math.round((Number(to - from) / 1e6) * 1000) / 1000;
}

function prototypeOptions(deps: LiveDeps): RunPrototypeOptions {
  return {
    sourceResolver: (component) => component.source,
    ...(deps.weights ? { weights: deps.weights } : {}),
  };
}

function disposableAlias(alias: string, scenarioId: string): string {
  return `${alias}-${scenarioId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
}

const EMPTY_TIMESTAMPS: RaceTimestamps = {
  t0Ns: 0n,
  prototypeFirstActionableNs: 0n,
  prototypeCompletedNs: 0n,
  orgFirstActionableNs: 0n,
  orgValidationCompletedNs: 0n,
};

const EMPTY_TIMING: RaceTiming = {
  prototypeTtfafMs: 0,
  baselineTtfafMs: 0,
  leadTimeMs: 0,
  prototypeLatencyMs: 0,
  oracleLatencyMs: 0,
  prototypeFirst: false,
};

// A setup failure - missing base or unmaterialisable mutation - is a recorded status, so the batch never
// throws mid-schedule.
function setupFailed(
  scenario: GeneratedScenario,
  attemptId: string,
  message: string,
): AttemptResult {
  const prototype: PrototypeOutcome = {
    predictionCategory: 'prototype_failure',
    actionableFinding: {
      category: 'prototype_failure',
      component: null,
      reason: message,
      scope: 'none',
    },
    affectedComponents: [],
    stageEvents: [],
    failed: true,
    error: message,
  };
  const oracle: ValidationResult = {
    outcome: 'not_run',
    failureClass: 'unknown',
    failingComponents: [],
    message,
    actionable: false,
    infrastructure: 'ok',
    raw: {},
  };
  const scenarioRun: ScenarioRun = {
    scenarioId: scenario.id,
    cluster: scenario.cluster,
    complexity: scenario.complexity,
    expectedValidity: scenario.mutationManifest.expectedValidity,
    expectedFailureClass: scenario.mutationManifest.expectedFailureClass,
    detectability: scenario.mutationManifest.detectability,
    prediction: 'prototype_failure',
    oracleOutcome: 'not_run',
    oracleFailureClass: 'unknown',
    timing: EMPTY_TIMING,
  };
  const base: AttemptResult = {
    scenarioId: scenario.id,
    attemptId,
    status: 'setup_failed',
    materialisedChecksum: '',
    prototype,
    prototypeDeterministic: false,
    prototypeRepetitions: [],
    oracle,
    oracleStages: [],
    timing: EMPTY_TIMING,
    raceLeadsMs: [],
    scenarioRun,
    comparison: { scenarioId: scenario.id } as unknown as TruthRecord,
    raw: {} as unknown as RawAttemptRecord,
  };
  const comparison = compareTruth(scenario, base);
  const raw = buildRawAttempt({
    scenarioId: scenario.id,
    attemptId,
    status: 'setup_failed',
    materialisedProjectHash: '',
    prediction: 'prototype_failure',
    prototypeRepetitions: [],
    prototype,
    oracle,
    stages: [],
    runtimeReviewNeeded: false,
    cliCalls: [],
    timestamps: EMPTY_TIMESTAMPS,
    raceLeadsMs: [],
    designExpectation: scenario.designExpectation,
    comparison,
  });
  return { ...base, comparison, raw };
}

function observations(outcome: StageOracleOutcome): StageObservation[] {
  return outcome.stages.map((stage) => ({
    stage: stage.stage,
    outcome: stage.result.outcome,
    failureClass: stage.result.failureClass,
    message: stage.result.message,
  }));
}

// Run one scenario end to end. A prototype crash or infrastructure failure is a recorded status, so the
// batch continues. The materialised project is always torn down unless the caller keeps it.
export async function runScenarioLive(
  scenario: GeneratedScenario,
  deps: LiveDeps,
  attemptId = 'a1',
): Promise<AttemptResult> {
  const baseFiles = deps.baseFilesFor(scenario.topologyInstanceId);
  let built: ReturnType<typeof buildScenario>;
  try {
    built = buildScenario(scenario.id, baseFiles, scenario.mutationSpec);
  } catch (error) {
    return setupFailed(scenario, attemptId, error instanceof Error ? error.message : String(error));
  }

  let material: ReturnType<typeof materialiseVerified>;
  try {
    material = materialiseVerified(
      deps.workspace,
      `${scenario.id}-${attemptId}`,
      built.files,
      built.mutatedChecksum,
    );
  } catch (error) {
    return setupFailed(scenario, attemptId, error instanceof Error ? error.message : String(error));
  }

  try {
    const snapshot = snapshotFromFiles(built.files);
    const target = scenario.mutationSpec.target as AnalysisTarget;
    const options = prototypeOptions(deps);

    // Prototype determinism repetitions: same snapshot, same prediction expected every time.
    const reps = deps.prototypeReps ?? 5;
    const predictions: PredictionCategory[] = [];
    const prototypeLatencies: number[] = [];
    for (let i = 0; i < reps; i += 1) {
      const start = deps.now();
      const rep = runPrototype(snapshot, target, deps.model, options).outcome;
      prototypeLatencies.push(msBetween(start, deps.now()));
      predictions.push(rep.predictionCategory);
    }
    const deterministic = predictions.every((prediction) => prediction === predictions[0]);

    // One shared-t0 observation: the prototype against the stage-aware oracle. The oracle runs once.
    const captured = capturingRunner(deps.procRunner);
    let stageOutcome: StageOracleOutcome | null = null;
    const race = await runRace({
      prototype: () => runPrototype(snapshot, target, deps.model, options).outcome,
      oracle: async () => {
        stageOutcome = await runStageOracle({
          stages: scenario.mutationManifest.requiredOracleStages,
          dir: material.dir,
          alias: deps.alias,
          target: scenario.mutationSpec.target,
          run: captured.run,
          workspace: deps.workspace,
          timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(deps.provisioner ? { provisioner: deps.provisioner } : {}),
          disposableAlias: disposableAlias(deps.alias, scenario.id),
        });
        return stageOutcome.combined;
      },
      now: deps.now,
    });
    const oracle: StageOracleOutcome = stageOutcome ?? {
      combined: race.oracle,
      stages: [],
      runtimeReviewNeeded: false,
    };

    // Timing subset gets prototype-timing repetitions against the single observed baseline latency.
    const raceLeadsMs = deps.timingSubset?.has(scenario.id)
      ? prototypeLatencies.map(
          (latency) => Math.round((race.timing.baselineTtfafMs - latency) * 1000) / 1000,
        )
      : [race.timing.leadTimeMs];

    const prototypeFailed =
      race.prototype.failed || predictions.some((prediction) => prediction === 'prototype_failure');
    const status: AttemptStatus = prototypeFailed
      ? 'prototype_failed'
      : oracle.combined.infrastructure !== 'ok'
        ? 'infrastructure_failed'
        : 'complete';

    const scenarioRun: ScenarioRun = {
      scenarioId: scenario.id,
      cluster: scenario.cluster,
      complexity: scenario.complexity,
      expectedValidity: scenario.mutationManifest.expectedValidity,
      expectedFailureClass: scenario.mutationManifest.expectedFailureClass,
      detectability: scenario.mutationManifest.detectability,
      prediction: race.prototype.predictionCategory,
      oracleOutcome: oracle.combined.outcome,
      oracleFailureClass: oracle.combined.failureClass,
      timing: race.timing,
    };

    const attempt: AttemptResult = {
      scenarioId: scenario.id,
      attemptId,
      status,
      materialisedChecksum: material.checksum,
      prototype: race.prototype,
      prototypeDeterministic: deterministic,
      prototypeRepetitions: predictions,
      oracle: oracle.combined,
      oracleStages: observations(oracle),
      timing: race.timing,
      raceLeadsMs,
      scenarioRun,
      comparison: { scenarioId: scenario.id } as unknown as TruthRecord,
      raw: {} as unknown as RawAttemptRecord,
    };
    const comparison = compareTruth(scenario, attempt);
    const raw = buildRawAttempt({
      scenarioId: scenario.id,
      attemptId,
      status,
      materialisedProjectHash: material.checksum,
      prediction: race.prototype.predictionCategory,
      prototypeRepetitions: predictions,
      prototype: race.prototype,
      oracle: oracle.combined,
      stages: observations(oracle),
      runtimeReviewNeeded: oracle.runtimeReviewNeeded,
      cliCalls: captured.calls,
      timestamps: race.timestamps,
      raceLeadsMs,
      designExpectation: scenario.designExpectation,
      comparison,
    });
    return { ...attempt, comparison, raw };
  } finally {
    if (!deps.keepWorkspace) deps.workspace.remove(material.dir);
  }
}

export interface BatchOptions {
  maxInfraRetries?: number;
}

export interface BatchResult {
  attempts: AttemptResult[];
  runs: ScenarioRun[]; // complete attempts only
  infrastructureFailures: AttemptResult[];
}

// Run a scheduled set. Infrastructure failure retries up to the limit with a new attempt id; failed
// attempts are kept, only complete ones contribute scenario runs.
export async function runScenarios(
  scenarios: GeneratedScenario[],
  deps: LiveDeps,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const maxRetries = options.maxInfraRetries ?? 2;
  const attempts: AttemptResult[] = [];
  const runs: ScenarioRun[] = [];
  const infrastructureFailures: AttemptResult[] = [];

  for (const scenario of scenarios) {
    let attempt = await runScenarioLive(scenario, deps, 'a1');
    let tries = 1;
    while (attempt.status === 'infrastructure_failed' && tries <= maxRetries) {
      infrastructureFailures.push(attempt);
      attempts.push(attempt);
      tries += 1;
      attempt = await runScenarioLive(scenario, deps, `a${String(tries)}`);
    }
    attempts.push(attempt);
    if (attempt.status === 'complete') {
      runs.push(attempt.scenarioRun);
    } else if (attempt.status === 'infrastructure_failed') {
      infrastructureFailures.push(attempt);
    }
  }

  return { attempts, runs, infrastructureFailures };
}
