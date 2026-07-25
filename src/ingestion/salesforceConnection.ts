import { AuthInfo, Connection } from '@salesforce/core';
import type { ToolingRunner } from './toolingClient.js';

// Live read-only runner backed by @salesforce/core. Auth is whatever user's sf CLI already holds,
// so nothing is stored here. Thin adapter, exercised against real org rather than unit tests;
// every query still goes through ToolingClient guard.
export async function createToolingRunner(usernameOrAlias: string): Promise<ToolingRunner> {
  const authInfo = await AuthInfo.create({ username: usernameOrAlias });
  const connection = await Connection.create({ authInfo });

  return {
    async query(soql) {
      const result = await connection.tooling.query(soql);
      return {
        records: result.records,
        totalSize: result.totalSize,
        done: result.done,
      };
    },
    async describe(sobject) {
      const result = await connection.tooling.describe(sobject);
      return result;
    },
  };
}
