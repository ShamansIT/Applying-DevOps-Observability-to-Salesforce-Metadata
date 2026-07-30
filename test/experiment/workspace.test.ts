import { describe, expect, it } from 'vitest';
import {
  materialiseVerified,
  memoryWorkspace,
  nodeWorkspace,
} from '../../src/experiment/workspace.js';
import { projectChecksum } from '../../src/experiment/project.js';

const FILES = { 'a/b.txt': 'one', 'c.txt': 'two' };

describe('memoryWorkspace', () => {
  it('writes, reads back and round-trips a checksum', () => {
    const ws = memoryWorkspace();
    const material = materialiseVerified(ws, 'scn', FILES, projectChecksum(FILES));
    expect(material.checksum).toBe(projectChecksum(FILES));
    ws.remove(material.dir);
    expect(ws.read(material.dir)).toEqual({});
  });

  it('merges later writes rather than replacing the directory', () => {
    const ws = memoryWorkspace();
    const dir = ws.create('scn');
    ws.write(dir, { 'x.txt': '1' });
    ws.write(dir, { 'y.txt': '2' });
    expect(ws.read(dir)).toEqual({ 'x.txt': '1', 'y.txt': '2' });
  });

  it('refuses a project whose on-disk checksum does not match', () => {
    const ws = memoryWorkspace();
    expect(() => materialiseVerified(ws, 'scn', FILES, 'deadbeef')).toThrow(/does not match/);
  });
});

describe('nodeWorkspace', () => {
  it('materialises to a real temp directory and cleans up', () => {
    const ws = nodeWorkspace();
    const material = materialiseVerified(ws, 'scn', FILES, projectChecksum(FILES));
    expect(ws.read(material.dir)).toEqual(FILES);
    ws.remove(material.dir);
    expect(ws.read(material.dir)).toEqual({});
  });
});
