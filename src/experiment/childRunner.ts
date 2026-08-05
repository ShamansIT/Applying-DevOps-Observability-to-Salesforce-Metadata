// Real process runner for the Salesforce CLI. Invokes the binary with an argument array and resolves
// exit code, stdout and stderr rather than throwing - a failed deploy is an outcome, not an exception.

import { execFile } from 'node:child_process';
import type { ProcRunner } from './oracle.js';

export function childProcRunner(): ProcRunner {
  return (file, args, options) =>
    new Promise((resolve) => {
      // On Windows the Salesforce CLI is a .cmd shim, which recent Node refuses to spawn without a shell
      // (EINVAL). Run through the shell there. This trips DEP0190 (shell + args array), but the args are a
      // fixed internal allowlist ('sf', deploy/org subcommands, flags) with no spaces or user-controlled
      // shell metacharacters - paths travel via cwd - so there is no injection surface. Reworking this is
      // outside the cleanup fix and would need its own Windows child-spawn validation, so it stays as is.
      const onWindows = process.platform === 'win32';
      execFile(
        file,
        args,
        {
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          shell: onWindows,
          ...(options?.cwd ? { cwd: options.cwd } : {}),
          ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
          ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
        },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: unknown }).code === 'number'
              ? (error as { code: number }).code
              : error
                ? 1
                : 0;
          resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
        },
      );
    });
}
