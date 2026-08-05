// Real-org session. Creates one shared scratch org, gates each base on the clean topology, runs the
// frozen schedule, writes the bundle plus raw records, plan and exceptions, tears the org down. Dev Hub
// only - CI runs the offline walking skeleton instead.

import { join } from 'node:path';
import type { PhaseModel, WeightModel } from '../core/index.js';
import { childProcRunner } from './childRunner.js';
import { validateCleanTopology } from './cleanTopology.js';
import type { CleanTopologyResult } from './cleanTopology.js';
import { buildExceptionQueue } from './exceptions.js';
import { computeExperimentMetrics } from './experimentMetrics.js';
import { parseExecutionPlan, orderScenarios } from './executionPlan.js';
import { cliProvisioner } from './orgProvisioner.js';
import { hrtimeClock } from './race.js';
import { rawAttemptFiles } from './rawStorage.js';
import { runScenarios } from './liveRunner.js';
import type { GeneratedScenario } from './scenarioGenerator.js';
import {
  generateBenchmark,
  topologyFilesIndex,
  topologyInstanceIndex,
} from './scenarioGenerator.js';
import { benchmarkQuality } from './benchmarkQuality.js';
import { buildExperimentBundle, writeImmutableBundle } from './storage.js';
import { nodeWorkspace, safeRemove } from './workspace.js';

export interface OrgSessionDeps {
  model: PhaseModel;
  weights: WeightModel;
}

export interface OrgSessionConfig {
  kind: 'pilot' | 'main' | 'skeleton';
  freezeId: string;
  devHub: string;
  planText?: string; // execution-schedule.json content, required for pilot and main
}

// One scenario per cluster gets prototype-timing repetitions, so the timing subset stays balanced and
// small rather than repeating every scenario.
function timingSubset(scenarios: GeneratedScenario[]): Set<string> {
  const seen = new Set<string>();
  const subset = new Set<string>();
  for (const scenario of scenarios) {
    if (!seen.has(scenario.cluster)) {
      seen.add(scenario.cluster);
      subset.add(scenario.id);
    }
  }
  return subset;
}

function selectScenarios(config: OrgSessionConfig): GeneratedScenario[] {
  const { pilot, main } = generateBenchmark();
  if (config.kind === 'skeleton') {
    const fail = main.find(
      (s) =>
        s.designExpectation.validationOutcome === 'fail' &&
        !s.mutationManifest.requiredOracleStages.includes('runtime_transaction'),
    );
    return [fail ?? main[0]].filter((s): s is GeneratedScenario => s !== undefined);
  }
  const pool = config.kind === 'pilot' ? pilot : main;
  if (config.kind === 'main') {
    const quality = benchmarkQuality(pilot, main);
    if (!quality.ok) {
      throw new Error(`main:org: benchmark blocked - ${quality.criticalViolations.join('; ')}`);
    }
  }
  if (!config.planText) {
    throw new Error(`${config.kind}:org: a frozen execution-schedule.json is required`);
  }
  return orderScenarios(pool, parseExecutionPlan(config.planText));
}

export async function runOrgSession(
  config: OrgSessionConfig,
  deps: OrgSessionDeps,
): Promise<string> {
  const scenarios = selectScenarios(config);
  if (scenarios.length === 0) throw new Error(`${config.kind}:org: no scenarios selected`);

  const filesIndex = topologyFilesIndex();
  const instanceIndex = topologyInstanceIndex();
  const workspace = nodeWorkspace();
  const run = childProcRunner();
  const sharedAlias = `${config.freezeId}-org`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);

  // A session project directory gives the scratch commands an sfdx project and a definition file.
  const firstInstanceId = scenarios[0]?.topologyInstanceId ?? '';
  const sessionInstance = instanceIndex.get(firstInstanceId);
  if (!sessionInstance)
    throw new Error(`${config.kind}:org: unknown session instance ${firstInstanceId}`);
  const sessionDir = workspace.create('session');
  workspace.write(sessionDir, sessionInstance.files);

  const provisioner = cliProvisioner(run, {
    devHub: config.devHub,
    definitionFile: 'config/project-scratch-def.json',
    cwd: sessionDir,
  });

  const cleanReports: CleanTopologyResult[] = [];
  try {
    const provisioned = await provisioner.create(sharedAlias);
    if (!provisioned.ready) {
      throw new Error(`${config.kind}:org: shared scratch org not ready - ${provisioned.message}`);
    }

    // Clean-topology gate: every distinct base must deploy before its scenarios run.
    const uniqueInstances = [...new Set(scenarios.map((s) => s.topologyInstanceId))];
    for (const instanceId of uniqueInstances) {
      const instance = instanceIndex.get(instanceId);
      if (!instance) throw new Error(`${config.kind}:org: unknown instance ${instanceId}`);
      const report = await validateCleanTopology(instance, {
        workspace,
        run,
        alias: sharedAlias,
      });
      cleanReports.push(report);
      if (!report.deployable) {
        throw new Error(
          `${config.kind}:org: clean topology ${instanceId} is not deployable - ${report.message}`,
        );
      }
    }

    const batch = await runScenarios(scenarios, {
      baseFilesFor: (id) => filesIndex.get(id) ?? {},
      model: deps.model,
      weights: deps.weights,
      procRunner: run,
      now: hrtimeClock,
      alias: sharedAlias,
      workspace,
      provisioner,
      prototypeReps: 5,
      raceReps: 5,
      timingSubset: timingSubset(scenarios),
    });

    const metrics = computeExperimentMetrics(batch.runs);
    const exceptions = buildExceptionQueue(scenarios, batch.attempts);
    const rawFiles = rawAttemptFiles(batch.attempts.map((attempt) => attempt.raw));
    const extraFiles: Record<string, string> = {
      'exceptions.json': `${JSON.stringify(exceptions, null, 2)}\n`,
      'clean-topology.json': `${JSON.stringify(cleanReports, null, 2)}\n`,
    };
    if (config.planText) extraFiles['execution-schedule.json'] = config.planText;

    const bundle = buildExperimentBundle({
      freezeId: config.freezeId,
      createdAt: new Date().toISOString(),
      runs: batch.runs,
      metrics,
      rawFiles,
      extraFiles,
    });
    writeImmutableBundle(bundle, join(process.cwd(), 'results', config.freezeId));

    return `${config.kind}:org ${config.freezeId}: ${String(batch.runs.length)}/${String(scenarios.length)} complete, ${String(exceptions.length)} exception(s), ${String(batch.infrastructureFailures.length)} infra failure(s)`;
  } finally {
    await provisioner.remove(sharedAlias);
    // Hardened, non-masking session teardown - a permanent cleanup failure never overwrites the summary.
    safeRemove(workspace, sessionDir);
  }
}
