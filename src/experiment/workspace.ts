// Disk workspace for scenario materialisation. Writing the mutated file map to disk lets the CLI
// validate the same bytes the prototype analyses. Injectable - in-memory workspace for tests.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileMap } from './mutation.js';
import { projectChecksum, readProjectFiles, writeProjectFiles } from './project.js';

export interface Workspace {
  create(label: string): string; // fresh directory path
  write(dir: string, files: FileMap): void;
  read(dir: string): FileMap;
  remove(dir: string): void;
}

function sanitise(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'scn';
}

// Windows holds a directory handle briefly after a child process exits - the sf CLI, a file indexer or
// antivirus - so a first delete throws EPERM/EBUSY/ENOTEMPTY. These are the transient codes to retry.
const TRANSIENT_CLEANUP = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

export interface RetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => void; // injected for tests; default blocks without a busy loop
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Bounded retry over a transient teardown failure. Finite attempts and a finite delay - a directory that
// never frees raises the last error rather than looping. A non-transient error is raised at once.
export function removeWithRetry(
  remove: (dir: string) => void,
  dir: string,
  options: RetryOptions = {},
): void {
  const maxRetries = options.maxRetries ?? 10;
  const retryDelayMs = options.retryDelayMs ?? 100;
  const sleep = options.sleep ?? sleepSync;
  for (let attempt = 0; ; attempt += 1) {
    try {
      remove(dir);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= maxRetries || code === undefined || !TRANSIENT_CLEANUP.has(code)) throw error;
      sleep(retryDelayMs);
    }
  }
}

// Real filesystem workspace under the OS temp root. Used by the live org commands.
export function nodeWorkspace(root = tmpdir()): Workspace {
  return {
    create: (label) => mkdtempSync(join(root, `${sanitise(label)}-`)),
    write: (dir, files) => {
      writeProjectFiles(files, dir);
    },
    read: (dir) => (existsSync(dir) ? readProjectFiles(dir) : {}),
    remove: (dir) => {
      removeWithRetry((target) => {
        rmSync(target, { recursive: true, force: true });
      }, dir);
    },
  };
}

export interface CleanupResult {
  ok: boolean;
  error?: string;
}

// Remove a workspace without letting a teardown failure abort or reclassify the work already produced.
// The caller records the returned result; a permanent failure stays visible, never silently swallowed.
export function safeRemove(workspace: Workspace, dir: string): CleanupResult {
  try {
    workspace.remove(dir);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Merge several cleanup results into one - ok only when every removal succeeded, else the joined errors.
export function combineCleanup(results: CleanupResult[]): CleanupResult {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return { ok: true };
  return { ok: false, error: failed.map((r) => r.error ?? 'unknown').join('; ') };
}

// In-memory workspace: same contract, no filesystem. Deterministic directory ids, so the offline
// walking skeleton and unit tests exercise the materialise-verify path without touching disk.
export function memoryWorkspace(): Workspace {
  const store = new Map<string, FileMap>();
  let counter = 0;
  return {
    create: (label) => {
      const dir = `mem://${sanitise(label)}/${String(counter)}`;
      counter += 1;
      store.set(dir, {});
      return dir;
    },
    write: (dir, files) => {
      store.set(dir, { ...(store.get(dir) ?? {}), ...files });
    },
    read: (dir) => ({ ...(store.get(dir) ?? {}) }),
    remove: (dir) => {
      store.delete(dir);
    },
  };
}

export interface Materialised {
  dir: string;
  checksum: string;
}

// Write, read back and checksum-verify. Proves the on-disk project is byte-identical to the in-memory
// mutation, so the prototype (in memory) and the oracle (on disk) analyse the same scenario. On mismatch
// the directory is removed and the failure is raised, never silently continued.
export function materialiseVerified(
  workspace: Workspace,
  label: string,
  files: FileMap,
  expectedChecksum: string,
): Materialised {
  const dir = workspace.create(label);
  workspace.write(dir, files);
  const checksum = projectChecksum(workspace.read(dir));
  if (checksum !== expectedChecksum) {
    safeRemove(workspace, dir); // keep the mismatch error visible even if teardown fails
    throw new Error(
      `materialise ${label}: on-disk checksum ${checksum} does not match expected ${expectedChecksum}`,
    );
  }
  return { dir, checksum };
}
