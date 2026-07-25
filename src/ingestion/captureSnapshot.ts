import { writeFileSync } from 'node:fs';
import { readDxProject } from './dxProjectReader.js';
import type { MetadataComponent, OrgSnapshot, SnapshotSource } from './orgSnapshot.js';

// Inputs capture step needs but cannot derive deterministically. capturedAt is injected, not read
// from clock, so captured snapshot is reproducible in tests and diffs.
export interface CaptureOptions {
  source: SnapshotSource;
  capturedAt: string;
  toolVersion: string;
  apiVersion?: string | null;
  orgAlias?: string;
}

// Merge components, dedupe by (type, fullName), sort, and stamp meta into one snapshot.
export function buildSnapshot(
  components: MetadataComponent[],
  options: CaptureOptions,
): OrgSnapshot {
  const byKey = new Map<string, MetadataComponent>();
  for (const component of components) {
    const key = `${component.type}:${component.fullName}`;
    if (!byKey.has(key)) {
      byKey.set(key, component);
    }
  }
  const unique = [...byKey.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.fullName.localeCompare(b.fullName),
  );

  return {
    meta: {
      apiVersion: options.apiVersion ?? null,
      capturedAt: options.capturedAt,
      source: options.source,
      ...(options.orgAlias ? { orgAlias: options.orgAlias } : {}),
      toolVersion: options.toolVersion,
    },
    components: unique,
  };
}

// Capture snapshot from local DX project - fully offline.
export function captureFromDxProject(
  projectDir: string,
  options: Omit<CaptureOptions, 'source' | 'apiVersion'>,
): OrgSnapshot {
  const { apiVersion, components } = readDxProject(projectDir);
  return buildSnapshot(components, { ...options, source: 'dx-project', apiVersion });
}

// Persist snapshot as deterministic JSON fixture for offline re-runs.
export function writeSnapshot(snapshot: OrgSnapshot, path: string): void {
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}
