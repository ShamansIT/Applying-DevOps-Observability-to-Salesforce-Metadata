// Scratch-org provisioner. Creates and deletes a disposable org through the injected runner, so runtime
// state never leaks between scenarios. Teardown never throws; a failed create is reported.

import { createScratchArgs, deleteScratchArgs } from './oracle.js';
import type { ProcOptions, ProcRunner } from './oracle.js';

export interface ProvisionResult {
  alias: string;
  ready: boolean;
  message: string;
}

export interface OrgProvisioner {
  create(alias: string): Promise<ProvisionResult>;
  remove(alias: string): Promise<void>;
}

interface OrgCreateJson {
  status?: number;
  name?: string;
  message?: string;
  result?: { username?: string; orgId?: string };
}

export interface ProvisionerConfig {
  devHub: string;
  definitionFile: string;
  cwd?: string; // sfdx project directory the scratch commands run in
  timeoutMs?: number;
}

export function cliProvisioner(run: ProcRunner, config: ProvisionerConfig): OrgProvisioner {
  const options: ProcOptions | undefined = config.cwd
    ? { cwd: config.cwd, timeoutMs: config.timeoutMs ?? 600_000 }
    : undefined;
  return {
    create: async (alias) => {
      const proc = await run(
        'sf',
        createScratchArgs(config.devHub, config.definitionFile, alias),
        options,
      );
      let json: OrgCreateJson;
      try {
        json = JSON.parse(proc.stdout) as OrgCreateJson;
      } catch {
        return { alias, ready: false, message: 'unparseable scratch-create output' };
      }
      const ready =
        proc.code === 0 && (json.status ?? 1) === 0 && json.result?.username !== undefined;
      return {
        alias,
        ready,
        message: ready
          ? `created ${json.result?.username ?? alias}`
          : (json.message ?? 'scratch create failed'),
      };
    },
    remove: async (alias) => {
      // Teardown must never throw: a leaked scratch org is a housekeeping note, not a run failure.
      try {
        await run('sf', deleteScratchArgs(alias), options);
      } catch {
        // swallowed on purpose
      }
    },
  };
}
