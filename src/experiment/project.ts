// Project file-map helpers. A base topology and a materialised scenario are both a map of
// repository-relative POSIX path to file content. Checksum is content-addressed so a base can be
// verified before mutation and a materialised scenario after. Filesystem read and write are thin and
// injected where callers want determinism.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { FileMap } from './mutation.js';

// Content-addressed checksum over the whole project: order-independent, so it depends on content, not
// walk order or platform path separators.
export function projectChecksum(files: FileMap): string {
  const hash = createHash('sha256');
  for (const path of Object.keys(files).sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(files[path] ?? '');
    hash.update('\0');
  }
  return hash.digest('hex');
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

// Read a project directory into a file map with POSIX relative keys. Recursive, text files.
export function readProjectFiles(dir: string): FileMap {
  const files: FileMap = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files[toPosix(relative(dir, full))] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(dir);
  return files;
}

// Write a file map under a directory, creating parents. Overwrites; caller owns a clean target.
export function writeProjectFiles(files: FileMap, dir: string): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}
