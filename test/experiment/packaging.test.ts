import { describe, expect, it } from 'vitest';
import { buildArchive, validateBundle } from '../../src/experiment/packaging.js';
import { experimentChecksums } from '../../src/experiment/storage.js';
import type { FileMap } from '../../src/experiment/mutation.js';

function bundle(): FileMap {
  const files: FileMap = { 'manifest.json': '{"a":1}\n', 'summary/x.json': '{"b":2}\n' };
  files['checksums.sha256'] = experimentChecksums(files);
  return files;
}

describe('validateBundle', () => {
  it('accepts a well-formed bundle', () => {
    const result = validateBundle(bundle());
    expect(result.valid).toBe(true);
    expect(result.checkedFiles).toBe(2);
  });

  it('rejects a tampered file as a mismatch', () => {
    const files = bundle();
    files['manifest.json'] = '{"a":999}\n';
    const result = validateBundle(files);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toContain('manifest.json');
  });

  it('rejects an unlisted file', () => {
    const files = bundle();
    files['sneaky.json'] = 'not in checksums\n';
    const result = validateBundle(files);
    expect(result.valid).toBe(false);
    expect(result.unlisted).toContain('sneaky.json');
  });
});

describe('buildArchive', () => {
  it('is deterministic and reports its own sha256', () => {
    const files = bundle();
    const a = buildArchive('f', files);
    const b = buildArchive('f', files);
    expect(a.sha256).toBe(b.sha256);
    expect(a.name).toBe('f.bundle.json.gz');
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
