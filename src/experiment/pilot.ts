// Formal pilot plan. Runs the nine candidate scenarios (not the generated benchmark, not R01-R03), frozen
// to metadata-validation only; carries the candidate-register hash so a run cannot drift. Pure.

import { createHash } from 'node:crypto';
import { hashGroundTruth } from '../evaluation/groundTruth.js';
import type { OracleStage } from './mutation.js';
import { pilotCandidates } from './pilotCandidates.js';
import type { Candidate } from './reconstructionEval.js';
import type { ReadinessManifest, ReadinessScenario } from './readiness.js';
import { assertUniqueScenarios, blockedSchedule } from './schedule.js';
import type { ScheduleItem } from './schedule.js';

export const PILOT_PLAN_VERSION = '1.0.0';

export interface PilotEntry {
  candidate: Candidate;
  scenario: ReadinessScenario; // execution shape reused by the readiness lifecycle
  oracleStage: OracleStage;
  cleanHash: string;
  mutatedHash: string;
  fingerprint: string;
  groundTruthHash: string;
}

// Every candidate is observable at metadata validation: static failures fail the dry-run deploy, valid
// and risk variants pass it, and the risk concern is raised statically by the prototype. Test-execution
// and runtime-transaction stages are deferred (see EXPERIMENT.md).
function oracleStageFor(): OracleStage {
  return 'metadata_validation';
}

function toReadinessScenario(candidate: Candidate): ReadinessScenario {
  const manifest: ReadinessManifest = {
    scenarioId: candidate.id,
    operation: candidate.mutationManifest.operation,
    changedFiles: candidate.mutationManifest.changedFiles,
    changedFileHashes: candidate.mutationManifest.changedFileHashes,
    expectedValidity:
      candidate.designExpectation.validationOutcome === 'fail' ? 'invalid' : 'valid',
    expectedFailureClass: candidate.designExpectation.failureClass,
    detectability: candidate.designExpectation.detectability,
    affectedComponents: [],
  };
  return {
    id: candidate.id,
    title: `${candidate.cluster} ${candidate.variant}`,
    target: candidate.target,
    cleanFiles: candidate.cleanFiles,
    mutatedFiles: candidate.mutatedFiles,
    manifest,
    expectation: {
      cleanValidation: 'pass',
      mutatedValidation: candidate.designExpectation.validationOutcome,
      failureClass: candidate.designExpectation.failureClass,
      prototype: candidate.expectedPrototypeCategory,
    },
  };
}

function toEntry(candidate: Candidate): PilotEntry {
  return {
    candidate,
    scenario: toReadinessScenario(candidate),
    oracleStage: oracleStageFor(),
    cleanHash: candidate.cleanHash,
    mutatedHash: candidate.mutatedHash,
    fingerprint: candidate.fingerprint,
    groundTruthHash: hashGroundTruth(candidate.groundTruth),
  };
}

// Every candidate as a pilot entry. R01-R03 are not candidates, so they are excluded by construction.
export function pilotEntries(): PilotEntry[] {
  return pilotCandidates().map(toEntry);
}

// The active pilot plan: metadata-validation scenarios only. A test-only or runtime-only entry is
// rejected here, not silently run against an oracle stage that does not exist.
export function activePilot(entries: PilotEntry[]): PilotEntry[] {
  return entries.filter((entry) => entry.oracleStage === 'metadata_validation');
}

// Hash over the reviewed candidate register - id, hashes, fingerprint and ground-truth hash of each
// scenario. Stored in the freeze manifest so a run cannot drift from the reviewed scenarios.
export function candidateRegisterHash(entries: PilotEntry[]): string {
  const plan = entries
    .map(
      (entry) =>
        `${entry.candidate.id}|${entry.cleanHash}|${entry.mutatedHash}|${entry.fingerprint}|${entry.groundTruthHash}`,
    )
    .sort()
    .join('\n');
  return createHash('sha256').update(plan).digest('hex');
}

export interface PilotPlan {
  version: string;
  runId: string;
  seed: number;
  stage: 'metadata_validation';
  registerHash: string;
  scenarioIds: string[];
  items: ScheduleItem[];
}

// Freeze the active pilot plan: assert uniqueness, blocked-randomise the order under the seed, and stamp
// the register hash.
export function buildPilotPlan(entries: PilotEntry[], runId: string, seed: number): PilotPlan {
  const active = activePilot(entries);
  assertUniqueScenarios(
    active.map((entry) => ({
      mutationId: entry.candidate.id,
      changedFileHashes: entry.candidate.mutationManifest.changedFileHashes,
    })),
  );
  const items = blockedSchedule(
    active.map((entry) => ({
      id: entry.candidate.id,
      cluster: entry.candidate.cluster,
      complexity: 'low',
      expectedValidity:
        entry.candidate.designExpectation.validationOutcome === 'fail' ? 'invalid' : 'valid',
    })),
    seed,
  );
  return {
    version: PILOT_PLAN_VERSION,
    runId,
    seed,
    stage: 'metadata_validation',
    registerHash: candidateRegisterHash(active),
    scenarioIds: active.map((entry) => entry.candidate.id).sort(),
    items,
  };
}

export function serialisePilotPlan(plan: PilotPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function parsePilotPlan(text: string): PilotPlan {
  const plan = JSON.parse(text) as PilotPlan;
  if (plan.version !== PILOT_PLAN_VERSION) {
    throw new Error(`pilot plan: version ${plan.version} is not supported (${PILOT_PLAN_VERSION})`);
  }
  return plan;
}

// Fingerprint that must be stable for a resume to be safe.
export interface RunFingerprint {
  gitCommit: string;
  registerHash: string;
  planHash: string;
}

export function planHash(plan: PilotPlan): string {
  const body = `${plan.seed}|${plan.registerHash}|${plan.items
    .map((item) => `${String(item.order)}:${item.scenarioId}`)
    .join(',')}`;
  return createHash('sha256').update(body).digest('hex');
}

// A resume is safe only when the commit, candidate register and frozen plan all match. A completed valid
// attempt is never overwritten; a drift in any hash refuses the resume rather than mixing runs.
export function resumeAllowed(
  saved: RunFingerprint,
  current: RunFingerprint,
): { allowed: boolean; reason: string } {
  if (saved.gitCommit !== current.gitCommit) {
    return { allowed: false, reason: 'commit differs from the saved run' };
  }
  if (saved.registerHash !== current.registerHash) {
    return { allowed: false, reason: 'candidate register differs from the saved run' };
  }
  if (saved.planHash !== current.planHash) {
    return { allowed: false, reason: 'execution plan differs from the saved run' };
  }
  return { allowed: true, reason: 'commit, register and plan match' };
}

export function orderByPlan(entries: PilotEntry[], plan: PilotPlan): PilotEntry[] {
  const active = activePilot(entries);
  if (candidateRegisterHash(active) !== plan.registerHash) {
    throw new Error('pilot plan: candidate-register hash does not match the frozen plan');
  }
  const byId = new Map(active.map((entry) => [entry.candidate.id, entry]));
  return [...plan.items]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const entry = byId.get(item.scenarioId);
      if (!entry) throw new Error(`pilot plan: unknown scenario ${item.scenarioId}`);
      return entry;
    });
}
