import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  captureFromDxProject,
  loadSnapshot,
  writeSnapshot,
} from '../../src/ingestion/index.js';
import type { MetadataComponent } from '../../src/ingestion/index.js';

const PROJECT = fileURLToPath(new URL('../fixtures/dx-project', import.meta.url));
const OPTS = { capturedAt: '2026-01-01T00:00:00.000Z', toolVersion: '0.0.1' };

describe('captureFromDxProject', () => {
  it('builds dx-project snapshot with injected, stamped meta', () => {
    const snapshot = captureFromDxProject(PROJECT, OPTS);
    expect(snapshot.meta.source).toBe('dx-project');
    expect(snapshot.meta.capturedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.meta.apiVersion).toBe('67.0');
    expect(snapshot.components.length).toBeGreaterThan(0);
  });

  it('is deterministic: two captures are deep-equal', () => {
    expect(captureFromDxProject(PROJECT, OPTS)).toEqual(captureFromDxProject(PROJECT, OPTS));
  });
});

describe('buildSnapshot', () => {
  it('dedupes components by type and fullName', () => {
    const component: MetadataComponent = { type: 'ApexTrigger', fullName: 'X', attributes: {} };
    const snapshot = buildSnapshot([component, { ...component }], {
      source: 'fixture',
      capturedAt: OPTS.capturedAt,
      toolVersion: OPTS.toolVersion,
    });
    expect(snapshot.components).toHaveLength(1);
  });
});

describe('writeSnapshot', () => {
  it('writes snapshot that loadSnapshot reads back equal (round-trip)', () => {
    const snapshot = captureFromDxProject(PROJECT, OPTS);
    const path = join(tmpdir(), `execflow-snapshot-${String(process.pid)}.json`);
    writeSnapshot(snapshot, path);
    try {
      expect(loadSnapshot(path)).toEqual(snapshot);
    } finally {
      unlinkSync(path);
    }
  });
});
