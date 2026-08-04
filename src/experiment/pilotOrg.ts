// Real-org pilot driver. Runs the nine candidates through the readiness lifecycle on one shared scratch
// org (metadata validation), checksumming each attempt as it completes. --resume continues only when
// commit, register and plan match, never overwriting a completed attempt. Needs Dev Hub - off the gate.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { PhaseModel, WeightModel } from '../core/index.js';
import { childProcRunner } from './childRunner.js';
import { experimentChecksums } from './storage.js';
import type { FileMap } from './mutation.js';
import { cliProvisioner } from './orgProvisioner.js';
import {
  attemptReusable,
  hasValidFingerprint,
  orderByPlan,
  parsePilotPlan,
  pilotEntries,
  planHash,
  resumeAllowed,
} from './pilot.js';
import type { RunFingerprint } from './pilot.js';
import { pilotSummary, pilotSummaryFiles } from './pilotSummary.js';
import { hrtimeClock } from './race.js';
import { readinessScenarioFiles, runReadinessScenario } from './readiness.js';
import type { ReadinessDeps, ReadinessRecord } from './readiness.js';
import { nodeWorkspace } from './workspace.js';

function atomicWrite(root: string, files: FileMap): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    const tmp = `${full}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, full);
  }
}

export function currentGitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export interface PilotOrgConfig {
  runId: string;
  devHub: string;
  planText: string;
  resume: boolean;
  gitCommit: string;
  model: PhaseModel;
  weights: WeightModel;
}

// Read one scenario directory into a file map, so its attempt can be checksum-verified for reuse.
function readScenarioDir(dir: string): FileMap {
  const files: FileMap = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) files[entry.name] = readFileSync(join(dir, entry.name), 'utf8');
  }
  return files;
}

export async function runPilotOrg(config: PilotOrgConfig): Promise<string> {
  const entries = pilotEntries();
  const plan = parsePilotPlan(config.planText);
  const ordered = orderByPlan(entries, plan);
  const root = join(process.cwd(), 'results', 'pilot', config.runId);
  const fingerprint: RunFingerprint = {
    gitCommit: config.gitCommit,
    registerHash: plan.registerHash,
    planHash: planHash(plan),
  };

  // Resume gate: an existing run must carry a valid fingerprint that matches commit, register and plan.
  const savedPath = join(root, 'run-fingerprint.json');
  if (config.resume) {
    if (existsSync(root)) {
      const savedText = existsSync(savedPath) ? readFileSync(savedPath, 'utf8') : undefined;
      if (!hasValidFingerprint(savedText)) {
        throw new Error(
          `pilot:org: ${root} exists without a valid run-fingerprint.json; cannot resume`,
        );
      }
      const gate = resumeAllowed(JSON.parse(savedText ?? '{}') as RunFingerprint, fingerprint);
      if (!gate.allowed) throw new Error(`pilot:org resume refused - ${gate.reason}`);
    }
  } else if (existsSync(root)) {
    throw new Error(`pilot:org: ${root} exists; pass --resume to continue it`);
  }
  atomicWrite(root, { 'run-fingerprint.json': `${JSON.stringify(fingerprint, null, 2)}\n` });

  const workspace = nodeWorkspace();
  const run = childProcRunner();
  const alias = `${config.runId}-org`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
  const first = ordered[0]?.candidate;
  if (!first) throw new Error('pilot:org: no scenarios');
  const sessionDir = workspace.create('pilot-session');
  workspace.write(sessionDir, first.cleanFiles);
  const provisioner = cliProvisioner(run, {
    devHub: config.devHub,
    definitionFile: 'config/project-scratch-def.json',
    cwd: sessionDir,
  });

  const records: ReadinessRecord[] = [];
  try {
    const provisioned = await provisioner.create(alias);
    if (!provisioned.ready)
      throw new Error(`pilot:org: scratch org not ready - ${provisioned.message}`);
    const deps: ReadinessDeps = {
      model: config.model,
      weights: config.weights,
      workspace,
      procRunner: run,
      provisioner,
      now: hrtimeClock,
      alias,
      prototypeReps: 3,
    };
    for (const entry of ordered) {
      const scenarioDir = join(root, entry.candidate.id);
      if (config.resume && existsSync(scenarioDir)) {
        const existing = readScenarioDir(scenarioDir);
        if (attemptReusable(existing).reusable) {
          records.push(JSON.parse(existing['record.json'] ?? '{}') as ReadinessRecord);
          continue;
        }
      }
      const record = await runReadinessScenario(entry.scenario, deps);
      records.push(record);
      // Write and checksum the attempt the moment it completes - strip the scenario prefix first, so the
      // checksums list the same paths that land on disk.
      const files = stripDir(
        readinessScenarioFiles(entry.scenario, record, null),
        entry.candidate.id,
      );
      files['checksums.sha256'] = experimentChecksums(files);
      atomicWrite(scenarioDir, files);
    }
  } finally {
    await provisioner.remove(alias);
    workspace.remove(sessionDir);
  }

  const summary = pilotSummary(config.runId, records);
  atomicWrite(root, pilotSummaryFiles(summary));
  return `pilot:org ${config.runId}: ${String(summary.completion.complete)}/${String(records.length)} complete, ${String(summary.exceptions.length)} exception(s), org ${summary.orgExecutionStatus}`;
}

// readinessScenarioFiles keys files under <scenarioId>/...; strip that prefix so atomicWrite lands them
// under the scenario directory.
function stripDir(files: FileMap, scenarioId: string): FileMap {
  const out: FileMap = {};
  for (const [path, content] of Object.entries(files)) {
    out[path.startsWith(`${scenarioId}/`) ? path.slice(scenarioId.length + 1) : path] = content;
  }
  return out;
}
