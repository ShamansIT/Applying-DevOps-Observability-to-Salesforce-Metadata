import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import {
  canonicalGraph,
  readinessDecision,
  readinessScenarios,
  runReadiness,
} from '../../src/experiment/readiness.js';
import type { ReadinessScenario } from '../../src/experiment/readiness.js';
import { runPrototype } from '../../src/experiment/prototypeAdapter.js';
import { snapshotFromFiles } from '../../src/experiment/snapshotBuilder.js';
import { memoryWorkspace } from '../../src/experiment/workspace.js';
import type { FileMap } from '../../src/experiment/mutation.js';
import type { ProcResult } from '../../src/experiment/oracle.js';

const MODEL = loadPhaseModel();
const SCENARIOS = readinessScenarios();

function scenario(id: string): ReadinessScenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

function prototypeCategory(s: ReadinessScenario): string {
  return runPrototype(snapshotFromFiles(s.mutatedFiles), s.target, MODEL, {
    sourceResolver: (component) => component.source,
  }).outcome.predictionCategory;
}

describe('readiness scenarios - prototype side (real core, offline)', () => {
  it('R01 valid control raises no blocking or risk concern', () => {
    const category = prototypeCategory(scenario('R01'));
    expect(['blocking_finding', 'material_warning', 'unresolved']).not.toContain(category);
  });

  it('R02 direct static failure is flagged as a blocking finding', () => {
    expect(prototypeCategory(scenario('R02'))).toBe('blocking_finding');
  });

  it('R03 dynamic construct is reported as risk or unresolved, never a proven pass', () => {
    expect(['material_warning', 'unresolved']).toContain(prototypeCategory(scenario('R03')));
  });
});

describe('readiness scenarios - integrity', () => {
  it('mutations are real, not comment-only', () => {
    expect(
      scenario('R01').mutatedFiles['force-app/main/default/classes/R01_AccountHandler.cls'],
    ).toContain('sizeOf');
    expect(scenario('R02').manifest.changedFileHashes).toMatchObject({
      'force-app/main/default/classes/R02_AccountHandler.cls': 'deleted',
    });
    expect(
      scenario('R03').mutatedFiles['force-app/main/default/triggers/R03_AccountTrigger.trigger'],
    ).toContain('Database.query');
  });

  it('metadata xml stays well-formed after mutation', () => {
    for (const s of SCENARIOS) {
      for (const [path, content] of Object.entries(s.mutatedFiles)) {
        if (path.endsWith('.xml')) expect(content).toMatch(/^<\?xml/);
      }
    }
  });

  it('semantic determinism compares the full canonical graph', () => {
    const s = scenario('R02');
    const first = runPrototype(snapshotFromFiles(s.mutatedFiles), s.target, MODEL, {
      sourceResolver: (component) => component.source,
    });
    const second = runPrototype(snapshotFromFiles(s.mutatedFiles), s.target, MODEL, {
      sourceResolver: (component) => component.source,
    });
    expect(first.result && second.result).toBeTruthy();
    if (first.result && second.result) {
      expect(canonicalGraph(first.result)).toBe(canonicalGraph(second.result));
    }
  });
});

// Mock Salesforce: clean projects pass; R02 mutated fails for a missing dependency; others pass.
function mockRunner(): (
  file: string,
  args: string[],
  options?: { cwd: string },
) => Promise<ProcResult> {
  return (_file, _args, options) => {
    const cwd = options?.cwd ?? '';
    if (cwd.includes('R02-mutated')) {
      return Promise.resolve({
        code: 1,
        stdout: JSON.stringify({
          result: {
            success: false,
            details: {
              componentFailures: [
                {
                  fullName: 'R02_AccountTrigger',
                  problem: 'Dependent class not found: R02_AccountHandler',
                },
              ],
            },
          },
        }),
        stderr: '',
      });
    }
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ result: { success: true } }),
      stderr: '',
    });
  };
}

function clock(): () => bigint {
  let c = 0n;
  return () => {
    c += 1_000_000n;
    return c;
  };
}

describe('runReadiness - end to end with a mock org', () => {
  it('reports READY_FOR_PILOT when all three scenarios meet their criteria', async () => {
    const written: FileMap[] = [];
    const report = await runReadiness(
      'test-run',
      {
        model: MODEL,
        workspace: memoryWorkspace(),
        procRunner: mockRunner(),
        provisioner: {
          create: (alias) => Promise.resolve({ alias, ready: true, message: 'ok' }),
          remove: () => Promise.resolve(),
        },
        now: clock(),
        alias: 'readiness-org',
      },
      (files) => written.push(files),
    );
    expect(report.decision).toBe('READY_FOR_PILOT');
    expect(report.blockers).toEqual([]);
    expect(report.records.map((r) => r.scenarioId)).toEqual(['R01', 'R02', 'R03']);
    // Incremental storage: R01 and R02 files are written before the summary.
    const merged: FileMap = {};
    for (const files of written) Object.assign(merged, files);
    expect(merged['R01/attempt.json']).toBeDefined();
    expect(merged['R02/prototype-graph.json']).toBeDefined();
    expect(merged['readiness-summary.json']).toBeDefined();
    expect(merged['checksums.sha256']).toBeDefined();
  });

  it('reports NOT_READY_FOR_PILOT with a blocker when the org is not ready', async () => {
    const report = await runReadiness(
      'test-run',
      {
        model: MODEL,
        workspace: memoryWorkspace(),
        procRunner: mockRunner(),
        provisioner: {
          create: (alias) => Promise.resolve({ alias, ready: false, message: 'no dev hub' }),
          remove: () => Promise.resolve(),
        },
        now: clock(),
        alias: 'readiness-org',
      },
      () => {},
    );
    expect(report.decision).toBe('NOT_READY_FOR_PILOT');
    expect(report.blockers.join(' ')).toMatch(/no dev hub/);
  });

  it('decision names every failing criterion', () => {
    const decision = readinessDecision([]);
    expect(decision.decision).toBe('NOT_READY_FOR_PILOT');
    expect(decision.blockers).toEqual(['R01: not run', 'R02: not run', 'R03: not run']);
  });
});
