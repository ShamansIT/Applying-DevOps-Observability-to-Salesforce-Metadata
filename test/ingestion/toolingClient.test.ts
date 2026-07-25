import { describe, expect, it } from 'vitest';
import { ToolingClient } from '../../src/ingestion/index.js';
import type { ToolingQueryResult, ToolingRunner } from '../../src/ingestion/index.js';

function makeRunner() {
  const calls: string[] = [];
  const result: ToolingQueryResult = { records: [{ Id: '001' }], totalSize: 1, done: true };
  const runner: ToolingRunner = {
    query: (soql) => {
      calls.push(`query:${soql}`);
      return Promise.resolve(result);
    },
    describe: (sobject) => {
      calls.push(`describe:${sobject}`);
      return Promise.resolve({ name: sobject });
    },
  };
  return { runner, calls, result };
}

describe('ToolingClient', () => {
  it('passes SELECT queries through to runner', async () => {
    const { runner, calls, result } = makeRunner();
    const client = new ToolingClient(runner);
    await expect(client.query('SELECT Id FROM Account')).resolves.toEqual(result);
    expect(calls).toContain('query:SELECT Id FROM Account');
  });

  it('rejects DML before touching runner', async () => {
    const { runner, calls } = makeRunner();
    const client = new ToolingClient(runner);
    await expect(client.query('DELETE FROM Account')).rejects.toThrow(/only SELECT/i);
    expect(calls).toEqual([]);
  });

  it('rejects chained statements before touching runner', async () => {
    const { runner, calls } = makeRunner();
    const client = new ToolingClient(runner);
    await expect(client.query('SELECT Id FROM Account; DELETE FROM Account')).rejects.toThrow(
      /chained/i,
    );
    expect(calls).toEqual([]);
  });

  it('passes describe through to runner', async () => {
    const { runner } = makeRunner();
    const client = new ToolingClient(runner);
    await expect(client.describe('Account')).resolves.toEqual({ name: 'Account' });
  });
});
