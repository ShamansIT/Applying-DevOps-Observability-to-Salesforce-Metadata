// Real-org readiness driver. Provisions a scratch org from a Dev Hub, runs the three readiness
// scenarios and writes results/readiness/<run-id>/ atomically. Runs only against a real Dev Hub, so it
// is off the offline gate; without one the provisioner fails and the run reports NOT_READY_FOR_PILOT.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PhaseModel, WeightModel } from '../core/index.js';
import { childProcRunner } from './childRunner.js';
import type { FileMap } from './mutation.js';
import { cliProvisioner } from './orgProvisioner.js';
import { hrtimeClock } from './race.js';
import { readinessScenarios, runReadiness } from './readiness.js';
import type { ReadinessReport } from './readiness.js';
import { nodeWorkspace, safeRemove } from './workspace.js';

// Atomic per-file writer: write a .tmp sibling then rename, so a crash never leaves a half-written file.
function atomicWriter(root: string): (files: FileMap) => void {
  return (files) => {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      const tmp = `${full}.tmp`;
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, full);
    }
  };
}

export interface ReadinessOrgConfig {
  devHub: string;
  runId: string;
  model: PhaseModel;
  weights: WeightModel;
}

export async function runReadinessOrg(config: ReadinessOrgConfig): Promise<ReadinessReport> {
  const workspace = nodeWorkspace();
  const run = childProcRunner();
  const alias = `${config.runId}-org`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);

  // Scratch provisioning needs an sfdx project directory; materialise the first clean base for it.
  const first = readinessScenarios()[0];
  if (!first) throw new Error('readiness: no scenarios');
  const sessionDir = workspace.create('readiness-session');
  workspace.write(sessionDir, first.cleanFiles);

  const provisioner = cliProvisioner(run, {
    devHub: config.devHub,
    definitionFile: 'config/project-scratch-def.json',
    cwd: sessionDir,
  });

  const write = atomicWriter(join(process.cwd(), 'results', 'readiness', config.runId));
  try {
    return await runReadiness(
      config.runId,
      {
        model: config.model,
        weights: config.weights,
        workspace,
        procRunner: run,
        provisioner,
        now: hrtimeClock,
        alias,
      },
      write,
    );
  } finally {
    // Hardened, non-masking session teardown - a permanent cleanup failure never overwrites the report.
    safeRemove(workspace, sessionDir);
  }
}
