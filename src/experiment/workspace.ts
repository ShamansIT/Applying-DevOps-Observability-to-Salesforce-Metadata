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

// Real filesystem workspace under the OS temp root. Used by the live org commands.
export function nodeWorkspace(root = tmpdir()): Workspace {
  return {
    create: (label) => mkdtempSync(join(root, `${sanitise(label)}-`)),
    write: (dir, files) => {
      writeProjectFiles(files, dir);
    },
    read: (dir) => (existsSync(dir) ? readProjectFiles(dir) : {}),
    remove: (dir) => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
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
    workspace.remove(dir);
    throw new Error(
      `materialise ${label}: on-disk checksum ${checksum} does not match expected ${expectedChecksum}`,
    );
  }
  return { dir, checksum };
}
