// Salesforce baseline and oracle adapter. Builds Salesforce CLI argument arrays (never shell-
// concatenated strings, so it is safe cross-platform), runs them through an injected process runner,
// and normalises the JSON into an outcome. For scratch orgs and sandbox-like targets, validation uses
// a dry-run deployment with local tests, per current Salesforce guidance - not the production-oriented
// deploy validate. The runner is injected, so the whole adapter is unit-tested against canned CLI
// responses with no org. Real org runs are the caller's; nothing here fabricates an outcome.

import type { FailureClass } from './mutation.js';

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
  if (text.includes('test') && text.includes('fail')) {
    return 'apex_test';
  }
  return 'unknown';
}

interface DeployJson {
  status?: number;
  name?: string;
  message?: string;
  result?: {
    success?: boolean;
    details?: {
      componentFailures?: { fullName?: string; problem?: string }[];
      runTestResult?: { failures?: { name?: string; message?: string }[] };
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
  // Parsed, no failures, not marked success: a pending or job-only response is not yet actionable.
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
  status: string;
  outcome: Outcome;
  actionable: boolean;
}

export interface PolledValidation {
  result: ValidationResult; // final, or a timeout marked as retryable infrastructure
  jobId: string | null;
  pollCount: number;
  pollingEvents: PollingEvent[];
  timedOut: boolean;
}

// Run validation, then follow a job-only or pending response through deploy report to a final result.
// A failure, success or infra fault is already final; job acceptance is not. Polling events are kept.
export async function runValidationPolled(
  alias: string,
  run: ProcRunner,
  options?: ProcOptions,
  poll: { maxPolls?: number } = {},
): Promise<PolledValidation> {
  const sourceDir = options ? 'force-app' : undefined;
  const proc = await run('sf', validateArgs(alias, sourceDir), options);
  const first = normaliseValidation(proc);
  const jobId = extractJobId(proc.stdout);

  if (first.actionable || first.infrastructure !== 'ok') {
    return { result: first, jobId, pollCount: 0, pollingEvents: [], timedOut: false };
  }
  if (!jobId) {
    // Not actionable and no job id to follow - a pending response we cannot poll.
    return { result: first, jobId: null, pollCount: 0, pollingEvents: [], timedOut: false };
  }

  const maxPolls = poll.maxPolls ?? 60;
  const pollingEvents: PollingEvent[] = [];
  for (let i = 1; i <= maxPolls; i += 1) {
    const report = await run('sf', deployReportArgs(alias, jobId), options);
    const result = normaliseValidation(report);
    pollingEvents.push({
      poll: i,
      status: deployStatus(report.stdout),
      outcome: result.outcome,
      actionable: result.actionable,
    });
    if (result.actionable || result.infrastructure !== 'ok') {
      return { result, jobId, pollCount: i, pollingEvents, timedOut: false };
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
    timedOut: true,
  };
}
