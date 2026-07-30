// Experiment cli - offline commands that need no org. `selftest` runs the harness pipeline end to end
// in memory (mutation -> manifest -> normalised oracle -> timing -> scenario run -> metrics -> bundle)
// and checks it wires together, the analog of the statistics self-test. `schedule` and `power` read a
// json input and print a frozen schedule or a power plan. The org race commands are not here: they need
// a Dev Hub and scratch orgs, which are the operator's, and are documented in the experiment runbook.

import { readFileSync } from 'node:fs';
import { applyMutation } from './mutation.js';
import type { MutationSpec } from './mutation.js';
import { normaliseValidation } from './oracle.js';
import { computeExperimentMetrics } from './experimentMetrics.js';
import type { ScenarioRun } from './experimentMetrics.js';
import { computeTiming } from './race.js';
import { blockedSchedule } from './schedule.js';
import type { ScenarioDescriptor } from './schedule.js';
import { powerPlan } from './power.js';
import { buildExperimentBundle } from './storage.js';

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

export function main(argv: string[]): string {
  const [command, arg, seedArg] = argv;
  const seed = seedArg ? Number(seedArg) : 1;
  switch (command) {
    case 'selftest':
      return selftest();
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
        `experiment: unknown command '${command ?? ''}', expected selftest, schedule or power`,
      );
  }
}
