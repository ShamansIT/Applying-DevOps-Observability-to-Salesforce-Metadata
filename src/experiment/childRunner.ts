// Real process runner for the Salesforce CLI. Invokes the binary with an argument array and resolves
// exit code, stdout and stderr rather than throwing - a failed deploy is an outcome, not an exception.

import { execFile } from 'node:child_process';
import type { ProcRunner } from './oracle.js';

export function childProcRunner(): ProcRunner {
  return (file, args, options) =>
    new Promise((resolve) => {
      const bin = process.platform === 'win32' && file === 'sf' ? 'sf.cmd' : file;
      execFile(
        bin,
        args,
        {
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          shell: false,
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
