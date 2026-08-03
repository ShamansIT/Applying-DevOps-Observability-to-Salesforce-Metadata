// Bundle validation and archiving. Verifies files against checksums.sha256, refuses to archive an invalid
// or tampered bundle, builds a deterministic gzip archive with its own sha256. Pure - fs walk in caller.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { FileMap } from './mutation.js';

const CHECKSUM_FILE = 'checksums.sha256';

export interface BundleValidation {
  checkedFiles: number;
  mismatches: string[]; // listed files whose content no longer matches
  unlisted: string[]; // files present but not covered by checksums.sha256
  valid: boolean;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// Parse a "sha256␠␠path" checksum manifest into a map.
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) map.set(match[2], match[1]);
  }
  return map;
}

// Validate a bundle: every checksummed file must still match, and no non-artefact file may be unlisted.
export function validateBundle(files: FileMap): BundleValidation {
  const expected = parseChecksums(files[CHECKSUM_FILE] ?? '');
  const mismatches: string[] = [];
  for (const [path, hash] of expected) {
    if (sha256(files[path] ?? '') !== hash) mismatches.push(path);
  }
  const unlisted = Object.keys(files)
    .filter((path) => path !== CHECKSUM_FILE && !expected.has(path))
    .sort();
  return {
    checkedFiles: expected.size,
    mismatches: mismatches.sort(),
    unlisted,
    valid: mismatches.length === 0 && unlisted.length === 0,
  };
}

export interface Archive {
  name: string;
  bytes: Buffer;
  sha256: string;
}

// Deterministic gzip archive of the bundle: gzipped JSON of every file, so it re-archives identically and
// needs no external tar. The SHA-256 is over the archive bytes.
export function buildArchive(freezeId: string, files: FileMap): Archive {
  const ordered: FileMap = {};
  for (const path of Object.keys(files).sort()) ordered[path] = files[path] ?? '';
  const payload = Buffer.from(`${JSON.stringify({ freezeId, files: ordered })}\n`, 'utf8');
  const bytes = gzipSync(payload, { level: 9 });
  return {
    name: `${freezeId}.bundle.json.gz`,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function packageManifest(freezeId: string, files: FileMap, archive: Archive): string {
  return `${JSON.stringify(
    {
      freezeId,
      fileCount: Object.keys(files).length,
      archive: archive.name,
      archiveSha256: archive.sha256,
    },
    null,
    2,
  )}\n`;
}
