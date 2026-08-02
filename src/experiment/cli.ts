// Experiment cli. Offline commands (selftest, generate, validate-plan, freeze-plan, walking-skeleton)
// need no org; live commands (walking-skeleton:org, pilot:org, main:org) run against a Dev Hub.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPhaseModelFromPath } from '../core/phases/phaseModel.js';
import { loadWeights } from '../core/score/index.js';
import { applyMutation } from './mutation.js';
import type { MutationSpec } from './mutation.js';
import { normaliseValidation } from './oracle.js';
import type { ProcResult } from './oracle.js';
import { computeExperimentMetrics } from './experimentMetrics.js';
import type { ScenarioRun } from './experimentMetrics.js';
import { computeTiming } from './race.js';
import { blockedSchedule } from './schedule.js';
import type { ScenarioDescriptor } from './schedule.js';
import { powerPlan } from './power.js';
import { buildExperimentBundle } from './storage.js';
import { generateBenchmark, topologyFilesIndex } from './scenarioGenerator.js';
import { benchmarkQuality } from './benchmarkQuality.js';
import { runScenarioLive } from './liveRunner.js';
import type { LiveDeps } from './liveRunner.js';
import { memoryWorkspace } from './workspace.js';
import { buildExecutionPlan, serialiseExecutionPlan } from './executionPlan.js';
import { runOrgSession } from './orgSession.js';
import { runReadinessOrg } from './readinessOrg.js';
import {
  aggregateCommand,
  packageCommand,
  runReconstructCommand,
  statsCommand,
} from './reconstructCli.js';
import { runOrgCheckCommand } from './orgCheckCli.js';

// Load pinned phase model and weights by explicit path, so the bundled cli resolves them from the repo
// and not relative to the bundle.
function phaseModel(): ReturnType<typeof loadPhaseModelFromPath> {
  return loadPhaseModelFromPath(resolve(process.cwd(), 'src', 'core', 'phases', 'phases.v67.json'));
}

function weights(): ReturnType<typeof loadWeights> {
  return loadWeights(pathToFileURL(resolve(process.cwd(), 'config', 'weights.json')));
}

export function selftest(): string {
  const base = {
    'classes/AccountService.cls': 'public class AccountService { public static void run() {} }',
  };
  const spec: MutationSpec = {
    id: 'ST-01',
    family: 'missing_field_reference',
    seed: 1,
    baseTopologyId: 'T-selftest',
    target: { object: 'Account', event: 'update' },
    file: 'classes/AccountService.cls',
    token: 'run',
  };
  const { manifest } = applyMutation(base, spec);
  const oracle = normaliseValidation({
    code: 1,
    stdout: JSON.stringify({
      result: {
        success: false,
        details: {
          componentFailures: [{ fullName: 'AccountService', problem: 'Field does not exist' }],
        },
      },
    }),
    stderr: '',
  });
  const timing = computeTiming({
    t0Ns: 0n,
    prototypeFirstActionableNs: 5_000_000n,
    prototypeCompletedNs: 5_000_000n,
    orgFirstActionableNs: 20_000_000n,
    orgValidationCompletedNs: 20_000_000n,
  });
  const run: ScenarioRun = {
    scenarioId: manifest.mutationId,
    cluster: 'programmatic',
    complexity: 'low',
    expectedValidity: manifest.expectedValidity,
    expectedFailureClass: manifest.expectedFailureClass,
    detectability: manifest.detectability,
    prediction: 'material_warning',
    oracleOutcome: oracle.outcome,
    oracleFailureClass: oracle.failureClass,
    timing,
  };
  const metrics = computeExperimentMetrics([run]);
  const bundle = buildExperimentBundle({
    freezeId: 'selftest',
    createdAt: '1970-01-01T00:00:00.000Z',
    runs: [run],
    metrics,
  });
  if (metrics.detection.recall !== 1 || oracle.failureClass !== 'metadata_reference') {
    throw new Error('experiment selftest: pipeline produced an unexpected result');
  }
  if (!bundle['checksums.sha256'] || !bundle['datasets/scenario-runs.csv']) {
    throw new Error('experiment selftest: bundle is missing files');
  }
  return 'experiment selftest: ok';
}

function generate(kind: 'pilot' | 'main'): string {
  const { pilot, main } = generateBenchmark();
  const report = benchmarkQuality(pilot, main);
  return JSON.stringify(
    {
      kind,
      pilotScenarios: pilot.length,
      mainScenarios: main.length,
      ok: report.ok,
      clusterBalance: report.clusterBalance,
      violations: report.criticalViolations,
    },
    null,
    2,
  );
}

function validatePlan(): string {
  const { pilot, main } = generateBenchmark();
  const report = benchmarkQuality(pilot, main);
  if (!report.ok) {
    throw new Error(`validate-plan: benchmark blocked - ${report.criticalViolations.join('; ')}`);
  }
  return `validate-plan: ok, ${String(main.length)} main and ${String(pilot.length)} pilot scenarios`;
}

function planPath(kind: 'pilot' | 'main'): string {
  return resolve(process.cwd(), `execution-schedule.${kind}.json`);
}

// Freeze the blocked-randomised order to a file the live runner reads, so the order is decided once and
// never re-derived at run time.
function freezePlan(kind: 'pilot' | 'main', seed: number): string {
  const { pilot, main } = generateBenchmark();
  const scenarios = kind === 'pilot' ? pilot : main;
  const plan = buildExecutionPlan(scenarios, kind, seed);
  writeFileSync(planPath(kind), serialiseExecutionPlan(plan), 'utf8');
  return `freeze-plan: wrote ${planPath(kind)}, ${String(plan.items.length)} scenarios, seed ${String(seed)}`;
}

