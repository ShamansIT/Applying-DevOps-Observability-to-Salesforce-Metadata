// Real-deps driver for org:check: child-process runner plus a real writable-storage probe. Read-only,
// never creates a scratch org. Excluded from the coverage gate.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { childProcRunner } from './childRunner.js';
import { orgCheck, orgCheckSummary } from './orgCheck.js';
import { pilotCandidates } from './pilotCandidates.js';

// Whether results/ can be created and written to, probed by writing and removing a marker file.
function resultsWritable(): boolean {
  const dir = join(process.cwd(), 'results');
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.org-check-write-probe');
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function runOrgCheckCommand(devHub?: string, targetOrg?: string): Promise<string> {
  const template = pilotCandidates()[0]?.cleanFiles ?? {};
  const report = await orgCheck({
    run: childProcRunner(),
    projectTemplate: template,
    canWriteResults: resultsWritable(),
    expectedApiVersion: '67.0',
    ...(devHub ? { devHub } : {}),
    ...(targetOrg ? { targetOrg } : {}),
  });
  return orgCheckSummary(report);
}
