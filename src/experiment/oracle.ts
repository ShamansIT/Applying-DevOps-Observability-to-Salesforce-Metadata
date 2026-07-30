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

export type ProcRunner = (file: string, args: string[]) => Promise<ProcResult>;

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

// Dry-run deploy with local tests: the standard workflow feedback that the prototype races against.
export function validateArgs(alias: string): string[] {
  return [
    'project',
    'deploy',
    'start',
    '--dry-run',
    '--test-level',
    'RunLocalTests',
    '--target-org',
    alias,
    '--json',
  ];
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

// Run dry-run validation through the injected runner and normalise. A non-zero exit with parseable
// failure JSON is still a product outcome; only unparseable output is treated as infrastructure.
export async function runValidation(alias: string, run: ProcRunner): Promise<ValidationResult> {
  const proc = await run('sf', validateArgs(alias));
  return normaliseValidation(proc);
}
