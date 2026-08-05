// Salesforce baseline and oracle adapter. Builds Salesforce CLI argument arrays (never shell-
// concatenated strings, so it is safe cross-platform), runs them through an injected process runner,
// and normalises the JSON into an outcome. The active metadata-validation oracle is a dry-run deploy with
// NoTestRun (see METADATA_VALIDATION_POLICY) - on a disposable scratch/dev org, running local tests would
// fail every clean base on code coverage, which is a test-suite signal, not metadata validity. A done
// deploy is terminal: Succeeded is pass, Failed/Canceled is fail, never re-reported. The runner is
// injected, so the adapter is unit-tested against canned CLI responses with no org. Real org runs are the
// caller's; nothing here fabricates an outcome.

import type { FailureClass } from './mutation.js';
import type { NanoClock } from './race.js';

export interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Execution options a runner honours. cwd points the CLI at the materialised scenario, not the working
// directory - the core of parity.
export interface ProcOptions {
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

export type ProcRunner = (
  file: string,
  args: string[],
  options?: ProcOptions,
) => Promise<ProcResult>;

export type Outcome = 'pass' | 'fail' | 'not_run';
export type InfrastructureStatus = 'ok' | 'retryable_failure' | 'permanent_failure';
export type ObservedFailureClass = FailureClass | 'unknown';

export interface ValidationResult {
  outcome: Outcome;
  failureClass: ObservedFailureClass;
  failingComponents: string[];
  message: string;
  actionable: boolean; // first response carries a specific failure or a completed success
  infrastructure: InfrastructureStatus;
  raw: unknown;
}

export type TestLevel = 'NoTestRun' | 'RunLocalTests';

export interface DeployOptions {
  dryRun: boolean;
  testLevel: TestLevel;
  sourceDir?: string;
}

// Deploy command builder. Dry-run checks metadata (with RunLocalTests, runs local tests too); a real
// deploy is needed before a runtime transaction. sourceDir is explicit, so the CLI targets the package.
export function deployArgs(alias: string, options: DeployOptions): string[] {
  const args = ['project', 'deploy', 'start'];
  if (options.dryRun) args.push('--dry-run');
  if (options.sourceDir) args.push('--source-dir', options.sourceDir);
  args.push('--test-level', options.testLevel, '--target-org', alias, '--json');
  return args;
}

// Dry-run deploy with local tests: the standard workflow feedback the prototype races against.
export function validateArgs(alias: string, sourceDir?: string): string[] {
  return deployArgs(alias, {
    dryRun: true,
    testLevel: 'RunLocalTests',
    ...(sourceDir ? { sourceDir } : {}),
  });
}

// Metadata-validation oracle policy (v1). The active oracle stage validates metadata shape, not Apex test
// outcomes. On a disposable scratch/dev org a freshly deployed trigger has 0% coverage, so RunLocalTests
// would fail every clean base on an org-wide code-coverage warning - a test-suite signal, never a
// metadata-validity one. NoTestRun keeps the oracle measuring exactly what the stage claims. Test-
// execution stages opt in to RunLocalTests explicitly (see stageOracle.ts). Versioned and recorded in the
// evidence output, so the exact policy behind an outcome is auditable.
export const METADATA_VALIDATION_POLICY = {
  version: 1,
  dryRun: true,
  testLevel: 'NoTestRun',
} as const satisfies { version: number; dryRun: boolean; testLevel: TestLevel };

// sf project deploy start --dry-run --test-level NoTestRun --source-dir force-app --target-org <alias>
// --json. The readiness and formal-pilot metadata-validation oracle.
export function metadataValidationArgs(alias: string, sourceDir?: string): string[] {
  return deployArgs(alias, {
    dryRun: METADATA_VALIDATION_POLICY.dryRun,
    testLevel: METADATA_VALIDATION_POLICY.testLevel,
    ...(sourceDir ? { sourceDir } : {}),
  });
}

// Anonymous-apex run against a deployed org, so a runtime-only failure deploy and tests miss can surface.
export function apexRunArgs(alias: string, file: string): string[] {
  return ['apex', 'run', '--target-org', alias, '--file', file, '--json'];
}

// Report on a submitted deploy job, so a queued deploy can be polled to a final result.
export function deployReportArgs(alias: string, jobId: string): string[] {
  return ['project', 'deploy', 'report', '--job-id', jobId, '--target-org', alias, '--json'];
}

export function createScratchArgs(devHub: string, definitionFile: string, alias: string): string[] {
  return [
    'org',
    'create',
    'scratch',
    '--target-dev-hub',
    devHub,
    '--definition-file',
    definitionFile,
    '--alias',
    alias,
    '--wait',
    '10',
    '--json',
  ];
}

export function deleteScratchArgs(alias: string): string[] {
  return ['org', 'delete', 'scratch', '--target-org', alias, '--no-prompt', '--json'];
}

// Keyword map from a Salesforce problem message to a failure class. Coarse but deterministic; unknown
// when nothing matches, never a silent guess.
function classifyFailure(problem: string): ObservedFailureClass {
  const text = problem.toLowerCase();
  if (
    text.includes('does not exist') ||
    text.includes('invalid field') ||
    text.includes('no such column')
  ) {
    return 'metadata_reference';
  }
  if (text.includes('dependent') || text.includes('missing') || text.includes('not found')) {
    return 'missing_dependency';
  }
  if (text.includes('compile') || text.includes('unexpected token') || text.includes('expecting')) {
    return 'compile';
  }
  if (text.includes('flow')) {
    return 'flow_reference';
  }
  if ((text.includes('test') && text.includes('fail')) || text.includes('coverage')) {
    return 'apex_test';
  }
  return 'unknown';
}

interface DeployJson {
  status?: number; // CLI exit-style status number, not the deploy status string below
  name?: string;
  message?: string;
  result?: {
    id?: string;
    done?: boolean;
    success?: boolean;
    status?: string; // deploy status string: Succeeded / Failed / Canceled / InProgress / ...
    errorMessage?: string;
    details?: {
      componentFailures?: { fullName?: string; problem?: string }[];
      runTestResult?: {
        failures?: { name?: string; message?: string }[];
        codeCoverageWarnings?: { name?: string; message?: string }[];
      };
    };
  };
}

// A parseable Salesforce error name that means the environment, not the change, failed.
const INFRA_NAMES = new Set([
  'NoOrgFound',
  'RequiresProject',
  'GenericTimeoutError',
  'AuthInfoCreationError',
  'NamedOrgNotFoundError',
]);

// Deploy status strings that are always terminal per the pinned CLI schema. Canceling is terminal only
// once done is true, so it is handled through the done flag rather than listed here.
const TERMINAL_STATUSES = new Set(['Succeeded', 'SucceededPartial', 'Failed', 'Canceled']);

function isTerminal(done: boolean | undefined, status: string | undefined): boolean {
  return done === true || (status !== undefined && TERMINAL_STATUSES.has(status));
}

// Normalise a dry-run deploy response. A job id or a pending poll is not actionable; a specific
// component or test failure, or a completed success, is.
export function normaliseValidation(proc: ProcResult): ValidationResult {
  let json: DeployJson;
  try {
    json = JSON.parse(proc.stdout) as DeployJson;
  } catch {
    // Unparseable output with a bad exit is an infrastructure or CLI failure, not a product failure.
    return infra(proc, 'retryable_failure', 'unparseable CLI output');
  }

  if (json.name && INFRA_NAMES.has(json.name)) {
    return infra(proc, 'permanent_failure', json.message ?? json.name);
  }

  const result = json.result ?? {};
  const componentFailures = result.details?.componentFailures ?? [];
  const testFailures = result.details?.runTestResult?.failures ?? [];

  if (componentFailures.length > 0) {
    const first = componentFailures[0];
    return {
      outcome: 'fail',
      failureClass: classifyFailure(first?.problem ?? ''),
      failingComponents: componentFailures.map((f) => f.fullName ?? '(unknown)'),
      message: first?.problem ?? 'component failure',
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }
  if (testFailures.length > 0) {
    const first = testFailures[0];
    return {
      outcome: 'fail',
      failureClass: 'apex_test',
      failingComponents: testFailures.map((f) => f.name ?? '(unknown)'),
      message: first?.message ?? 'test failure',
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }

  // Terminal state: a completed job is final and actionable - pass or fail - even with no itemised
  // component or test failure. An org-wide Apex code-coverage failure reports done, Failed, success false
  // with empty componentFailures; it is a real terminal fail, never a pending or not_run response.
  if (isTerminal(result.done, result.status)) {
    const succeeded = result.success === true || result.status === 'Succeeded';
    if (succeeded) {
      return {
        outcome: 'pass',
        failureClass: 'none',
        failingComponents: [],
        message: 'validation succeeded',
        actionable: true,
        infrastructure: 'ok',
        raw: json,
      };
    }
    const coverage = result.details?.runTestResult?.codeCoverageWarnings ?? [];
    const message =
      coverage[0]?.message ??
      result.errorMessage ??
      json.message ??
      `deploy ${result.status ?? 'terminal'} without success`;
    return {
      outcome: 'fail',
      failureClass: classifyFailure(message),
      failingComponents: [],
      message,
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }

  if (result.success === true) {
    return {
      outcome: 'pass',
      failureClass: 'none',
      failingComponents: [],
      message: 'validation succeeded',
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }
  // Parsed, no failures, not terminal, not marked success: a pending or job-only response, not actionable.
  return {
    outcome: 'not_run',
    failureClass: 'unknown',
    failingComponents: [],
    message: json.message ?? 'no actionable result yet',
    actionable: false,
    infrastructure: 'ok',
    raw: json,
  };
}

interface ApexRunJson {
  status?: number;
  name?: string;
  message?: string;
  result?: {
    success?: boolean;
    compiled?: boolean;
    compileProblem?: string;
    exceptionMessage?: string;
    exceptionStackTrace?: string;
  };
}

// Normalise an anonymous-apex run. Compile problem -> compile fail; exception -> runtime fail; clean
// success -> pass. Unparseable output is infrastructure, not a product fault.
export function normaliseRuntime(proc: ProcResult): ValidationResult {
  let json: ApexRunJson;
  try {
    json = JSON.parse(proc.stdout) as ApexRunJson;
  } catch {
    return infra(proc, 'retryable_failure', 'unparseable apex-run output');
  }
  if (json.name && INFRA_NAMES.has(json.name)) {
    return infra(proc, 'permanent_failure', json.message ?? json.name);
  }
  const result = json.result ?? {};
  if (result.compiled === false) {
    return {
      outcome: 'fail',
      failureClass: 'compile',
      failingComponents: [],
      message: result.compileProblem ?? 'anonymous apex did not compile',
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }
  if (result.success === false || (result.exceptionMessage ?? '') !== '') {
    return {
      outcome: 'fail',
      failureClass: 'runtime_exception',
      failingComponents: [],
      message: result.exceptionMessage ?? 'runtime transaction failed',
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }
  if (result.success === true) {
    return {
      outcome: 'pass',
      failureClass: 'none',
      failingComponents: [],
      message: 'runtime transaction succeeded',
      actionable: true,
      infrastructure: 'ok',
      raw: json,
    };
  }
  return {
    outcome: 'not_run',
    failureClass: 'unknown',
    failingComponents: [],
    message: json.message ?? 'no actionable runtime result',
    actionable: false,
    infrastructure: 'ok',
    raw: json,
  };
}

function infra(proc: ProcResult, status: InfrastructureStatus, message: string): ValidationResult {
  return {
    outcome: 'not_run',
    failureClass: 'unknown',
    failingComponents: [],
    message,
    actionable: false,
    infrastructure: status,
    raw: { code: proc.code, stderr: proc.stderr.slice(0, 500) },
  };
}

// Run dry-run validation through the injected runner and normalise. options carry cwd, so the CLI
// validates the materialised scenario, not the working directory.
export async function runValidation(
  alias: string,
  run: ProcRunner,
  options?: ProcOptions,
): Promise<ValidationResult> {
  const sourceDir = options ? 'force-app' : undefined;
  const proc = await run('sf', validateArgs(alias, sourceDir), options);
  return normaliseValidation(proc);
}

interface DeployStartJson {
  result?: { id?: string; status?: string };
}

// A submitted deploy returns a job id; following up on it is how a queued deploy reaches a final result.
function extractJobId(stdout: string): string | null {
  try {
    return (JSON.parse(stdout) as DeployStartJson).result?.id ?? null;
  } catch {
    return null;
  }
}

function deployStatus(stdout: string): string {
  try {
    return (JSON.parse(stdout) as DeployStartJson).result?.status ?? 'unknown';
  } catch {
    return 'unparseable';
  }
}

export interface PollingEvent {
  poll: number;
  tsNs: string; // monotonic experiment clock mark, or '0' when no clock is supplied
  status: string;
  outcome: Outcome;
  actionable: boolean;
}

export interface PolledValidation {
  result: ValidationResult; // final, or a timeout marked as retryable infrastructure
  jobId: string | null;
  pollCount: number;
  pollingEvents: PollingEvent[];
  firstActionablePoll: number | null; // poll index of first actionable feedback; 0 if immediate
  timedOut: boolean;
  initialArgs: string[]; // exact CLI arguments of the initial deploy (evidence)
  finalStatus: string; // Salesforce deploy status string at the final result (evidence)
}

// Compact, auditable evidence of one oracle observation - the exact command, test policy and terminal
// status behind an outcome. Recorded alongside the raw CLI calls, so a run is reproducible and honest.
export interface OracleObservation {
  policyVersion: number;
  testLevel: TestLevel;
  dryRun: boolean;
  command: string; // sf <initialArgs>
  jobId: string | null;
  pollCount: number;
  finalStatus: string;
  outcome: Outcome;
  timedOut: boolean;
}

// Build the metadata-validation observation from a polled result under the pinned policy.
export function metadataValidationObservation(polled: PolledValidation): OracleObservation {
  return {
    policyVersion: METADATA_VALIDATION_POLICY.version,
    testLevel: METADATA_VALIDATION_POLICY.testLevel,
    dryRun: METADATA_VALIDATION_POLICY.dryRun,
    command: `sf ${polled.initialArgs.join(' ')}`,
    jobId: polled.jobId,
    pollCount: polled.pollCount,
    finalStatus: polled.finalStatus,
    outcome: polled.result.outcome,
    timedOut: polled.timedOut,
  };
}

export interface PollOptions {
  maxPolls?: number;
  now?: NanoClock; // monotonic clock to timestamp each polling event
}

// Run a deploy command, then follow a job-only or pending response through deploy report to a final
// result. A failure, success or infra fault is already final; job acceptance is not. Polling events kept.
async function pollDeploy(
  alias: string,
  run: ProcRunner,
  initialArgs: string[],
  options: ProcOptions | undefined,
  poll: PollOptions,
): Promise<PolledValidation> {
  const mark = (): string => (poll.now ? poll.now().toString() : '0');
  const proc = await run('sf', initialArgs, options);
  const first = normaliseValidation(proc);
  const jobId = extractJobId(proc.stdout);
  const firstStatus = deployStatus(proc.stdout);

  if (first.actionable || first.infrastructure !== 'ok') {
    // Immediate final result (a terminal deploy or an infra fault): first-actionable coincides with
    // completion. No deploy report is issued for an already-terminal job.
    return {
      result: first,
      jobId,
      pollCount: 0,
      pollingEvents: [],
      firstActionablePoll: first.actionable ? 0 : null,
      timedOut: false,
      initialArgs,
      finalStatus: firstStatus,
    };
  }
  if (!jobId) {
    // Not actionable and no job id to follow - a pending response we cannot poll.
    return {
      result: first,
      jobId: null,
      pollCount: 0,
      pollingEvents: [],
      firstActionablePoll: null,
      timedOut: false,
      initialArgs,
      finalStatus: firstStatus,
    };
  }

  const maxPolls = poll.maxPolls ?? 60;
  const pollingEvents: PollingEvent[] = [];
  let firstActionablePoll: number | null = null;
  for (let i = 1; i <= maxPolls; i += 1) {
    const report = await run('sf', deployReportArgs(alias, jobId), options);
    const result = normaliseValidation(report);
    const status = deployStatus(report.stdout);
    if (firstActionablePoll === null && result.actionable) firstActionablePoll = i;
    pollingEvents.push({
      poll: i,
      tsNs: mark(),
      status,
      outcome: result.outcome,
      actionable: result.actionable,
    });
    // Stop at once on any terminal state or infra fault - a done job is never re-reported.
    if (result.actionable || result.infrastructure !== 'ok') {
      return {
        result,
        jobId,
        pollCount: i,
        pollingEvents,
        firstActionablePoll,
        timedOut: false,
        initialArgs,
        finalStatus: status,
      };
    }
  }
  return {
    result: {
      outcome: 'not_run',
      failureClass: 'unknown',
      failingComponents: [],
      message: `deploy ${jobId} did not reach a final result in ${String(maxPolls)} polls`,
      actionable: false,
      infrastructure: 'retryable_failure',
      raw: {},
    },
    jobId,
    pollCount: maxPolls,
    pollingEvents,
    firstActionablePoll,
    timedOut: true,
    initialArgs,
    finalStatus: pollingEvents[pollingEvents.length - 1]?.status ?? firstStatus,
  };
}

// Dry-run validation, polled to a final result. options carry cwd for the materialised scenario.
export async function runValidationPolled(
  alias: string,
  run: ProcRunner,
  options?: ProcOptions,
  poll: PollOptions = {},
): Promise<PolledValidation> {
  const sourceDir = options ? 'force-app' : undefined;
  // Metadata-validation policy: dry-run, NoTestRun (see METADATA_VALIDATION_POLICY). Coverage is not the
  // oracle stage, so it never invalidates a clean base on a disposable org.
  return pollDeploy(alias, run, metadataValidationArgs(alias, sourceDir), options, poll);
}

// Any deploy (dry-run or real, chosen test level), polled to a final result. Used by the stage oracle,
// so the pilot and main paths never mistake job acceptance for an outcome.
export async function runDeployPolled(
  alias: string,
  run: ProcRunner,
  deploy: DeployOptions,
  options?: ProcOptions,
  poll: PollOptions = {},
): Promise<PolledValidation> {
  return pollDeploy(alias, run, deployArgs(alias, deploy), options, poll);
}
