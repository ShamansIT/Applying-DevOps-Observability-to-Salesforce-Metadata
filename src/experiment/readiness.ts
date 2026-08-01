// Real-org readiness scenarios and lifecycle. Three engineering scenarios verify the end-to-end
// workflow against a real scratch org: R01 valid control, R02 direct static failure, R03 risk or
// unresolved. Each is a real deployable Apex project with a controlled mutation. The lifecycle is
// injectable - workspace, process runner, provisioner, clock and writer - so it is mock-tested offline
// and driven against a real Dev Hub by readinessOrg.ts. No ground truth ever reaches the prototype.

import { createHash } from 'node:crypto';
import type { AnalysisTarget, PhaseModel, ReconstructResult, WeightModel } from '../core/index.js';
import type { FailureClass, FileMap, MutationDetectability } from './mutation.js';
import { runPrototype } from './prototypeAdapter.js';
import type { PredictionCategory, PrototypeOutcome } from './prototypeAdapter.js';
import { runValidationPolled } from './oracle.js';
import type { PollingEvent, ProcRunner, ValidationResult } from './oracle.js';
import type { OrgProvisioner } from './orgProvisioner.js';
import { snapshotFromFiles } from './snapshotBuilder.js';
import { projectChecksum } from './project.js';
import { materialiseVerified } from './workspace.js';
import type { Workspace } from './workspace.js';
import { capturingRunner } from './rawStorage.js';
import type { CliCall } from './rawStorage.js';
import type { NanoClock } from './race.js';
import { experimentChecksums, redact } from './storage.js';

export type ReadinessId = 'R01' | 'R02' | 'R03';

// What the prototype is expected to do on the mutated project. Deliberately coarse - readiness checks
// honest handling, not exact category.
export type PrototypeExpectation = 'no_concern' | 'blocking' | 'risk_or_unresolved';

export interface ReadinessManifest {
  scenarioId: ReadinessId;
  operation: string;
  changedFiles: string[];
  changedFileHashes: Record<string, string>; // sha256 of new content, or 'deleted'
  expectedValidity: 'valid' | 'invalid';
  expectedFailureClass: FailureClass;
  detectability: MutationDetectability;
  affectedComponents: string[];
}

export interface ReadinessExpectation {
  cleanValidation: 'pass';
  mutatedValidation: 'pass' | 'fail';
  failureClass: FailureClass;
  prototype: PrototypeExpectation;
}

export interface ReadinessScenario {
  id: ReadinessId;
  title: string;
  target: AnalysisTarget;
  cleanFiles: FileMap;
  mutatedFiles: FileMap;
  manifest: ReadinessManifest;
  expectation: ReadinessExpectation;
}

// --- Metadata builders (deployable sfdx layout, same format the snapshot builder parses) ---

const PROJECT_FILES: FileMap = {
  'sfdx-project.json': `${JSON.stringify(
    { packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' },
    null,
    2,
  )}\n`,
  'config/project-scratch-def.json': `${JSON.stringify(
    { orgName: 'readiness', edition: 'Developer', features: [], settings: {} },
    null,
    2,
  )}\n`,
};

