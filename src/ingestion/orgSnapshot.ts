import { readFileSync } from 'node:fs';

// One captured metadata component - raw record ingestion pulled in.
export interface MetadataComponent {
  type: string; // Salesforce metadata type, e.g. Flow, ApexTrigger, ValidationRule
  fullName: string;
  object?: string; // target sObject, when component binds to one
  namespace?: string; // set for managed-package components
  attributes: Record<string, unknown>; // raw captured fields
}

// Where snapshot came from. Only alias is kept, never credentials.
export type SnapshotSource = 'org' | 'dx-project' | 'fixture';

// Snapshot metadata. Timestamps live here and nowhere else, so rest of run stays byte-identical
// across executions.
export interface SnapshotMeta {
  apiVersion: string | null; // pinned Salesforce API version, or null while provisional
  capturedAt: string;
  source: SnapshotSource;
  orgAlias?: string; // alias only, never credentials
  toolVersion: string;
}

// Captured org state, and unit of reproducibility. Analysis runs against one frozen snapshot, so
// same snapshot yields same graph offline.
export interface OrgSnapshot {
  meta: SnapshotMeta;
  components: MetadataComponent[];
}

// Read and validate snapshot from JSON file. No network.
export function loadSnapshot(path: string): OrgSnapshot {
  const snapshot = JSON.parse(readFileSync(path, 'utf8')) as OrgSnapshot;
  validateSnapshot(snapshot);
  return snapshot;
}

// Structural checks: meta block, plus array of typed and named components.
export function validateSnapshot(snapshot: OrgSnapshot): void {
  if (typeof snapshot.meta !== 'object' || snapshot.meta === null) {
    throw new Error('snapshot: missing meta block');
  }
  if (!Array.isArray(snapshot.components)) {
    throw new Error('snapshot: components must be array');
  }
  for (const [index, component] of snapshot.components.entries()) {
    if (!component.type || !component.fullName) {
      throw new Error(`snapshot: component ${String(index)} is missing type or fullName`);
    }
  }
}

// Components bound to given target object (case-insensitive).
export function componentsForObject(snapshot: OrgSnapshot, object: string): MetadataComponent[] {
  const target = object.toLowerCase();
  return snapshot.components.filter((component) => component.object?.toLowerCase() === target);
}
