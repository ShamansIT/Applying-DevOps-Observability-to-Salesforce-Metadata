import { assertReadOnlySoql } from './readOnlyGuard.js';

// Records back from one Tooling API query.
export interface ToolingQueryResult {
  records: Record<string, unknown>[];
  totalSize: number;
  done: boolean;
}

// Minimal read-only surface client needs from connection. Injecting it keeps ToolingClient free
// of @salesforce/core, so tests run offline with fake runner. Live runner lives in
// salesforceConnection.ts.
export interface ToolingRunner {
  query(soql: string): Promise<ToolingQueryResult>;
  describe(sobject: string): Promise<Record<string, unknown>>;
}

// Read-only Tooling API client. Every query passes read-only guard before reaching runner, so DML
// or chained statement dies before any network call.
export class ToolingClient {
  constructor(private readonly runner: ToolingRunner) {}

  async query(soql: string): Promise<ToolingQueryResult> {
    assertReadOnlySoql(soql);
    const result = await this.runner.query(soql);
    return result;
  }

  async describe(sobject: string): Promise<Record<string, unknown>> {
    const result = await this.runner.describe(sobject);
    return result;
  }
}