function apexClass(name: string, obj: string, body: string): FileMap {
  return {
    [`force-app/main/default/classes/${name}.cls`]: `public with sharing class ${name} {\n  public static void run(List<${obj}> records) {\n${body}\n  }\n}\n`,
    [`force-app/main/default/classes/${name}.cls-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n</ApexClass>\n`,
  };
}

function apexTrigger(name: string, obj: string, events: string, body: string): FileMap {
  return {
    [`force-app/main/default/triggers/${name}.trigger`]: `trigger ${name} on ${obj} (${events}) {\n${body}\n}\n`,
    [`force-app/main/default/triggers/${name}.trigger-meta.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>67.0</apiVersion>\n  <status>Active</status>\n</ApexTrigger>\n`,
  };
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// Changed files and hashes between a clean and mutated project.
function diffManifest(
  scenarioId: ReadinessId,
  operation: string,
  clean: FileMap,
  mutated: FileMap,
  base: Omit<ReadinessManifest, 'scenarioId' | 'operation' | 'changedFiles' | 'changedFileHashes'>,
): ReadinessManifest {
  const paths = new Set([...Object.keys(clean), ...Object.keys(mutated)]);
  const changedFiles: string[] = [];
  const changedFileHashes: Record<string, string> = {};
  for (const path of [...paths].sort()) {
    if (clean[path] !== mutated[path]) {
      changedFiles.push(path);
      const content = mutated[path];
      changedFileHashes[path] = content === undefined ? 'deleted' : sha256(content);
    }
  }
  return { scenarioId, operation, changedFiles, changedFileHashes, ...base };
}

const EVENTS = 'before update';
const TARGET: AnalysisTarget = { object: 'Account', event: 'update' };

// R01 - valid control. Clean trigger invokes a handler; the mutation adds a second valid method to the
// handler (real code, not a comment). Stays valid; the prototype has no concern.
function scenarioR01(): ReadinessScenario {
  const handlerBody = '    System.debug(records.size());';
  const clean: FileMap = {
    ...PROJECT_FILES,
    ...apexClass('R01_AccountHandler', 'Account', handlerBody),
    ...apexTrigger(
      'R01_AccountTrigger',
      'Account',
      EVENTS,
      '    R01_AccountHandler.run(Trigger.new);',
    ),
  };
  const mutatedHandler = `public with sharing class R01_AccountHandler {\n  public static void run(List<Account> records) {\n${handlerBody}\n  }\n  public static Integer sizeOf(List<Account> records) {\n    return records.size();\n  }\n}\n`;
  const mutated: FileMap = {
    ...clean,
    'force-app/main/default/classes/R01_AccountHandler.cls': mutatedHandler,
  };
  return {
    id: 'R01',
    title: 'valid control - a real valid change stays valid',
    target: TARGET,
    cleanFiles: clean,
    mutatedFiles: mutated,
    manifest: diffManifest('R01', 'add a valid method to the handler class', clean, mutated, {
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'out-of-scope',
      affectedComponents: ['R01_AccountHandler'],
    }),
    expectation: {
      cleanValidation: 'pass',
      mutatedValidation: 'pass',
      failureClass: 'none',
      prototype: 'no_concern',
    },
  };
}

// R02 - direct static failure. A trigger directly references a handler; the mutation removes the
// handler. Salesforce fails to compile the trigger; the prototype flags the missing dependency.
function scenarioR02(): ReadinessScenario {
  const clean: FileMap = {
    ...PROJECT_FILES,
    ...apexClass('R02_AccountHandler', 'Account', '    System.debug(records.size());'),
    ...apexTrigger(
      'R02_AccountTrigger',
      'Account',
      EVENTS,
      '    R02_AccountHandler.run(Trigger.new);',
    ),
  };
  const mutated: FileMap = { ...clean };
  delete mutated['force-app/main/default/classes/R02_AccountHandler.cls'];
  delete mutated['force-app/main/default/classes/R02_AccountHandler.cls-meta.xml'];
  return {
    id: 'R02',
    title: 'direct static failure - a referenced handler is removed',
    target: TARGET,
    cleanFiles: clean,
    mutatedFiles: mutated,
    manifest: diffManifest('R02', 'remove the referenced handler component', clean, mutated, {
      expectedValidity: 'invalid',
      expectedFailureClass: 'missing_dependency',
      detectability: 'static-direct',
      affectedComponents: ['R02_AccountHandler', 'R02_AccountTrigger'],
    }),
    expectation: {
      cleanValidation: 'pass',
      mutatedValidation: 'fail',
      failureClass: 'missing_dependency',
      prototype: 'blocking',
    },
  };
}

// R03 - risk or unresolved. A valid project gains a dynamic SOQL construct static analysis cannot
// resolve. The project still deploys; the prototype reports unresolved (or a risk warning).
function scenarioR03(): ReadinessScenario {
  const clean: FileMap = {
    ...PROJECT_FILES,
    ...apexClass('R03_AccountHandler', 'Account', '    System.debug(records.size());'),
    ...apexTrigger(
      'R03_AccountTrigger',
      'Account',
      EVENTS,
      '    R03_AccountHandler.run(Trigger.new);',
    ),
  };
  const mutatedTriggerBody =
    "    String q = 'SELECT Id FROM Account';\n    List<SObject> rows = Database.query(q);\n    System.debug(rows.size());\n    R03_AccountHandler.run(Trigger.new);";
  const mutated: FileMap = {
    ...clean,
    'force-app/main/default/triggers/R03_AccountTrigger.trigger': `trigger R03_AccountTrigger on Account (${EVENTS}) {\n${mutatedTriggerBody}\n}\n`,
  };
  return {
    id: 'R03',
    title: 'risk or unresolved - a dynamic construct static analysis cannot resolve',
    target: TARGET,
    cleanFiles: clean,
    mutatedFiles: mutated,
    manifest: diffManifest('R03', 'add a dynamic SOQL query to the trigger', clean, mutated, {
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'runtime-only',
      affectedComponents: ['R03_AccountTrigger'],
    }),
    expectation: {
      cleanValidation: 'pass',
      mutatedValidation: 'pass',
      failureClass: 'none',
      prototype: 'risk_or_unresolved',
    },
  };
}

export function readinessScenarios(): ReadinessScenario[] {
  return [scenarioR01(), scenarioR02(), scenarioR03()];
}

// --- Prototype canonicalisation and expectation matching ---

// Full canonical graph: sorted nodes, edges and risk indicators. Semantic determinism compares this
// string, not just the prediction category.
export function canonicalGraph(result: ReconstructResult): string {
  const nodes = result.nodes
    .map((node) => ({ id: node.id, state: node.state, phase: node.phase, type: node.type }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const edges = result.edges
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      relationship: edge.relationship ?? '',
      state: edge.state,
    }))
    .sort((a, b) => (`${a.from}|${a.to}` < `${b.from}|${b.to}` ? -1 : 1));
  const risk = result.risk
    .map((indicator) => ({ key: indicator.key, flagged: indicator.flagged }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  return JSON.stringify({ nodes, edges, risk });
}

const CONCERN: ReadonlySet<PredictionCategory> = new Set([
  'blocking_finding',
  'material_warning',
  'unresolved',
]);

// Did the prototype meet its readiness expectation? material_warning is a risk, never a blocking
// finding; unresolved is never counted as a blocking-error detection.
export function prototypeMeetsExpectation(
  expectation: PrototypeExpectation,
  prediction: PredictionCategory,
): boolean {
  if (expectation === 'no_concern') return !CONCERN.has(prediction);
  if (expectation === 'blocking') return prediction === 'blocking_finding';
  return prediction === 'material_warning' || prediction === 'unresolved';
}

// --- Lifecycle ---

export interface ReadinessDeps {
  model: PhaseModel;
  weights?: WeightModel;
  workspace: Workspace;
  procRunner: ProcRunner;
  provisioner: OrgProvisioner;
  now: NanoClock;
  alias: string; // shared scratch org alias
  timeoutMs?: number;
  scenarios?: ReadinessScenario[];
}

export type ReadinessStatus =
  'complete' | 'clean_invalid' | 'prototype_failed' | 'infrastructure_failed' | 'error';

export interface ReadinessTiming {
  prototypeTtfafMs: number;
  baselineTtfafMs: number;
  leadTimeMs: number;
  prototypeFirst: boolean;
}

export interface ReadinessRecord {
  scenarioId: ReadinessId;
  status: ReadinessStatus;
  cleanChecksum: string;
  mutatedChecksum: string;
  identicalBytes: boolean; // prototype and oracle analysed the same mutated hash
  cleanOutcome: ValidationResult['outcome'];
  mutatedOutcome: ValidationResult['outcome'];
  mutatedFailureClass: ValidationResult['failureClass'];
  prototype: PrototypeOutcome;
  prototypeDeterministic: boolean;
  cliCalls: CliCall[];
  pollingEvents: PollingEvent[]; // deploy report events when a validation was polled to a final result
  timing: ReadinessTiming;
  designExpectation: ReadinessExpectation;
  criteriaMet: boolean;
  reasons: string[]; // why criteriaMet is false, empty when met
}

export interface ReadinessReport {
  runId: string;
  decision: 'READY_FOR_PILOT' | 'NOT_READY_FOR_PILOT';
  blockers: string[];
  records: ReadinessRecord[];
}

function msBetween(from: bigint, to: bigint): number {
  return Math.round((Number(to - from) / 1e6) * 1000) / 1000;
}

function deployOptions(dir: string, timeoutMs: number): { cwd: string; timeoutMs: number } {
  return { cwd: dir, timeoutMs };
}

// Assess one completed scenario against its expectation. Returns the reasons any criterion failed.
function assess(
  scenario: ReadinessScenario,
  record: Omit<ReadinessRecord, 'criteriaMet' | 'reasons'>,
): string[] {
  const reasons: string[] = [];
  const expect = scenario.expectation;
  if (record.status !== 'complete') reasons.push(`status ${record.status}`);
  if (record.cleanOutcome !== 'pass')
    reasons.push(`clean validation ${record.cleanOutcome}, expected pass`);
  if (record.mutatedOutcome !== expect.mutatedValidation) {
    reasons.push(
      `mutated validation ${record.mutatedOutcome}, expected ${expect.mutatedValidation}`,
    );
  }
  if (
    expect.mutatedValidation === 'fail' &&
    record.mutatedFailureClass !== expect.failureClass &&
    record.mutatedFailureClass !== 'unknown'
  ) {
    reasons.push(`failure class ${record.mutatedFailureClass}, expected ${expect.failureClass}`);
  }
  if (!record.identicalBytes) reasons.push('prototype and oracle did not analyse identical bytes');
  if (!prototypeMeetsExpectation(expect.prototype, record.prototype.predictionCategory)) {
    reasons.push(`prototype ${record.prototype.predictionCategory}, expected ${expect.prototype}`);
  }
  if (record.timing.prototypeTtfafMs < 0 || record.timing.baselineTtfafMs < 0) {
    reasons.push('timing marks are not monotonic');
  }
  return reasons;
}

// Run one readiness scenario end to end. Clean is validated first; an invalid clean base aborts the
// scenario, since a mutated failure could not then be attributed to the mutation.
export async function runReadinessScenario(
  scenario: ReadinessScenario,
  deps: ReadinessDeps,
): Promise<ReadinessRecord> {
  const timeoutMs = deps.timeoutMs ?? 600_000;
  const captured = capturingRunner(deps.procRunner);
  const cleanChecksum = projectChecksum(scenario.cleanFiles);
  const mutatedChecksum = projectChecksum(scenario.mutatedFiles);

  const emptyTiming: ReadinessTiming = {
    prototypeTtfafMs: 0,
    baselineTtfafMs: 0,
    leadTimeMs: 0,
    prototypeFirst: false,
  };
  const failedPrototype: PrototypeOutcome = {
    predictionCategory: 'prototype_failure',
    actionableFinding: null,
    affectedComponents: [],
    stageEvents: [],
    failed: true,
  };

  // 1-2. Materialise and checksum-verify the clean project.
  const clean = materialiseVerified(
    deps.workspace,
    `${scenario.id}-clean`,
    scenario.cleanFiles,
    cleanChecksum,
  );
  try {
    // 4-5. Validate the clean project, polled to a final result; abort on an invalid base.
    const cleanPolled = await runValidationPolled(
      deps.alias,
      captured.run,
      deployOptions(clean.dir, timeoutMs),
    );
    if (cleanPolled.result.outcome !== 'pass') {
      const base = {
        scenarioId: scenario.id,
        status: 'clean_invalid' as ReadinessStatus,
        cleanChecksum,
        mutatedChecksum,
        identicalBytes: true,
        cleanOutcome: cleanPolled.result.outcome,
        mutatedOutcome: 'not_run' as ValidationResult['outcome'],
        mutatedFailureClass: 'unknown' as ValidationResult['failureClass'],
        prototype: failedPrototype,
        prototypeDeterministic: false,
        cliCalls: captured.calls,
        pollingEvents: cleanPolled.pollingEvents,
        timing: emptyTiming,
        designExpectation: scenario.expectation,
      };
      return { ...base, criteriaMet: false, reasons: assess(scenario, base) };
    }
  } finally {
    deps.workspace.remove(clean.dir);
  }

  // 6-7. Materialise and checksum-verify the mutated project.
  const mutated = materialiseVerified(
    deps.workspace,
    `${scenario.id}-mutated`,
    scenario.mutatedFiles,
    mutatedChecksum,
  );
  try {
    const snapshot = snapshotFromFiles(scenario.mutatedFiles);
    const options = {
      sourceResolver: (component: { source?: string }) => component.source,
      ...(deps.weights ? { weights: deps.weights } : {}),
    };

    // 8. One monotonic t0, then the prototype and Salesforce validation over the same mutated bytes.
    // The oracle is polled to a final result, so a queued deploy is not mistaken for an outcome.
    const t0 = deps.now();
    const oraclePromise = runValidationPolled(
      deps.alias,
      captured.run,
      deployOptions(mutated.dir, timeoutMs),
    );
    const prototype = runPrototype(snapshot, scenario.target, deps.model, options);
    const prototypeDoneNs = deps.now();
    const polled = await oraclePromise;
    const oracle = polled.result;
    const oracleDoneNs = deps.now();

    // Semantic determinism over the full canonical graph, not just the category.
    const second = runPrototype(snapshot, scenario.target, deps.model, options);
    const deterministic =
      prototype.result !== undefined &&
      second.result !== undefined &&
      canonicalGraph(prototype.result) === canonicalGraph(second.result);

    const prototypeTtfafMs = msBetween(t0, prototypeDoneNs);
    const baselineTtfafMs = msBetween(t0, oracleDoneNs);
    const timing: ReadinessTiming = {
      prototypeTtfafMs,
      baselineTtfafMs,
      leadTimeMs: Math.round((baselineTtfafMs - prototypeTtfafMs) * 1000) / 1000,
      prototypeFirst: prototypeTtfafMs <= baselineTtfafMs,
    };

    const status: ReadinessStatus = prototype.outcome.failed
      ? 'prototype_failed'
      : oracle.infrastructure !== 'ok'
        ? 'infrastructure_failed'
        : 'complete';

    const base = {
      scenarioId: scenario.id,
      status,
      cleanChecksum,
      mutatedChecksum,
      identicalBytes: mutated.checksum === mutatedChecksum,
      cleanOutcome: 'pass' as ValidationResult['outcome'],
      mutatedOutcome: oracle.outcome,
      mutatedFailureClass: oracle.failureClass,
      prototype: prototype.outcome,
      prototypeDeterministic: deterministic,
      cliCalls: captured.calls,
      pollingEvents: polled.pollingEvents,
      timing,
      designExpectation: scenario.expectation,
    };
    return {
      ...base,
      criteriaMet: assess(scenario, base).length === 0,
      reasons: assess(scenario, base),
    };
  } finally {
    deps.workspace.remove(mutated.dir);
  }
}

// The full prototype reconstruction for a scenario's mutated project, for raw storage.
export function readinessGraph(
  scenario: ReadinessScenario,
  deps: ReadinessDeps,
): ReconstructResult | null {
  const options = {
    sourceResolver: (component: { source?: string }) => component.source,
    ...(deps.weights ? { weights: deps.weights } : {}),
  };
  return (
    runPrototype(snapshotFromFiles(scenario.mutatedFiles), scenario.target, deps.model, options)
      .result ?? null
  );
}

// Reduce records to a readiness decision. READY only when every scenario met every criterion.
export function readinessDecision(records: ReadinessRecord[]): {
  decision: 'READY_FOR_PILOT' | 'NOT_READY_FOR_PILOT';
  blockers: string[];
} {
  const expectedIds: ReadinessId[] = ['R01', 'R02', 'R03'];
  const blockers: string[] = [];
  for (const id of expectedIds) {
    const record = records.find((r) => r.scenarioId === id);
    if (!record) {
      blockers.push(`${id}: not run`);
      continue;
    }
    for (const reason of record.reasons) blockers.push(`${id}: ${reason}`);
  }
  return {
    decision: blockers.length === 0 ? 'READY_FOR_PILOT' : 'NOT_READY_FOR_PILOT',
    blockers,
  };
}

// --- Serialisation and orchestration ---

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Files for one completed scenario, all redacted. Written the moment the scenario finishes, so an
// interruption in a later scenario cannot destroy an earlier one.
export function readinessScenarioFiles(
  scenario: ReadinessScenario,
  record: ReadinessRecord,
  graph: ReconstructResult | null,
): FileMap {
  const dir = record.scenarioId;
  const files: FileMap = {
    [`${dir}/scenario.json`]: redact(
      json({
        id: scenario.id,
        title: scenario.title,
        target: scenario.target,
        manifest: scenario.manifest,
        expectation: scenario.expectation,
        cleanChecksum: record.cleanChecksum,
        mutatedChecksum: record.mutatedChecksum,
      }),
    ),
    [`${dir}/attempt.json`]: redact(
      json({
        scenarioId: record.scenarioId,
        status: record.status,
        identicalBytes: record.identicalBytes,
        cleanOutcome: record.cleanOutcome,
        mutatedOutcome: record.mutatedOutcome,
        mutatedFailureClass: record.mutatedFailureClass,
        prototypePrediction: record.prototype.predictionCategory,
        prototypeDeterministic: record.prototypeDeterministic,
        timing: record.timing,
        criteriaMet: record.criteriaMet,
        reasons: record.reasons,
      }),
    ),
    [`${dir}/prototype.json`]: redact(json(record.prototype)),
    // Salesforce command, arguments, stdout, stderr and parsed JSON live in the captured CLI calls;
    // polling events record any deploy report follow-up when a validation was not final at once.
    [`${dir}/salesforce.json`]: redact(
      json({ pollingEvents: record.pollingEvents, calls: record.cliCalls }),
    ),
  };
  if (graph) files[`${dir}/prototype-graph.json`] = redact(`${canonicalGraph(graph)}\n`);
  return files;
}

function summaryMarkdown(report: ReadinessReport): string {
  const rows = report.records
    .map(
      (r) =>
        `| ${r.scenarioId} | ${r.status} | ${r.mutatedOutcome} | ${r.prototype.predictionCategory} | ${String(r.criteriaMet)} | ${r.reasons.join('; ') || '-'} |`,
    )
    .join('\n');
  return [
    `# Readiness ${report.runId}`,
    '',
    `Decision: **${report.decision}**`,
    '',
    report.blockers.length
      ? `Blockers:\n${report.blockers.map((b) => `- ${b}`).join('\n')}`
      : 'No blockers.',
    '',
    '| scenario | status | mutated | prototype | met | reasons |',
    '| --- | --- | --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

export function readinessSummaryFiles(report: ReadinessReport): FileMap {
  return {
    'readiness-summary.json': redact(
      json({
        runId: report.runId,
        decision: report.decision,
        blockers: report.blockers,
        scenarios: report.records.map((r) => ({
          id: r.scenarioId,
          status: r.status,
          mutatedOutcome: r.mutatedOutcome,
          prototype: r.prototype.predictionCategory,
          criteriaMet: r.criteriaMet,
          reasons: r.reasons,
        })),
      }),
    ),
    'readiness-summary.md': redact(summaryMarkdown(report)),
  };
}

export type ReadinessWriter = (files: FileMap) => void;

function errorRecord(scenario: ReadinessScenario, error: unknown): ReadinessRecord {
  const message = error instanceof Error ? error.message : String(error);
  return {
    scenarioId: scenario.id,
    status: 'error',
    cleanChecksum: projectChecksum(scenario.cleanFiles),
    mutatedChecksum: projectChecksum(scenario.mutatedFiles),
    identicalBytes: false,
    cleanOutcome: 'not_run',
    mutatedOutcome: 'not_run',
    mutatedFailureClass: 'unknown',
    prototype: {
      predictionCategory: 'prototype_failure',
      actionableFinding: null,
      affectedComponents: [],
      stageEvents: [],
      failed: true,
      error: message,
    },
    prototypeDeterministic: false,
    cliCalls: [],
    pollingEvents: [],
    timing: { prototypeTtfafMs: 0, baselineTtfafMs: 0, leadTimeMs: 0, prototypeFirst: false },
    designExpectation: scenario.expectation,
    criteriaMet: false,
    reasons: [`threw: ${message}`],
  };
}

// Run all readiness scenarios against one shared scratch org. Each scenario is written the moment it
// completes; a scenario that throws is recorded and the run continues. The shared org is always torn
// down. The writer persists files; the returned report and accumulated bundle mirror what was written.
export async function runReadiness(
  runId: string,
  deps: ReadinessDeps,
  write: ReadinessWriter,
): Promise<ReadinessReport> {
  const scenarios = deps.scenarios ?? readinessScenarios();
  const bundle: FileMap = {};
  const emit = (files: FileMap): void => {
    Object.assign(bundle, files);
    write(files);
  };

  const provision = await deps.provisioner.create(deps.alias);
  if (!provision.ready) {
    const report: ReadinessReport = {
      runId,
      decision: 'NOT_READY_FOR_PILOT',
      blockers: [`shared scratch org not ready: ${provision.message}`],
      records: [],
    };
    emit(readinessSummaryFiles(report));
    emit({ 'checksums.sha256': experimentChecksums(bundle) });
    return report;
  }

  const records: ReadinessRecord[] = [];
  try {
    for (const scenario of scenarios) {
      let record: ReadinessRecord;
      try {
        record = await runReadinessScenario(scenario, deps);
      } catch (error) {
        record = errorRecord(scenario, error);
      }
      records.push(record);
      let graph: ReconstructResult | null = null;
      try {
        graph = record.status === 'clean_invalid' ? null : readinessGraph(scenario, deps);
      } catch {
        graph = null;
      }
      emit(readinessScenarioFiles(scenario, record, graph));
    }
  } finally {
    await deps.provisioner.remove(deps.alias);
  }

  const { decision, blockers } = readinessDecision(records);
  const report: ReadinessReport = { runId, decision, blockers, records };
  emit(readinessSummaryFiles(report));
  emit({ 'checksums.sha256': experimentChecksums(bundle) });
  return report;
}
