import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { FileMap } from '../../src/experiment/mutation.js';
import {
  projectChecksum,
  readProjectFiles,
  writeProjectFiles,
} from '../../src/experiment/project.js';

const FILES: FileMap = {
  'a/one.cls': 'class One {}',
  'b/two.trigger': 'trigger Two {}',
};

const temp = mkdtempSync(join(tmpdir(), 'exp-project-'));

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe('projectChecksum', () => {
  it('is order-independent over content', () => {
    const reordered: FileMap = {
      'b/two.trigger': FILES['b/two.trigger'] ?? '',
      'a/one.cls': FILES['a/one.cls'] ?? '',
    };
    expect(projectChecksum(reordered)).toBe(projectChecksum(FILES));
  });

  it('changes when content changes', () => {
    expect(projectChecksum({ ...FILES, 'a/one.cls': 'class One2 {}' })).not.toBe(
      projectChecksum(FILES),
    );
  });
});

describe('write then read round-trips', () => {
  it('recovers the same file map', () => {
    writeProjectFiles(FILES, temp);
    expect(readProjectFiles(temp)).toEqual(FILES);
  });
});