// Offline walking skeleton: generation -> materialise -> prototype -> mock oracle -> timing -> run.
async function walkingSkeleton(): Promise<string> {
  const { main } = generateBenchmark();
  const scenario = main.find((s) => s.designExpectation.validationOutcome === 'fail') ?? main[0];
  if (!scenario) throw new Error('walking-skeleton: no scenario generated');
  const files = topologyFilesIndex();
  const mockOracle = (): Promise<ProcResult> =>
    Promise.resolve({
      code: 1,
      stdout: JSON.stringify({
        result: {
          success: false,
          details: { componentFailures: [{ fullName: 'X', problem: 'Field does not exist' }] },
        },
      }),
      stderr: '',
    });
  let tick = 0n;
  const deps: LiveDeps = {
    baseFilesFor: (id) => files.get(id) ?? {},
    model: phaseModel(),
    weights: weights(),
    procRunner: mockOracle,
    now: () => {
      tick += 1_000_000n;
      return tick;
    },
    alias: 'offline',
    workspace: memoryWorkspace(),
  };
  const attempt = await runScenarioLive(scenario, deps);
  return `walking skeleton (offline mock): ${scenario.id} -> status ${attempt.status}, prototype ${attempt.prototype.predictionCategory} (deterministic ${String(attempt.prototypeDeterministic)}), oracle ${attempt.oracle.outcome}, lead ${String(attempt.timing.leadTimeMs)}ms`;
}

// Delegate a live org command to the session module (excluded from the offline gate: it needs a Dev
// Hub). walking-skeleton:org runs one scenario end to end; pilot:org and main:org read a frozen plan.
function orgKind(command: string): 'pilot' | 'main' | 'skeleton' {
  if (command === 'pilot:org') return 'pilot';
  if (command === 'main:org') return 'main';
  return 'skeleton';
}

// Value after a --flag in the argument list, or undefined.
function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function runOrgCommand(command: string, freezeId: string, devHub: string): Promise<string> {
  const kind = orgKind(command);
  const planText =
    kind === 'skeleton' || !existsSync(planPath(kind))
      ? undefined
      : readFileSync(planPath(kind), 'utf8');
  return runOrgSession(
    { kind, freezeId, devHub, ...(planText ? { planText } : {}) },
    { model: phaseModel(), weights: weights() },
  );
}

export async function main(argv: string[]): Promise<string> {
  const [command, arg, seedArg] = argv;
  const seed = seedArg ? Number(seedArg) : 1;
  switch (command) {
    case 'selftest':
      return selftest();
    case 'generate':
      return generate(arg === 'pilot' ? 'pilot' : 'main');
    case 'validate-plan':
      return validatePlan();
    case 'walking-skeleton':
      return walkingSkeleton();
    case 'freeze-plan':
      return freezePlan(arg === 'pilot' ? 'pilot' : 'main', seed);
    case 'walking-skeleton:org':
    case 'pilot:org':
    case 'main:org': {
      const kind = orgKind(command);
      const freezeId = arg ?? `${new Date().toISOString().slice(0, 10)}-${kind}`;
      const devHub = seedArg;
      if (!devHub) {
        throw new Error(`${command}: needs a Dev Hub alias, e.g. -- <freeze-id> <dev-hub-alias>`);
      }
      return runOrgCommand(command, freezeId, devHub);
    }
    case 'reconstruct':
      return runReconstructCommand(
        arg ?? `reconstruct-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        phaseModel(),
        weights(),
      );
    case 'aggregate': {
      if (!arg) throw new Error('aggregate: needs a reconstruction freeze id');
      return aggregateCommand(arg);
    }
    case 'package': {
      if (!arg) throw new Error('package: needs a reconstruction freeze id');
      return packageCommand(arg);
    }
    case 'stats': {
      if (!arg) throw new Error('stats: needs a reconstruction freeze id');
      return statsCommand(arg);
    }
    case 'org:check':
      return runOrgCheckCommand(flagValue(argv, '--dev-hub'), flagValue(argv, '--target-org'));
    case 'readiness:org': {
      const devHub = flagValue(argv, '--dev-hub');
      if (!devHub) throw new Error('readiness:org: needs --dev-hub <alias>');
      const runId =
        flagValue(argv, '--run-id') ??
        `readiness-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const report = await runReadinessOrg({
        devHub,
        runId,
        model: phaseModel(),
        weights: weights(),
      });
      const detail = report.blockers.length ? ` - ${report.blockers.join('; ')}` : '';
      return `readiness ${runId}: ${report.decision}${detail}`;
    }
    case 'schedule': {
      if (!arg) throw new Error('experiment schedule: needs a scenarios json path');
      const scenarios = JSON.parse(readFileSync(arg, 'utf8')) as ScenarioDescriptor[];
      return JSON.stringify(blockedSchedule(scenarios, seed), null, 2);
    }
    case 'power': {
      if (!arg) throw new Error('experiment power: needs a pilot-diffs json path');
      const diffs = JSON.parse(readFileSync(arg, 'utf8')) as number[];
      return JSON.stringify(powerPlan(diffs, [54, 72, 90, 108, 126], 2000, seed), null, 2);
    }
    default:
      throw new Error(
        `experiment: unknown command '${command ?? ''}', expected selftest, generate, validate-plan, freeze-plan, walking-skeleton, walking-skeleton:org, pilot:org, main:org, readiness:org, org:check, reconstruct, aggregate, package, stats, schedule or power`,
      );
  }
}
