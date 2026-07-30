// Stage-aware oracle. Runs only the stages a scenario manifest requires. Static stages take one dry-run
// deploy; a runtime stage provisions a disposable org, deploys, probes with anonymous apex, tears down.

import { apexRunArgs, deployArgs, normaliseRuntime, normaliseValidation } from './oracle.js';
import type { ProcRunner, TestLevel, ValidationResult } from './oracle.js';
import type { OracleStage } from './mutation.js';
import type { OrgProvisioner } from './orgProvisioner.js';
import { runtimeProbe } from './runtimeProbe.js';
import type { Workspace } from './workspace.js';

const SOURCE_DIR = 'force-app';

export interface StageContext {
  stages: OracleStage[];
  dir: string; // materialised project directory
  alias: string; // shared org for dry-run stages
  target: { object: string; event: string };
  run: ProcRunner;
  workspace: Workspace;
  timeoutMs: number;
  provisioner?: OrgProvisioner; // required when runtime_transaction is a stage
  disposableAlias?: string; // per-scenario runtime org alias
}

export interface StageResult {
  stage: OracleStage;
  result: ValidationResult;
}

export interface StageOracleOutcome {
  combined: ValidationResult; // first failing stage, else the last non-runtime pass
  stages: StageResult[];
  runtimeReviewNeeded: boolean; // probe used a describe fallback the operator should check
}

function testLevelFor(stages: OracleStage[]): TestLevel {
  return stages.includes('tests') ? 'RunLocalTests' : 'NoTestRun';
}

function worst(results: StageResult[]): ValidationResult {
  const failed = results.find((s) => s.result.outcome === 'fail');
  if (failed) return failed.result;
  const infra = results.find((s) => s.result.infrastructure !== 'ok');
  if (infra) return infra.result;
  const passed = [...results].reverse().find((s) => s.result.outcome === 'pass');
  return passed?.result ?? results[results.length - 1]?.result ?? notRun();
}

function notRun(): ValidationResult {
  return {
    outcome: 'not_run',
    failureClass: 'unknown',
    failingComponents: [],
    message: 'no oracle stage ran',
    actionable: false,
    infrastructure: 'ok',
    raw: {},
  };
}

// Run the non-runtime stages: one dry-run deploy covers metadata_validation and, when required, tests.
async function runStatic(ctx: StageContext): Promise<StageResult[]> {
  const proc = await ctx.run(
    'sf',
    deployArgs(ctx.alias, {
      dryRun: true,
      testLevel: testLevelFor(ctx.stages),
      sourceDir: SOURCE_DIR,
    }),
    { cwd: ctx.dir, timeoutMs: ctx.timeoutMs },
  );
  const result = normaliseValidation(proc);
  return ctx.stages
    .filter((stage) => stage !== 'runtime_transaction')
    .map((stage) => ({ stage, result }));
}

// Runtime stage: fresh org, real deploy, probe, teardown. Deploy checked first - no deploy, no runtime.
async function runRuntime(
  ctx: StageContext,
): Promise<{ result: StageResult; reviewNeeded: boolean }> {
  const stage: OracleStage = 'runtime_transaction';
  if (!ctx.provisioner || !ctx.disposableAlias) {
    return {
      result: {
        stage,
        result: {
          outcome: 'not_run',
          failureClass: 'unknown',
          failingComponents: [],
          message: 'runtime stage requires a provisioner and a disposable alias',
          actionable: false,
          infrastructure: 'permanent_failure',
          raw: {},
        },
      },
      reviewNeeded: false,
    };
  }
  const alias = ctx.disposableAlias;
  const provision = await ctx.provisioner.create(alias);
  if (!provision.ready) {
    return {
      result: {
        stage,
        result: {
          outcome: 'not_run',
          failureClass: 'unknown',
          failingComponents: [],
          message: `scratch org not ready: ${provision.message}`,
          actionable: false,
          infrastructure: 'retryable_failure',
          raw: {},
        },
      },
      reviewNeeded: false,
    };
  }
  try {
    const deploy = normaliseValidation(
      await ctx.run(
        'sf',
        deployArgs(alias, {
          dryRun: false,
          testLevel: testLevelFor(ctx.stages),
          sourceDir: SOURCE_DIR,
        }),
        { cwd: ctx.dir, timeoutMs: ctx.timeoutMs },
      ),
    );
    if (deploy.outcome === 'fail' || deploy.infrastructure !== 'ok') {
      return { result: { stage, result: deploy }, reviewNeeded: false };
    }
    const probe = runtimeProbe(
      ctx.target.object,
      ctx.target.event === 'create' ? 'create' : 'update',
    );
    ctx.workspace.write(ctx.dir, { [probe.path]: probe.apex });
    const runtime = normaliseRuntime(
      await ctx.run('sf', apexRunArgs(alias, probe.path), {
        cwd: ctx.dir,
        timeoutMs: ctx.timeoutMs,
      }),
    );
    return { result: { stage, result: runtime }, reviewNeeded: probe.requiresOperatorReview };
  } finally {
    await ctx.provisioner.remove(alias);
  }
}

// Run the required oracle stages and reduce to a combined outcome.
export async function runStageOracle(ctx: StageContext): Promise<StageOracleOutcome> {
  const results: StageResult[] = [];
  let runtimeReviewNeeded = false;

  const hasStatic = ctx.stages.some((s) => s !== 'runtime_transaction');
  if (hasStatic) {
    results.push(...(await runStatic(ctx)));
  }
  if (ctx.stages.includes('runtime_transaction')) {
    const runtime = await runRuntime(ctx);
    results.push(runtime.result);
    runtimeReviewNeeded = runtime.reviewNeeded;
  }

  return { combined: worst(results), stages: results, runtimeReviewNeeded };
}
