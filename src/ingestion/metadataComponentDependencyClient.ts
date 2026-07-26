import type { MetadataDependencyRecord } from './orgSnapshot.js';
import { assertReadOnlySoql } from './readOnlyGuard.js';
import type { ToolingRunner } from './toolingClient.js';

// MetadataComponentDependency returns at most this many rows per query. On cap caller takes
// Bulk route; if still short, result is marked truncated and affected claims degrade to unresolved.
export const DEPENDENCY_ROW_CAP = 2000;

// Direct dependency records plus whether result was cut short by row cap.
export interface DependencyQueryResult {
  records: MetadataDependencyRecord[];
  truncated: boolean;
}

const BASE_QUERY =
  'SELECT MetadataComponentName, MetadataComponentType, ' +
  'RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency';

// Read-only client over MetadataComponentDependency. Direct records only - transitive links need
// expansion, not one query. Injectable runner keeps this free of @salesforce/core, so tests run
// offline. Every query passes read-only guard before reaching runner.
export class MetadataComponentDependencyClient {
  constructor(private readonly runner: ToolingRunner) {}

  // Fetch direct dependency records. Result carries truncation flag, since row cap can hide records.
  async fetchAll(): Promise<DependencyQueryResult> {
    return this.query(BASE_QUERY);
  }

  async query(soql: string): Promise<DependencyQueryResult> {
    assertReadOnlySoql(soql);
    const result = await this.runner.query(soql);
    const records = result.records.map(toRecord);
    const truncated = !result.done || records.length >= DEPENDENCY_ROW_CAP;
    return { records, truncated };
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Map one raw MetadataComponentDependency row to record shape.
function toRecord(row: Record<string, unknown>): MetadataDependencyRecord {
  return {
    componentName: asString(row['MetadataComponentName']),
    componentType: asString(row['MetadataComponentType']),
    refName: asString(row['RefMetadataComponentName']),
    refType: asString(row['RefMetadataComponentType']),
  };
}
