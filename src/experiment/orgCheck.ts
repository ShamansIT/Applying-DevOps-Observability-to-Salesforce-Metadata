// Pre-org check. Inspects cli, auth alias, Dev Hub, project template, api version and writable storage,
// all read-only, never creating a scratch org. Runner and probes injected, so it is tested with no org.

import type { FileMap } from './mutation.js';
import type { ProcRunner } from './oracle.js';

export interface OrgCheckDeps {
  run: ProcRunner;
  projectTemplate: FileMap; // the deployable project the harness materialises for a run
  canWriteResults: boolean; // whether results/ is writable
  expectedApiVersion: string;
  devHub?: string;
  targetOrg?: string;
}

export interface CheckItem {
  name: string;
  status: 'ok' | 'blocked' | 'skipped';
  detail: string;
}

export interface OrgCheckReport {
  ready: boolean; // no blocked checks among those that ran
  checks: CheckItem[];
}

interface OrgListJson {
  result?: {
    devHubs?: { alias?: string; username?: string; connectedStatus?: string }[];
    nonScratchOrgs?: { alias?: string; username?: string; connectedStatus?: string }[];
  };
}

interface OrgDisplayJson {
  result?: { connectedStatus?: string; alias?: string; apiVersion?: string };
}

function ok(name: string, detail: string): CheckItem {
  return { name, status: 'ok', detail };
}
function blocked(name: string, detail: string): CheckItem {
  return { name, status: 'blocked', detail };
}
function skipped(name: string, detail: string): CheckItem {
  return { name, status: 'skipped', detail };
}

async function checkCli(run: ProcRunner): Promise<CheckItem> {
  const proc = await run('sf', ['--version']);
  const version =
    proc.stdout.match(/@salesforce\/cli\/([\d.]+)/)?.[1] ?? proc.stdout.trim().slice(0, 40);
  return proc.code === 0
    ? ok('cli', `Salesforce CLI present (${version || 'unknown version'})`)
    : blocked('cli', 'Salesforce CLI not found or not runnable');
}

async function checkAuth(run: ProcRunner, alias: string): Promise<CheckItem> {
  const proc = await run('sf', ['org', 'display', '--target-org', alias, '--json']);
  let json: OrgDisplayJson;
  try {
    json = JSON.parse(proc.stdout) as OrgDisplayJson;
  } catch {
    return blocked('auth', `could not read org display for ${alias}`);
  }
  const connected = json.result?.connectedStatus;
  return connected === 'Connected'
    ? ok('auth', `${alias} is connected`)
    : blocked('auth', `${alias} is not connected (${connected ?? 'unknown'})`);
}

async function checkDevHub(run: ProcRunner, devHub: string): Promise<CheckItem> {
  const proc = await run('sf', ['org', 'list', '--json']);
  let json: OrgListJson;
  try {
    json = JSON.parse(proc.stdout) as OrgListJson;
  } catch {
    return blocked('dev-hub', 'could not read org list');
  }
  const hub = (json.result?.devHubs ?? []).find(
    (org) => org.alias === devHub || org.username === devHub,
  );
  if (!hub) return blocked('dev-hub', `${devHub} is not an authenticated Dev Hub`);
  return hub.connectedStatus === 'Connected'
    ? ok('dev-hub', `${devHub} is a connected Dev Hub`)
    : blocked(
        'dev-hub',
        `${devHub} Dev Hub is not connected (${hub.connectedStatus ?? 'unknown'})`,
      );
}

// The harness deploys a generated project, not the repository root, so the template it materialises is
// what to check.
function checkProject(template: FileMap): CheckItem {
  if (template['sfdx-project.json'] === undefined) {
    return blocked('project', 'project template has no sfdx-project.json');
  }
  if (template['config/project-scratch-def.json'] === undefined) {
    return blocked('project', 'project template has no scratch definition');
  }
  return ok('project', 'project template has sfdx-project.json and a scratch definition');
}

function checkApi(template: FileMap, expected: string): CheckItem {
  const raw = template['sfdx-project.json'];
  if (raw === undefined) return skipped('api', 'no project template to read');
  let version: string | undefined;
  try {
    version = (JSON.parse(raw) as { sourceApiVersion?: string }).sourceApiVersion;
  } catch {
    return blocked('api', 'project template sfdx-project.json is not valid JSON');
  }
  return version === expected
    ? ok('api', `sourceApiVersion ${version} matches the pinned model`)
    : blocked('api', `sourceApiVersion ${version ?? 'unset'} does not match ${expected}`);
}

function checkStorage(canWriteResults: boolean): CheckItem {
  return canWriteResults
    ? ok('storage', 'results/ is writable')
    : blocked('storage', 'results/ is not writable');
}

// Run the read-only checks. Auth and Dev Hub are skipped when no alias is given, so the command still
// reports CLI, project, API and storage without an org.
export async function orgCheck(deps: OrgCheckDeps): Promise<OrgCheckReport> {
  const checks: CheckItem[] = [];
  checks.push(await checkCli(deps.run));
  checks.push(
    deps.targetOrg
      ? await checkAuth(deps.run, deps.targetOrg)
      : skipped('auth', 'no --target-org given'),
  );
  checks.push(
    deps.devHub
      ? await checkDevHub(deps.run, deps.devHub)
      : skipped('dev-hub', 'no --dev-hub given'),
  );
  checks.push(checkProject(deps.projectTemplate));
  checks.push(checkApi(deps.projectTemplate, deps.expectedApiVersion));
  checks.push(checkStorage(deps.canWriteResults));
  return { ready: checks.every((check) => check.status !== 'blocked'), checks };
}

export function orgCheckSummary(report: OrgCheckReport): string {
  const lines = report.checks.map((check) => `  [${check.status}] ${check.name}: ${check.detail}`);
  return `org:check ${report.ready ? 'READY' : 'BLOCKED'}\n${lines.join('\n')}`;
}
