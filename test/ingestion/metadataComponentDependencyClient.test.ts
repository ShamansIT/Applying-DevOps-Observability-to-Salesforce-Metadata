import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_ROW_CAP,
  MetadataComponentDependencyClient,
} from '../../src/ingestion/index.js';
import type { ToolingQueryResult, ToolingRunner } from '../../src/ingestion/index.js';

function runnerReturning(result: ToolingQueryResult): ToolingRunner {
  return {
    query: () => Promise.resolve(result),
    describe: () => Promise.resolve({}),
  };
}

function row(name: string, ref: string): Record<string, unknown> {
  return {
    MetadataComponentName: name,
    MetadataComponentType: 'ApexTrigger',
    RefMetadataComponentName: ref,
    RefMetadataComponentType: 'ApexClass',
  };
}

describe('MetadataComponentDependencyClient', () => {
  it('maps rows to dependency records', async () => {
    const client = new MetadataComponentDependencyClient(
      runnerReturning({
        records: [row('AccountTrigger', 'AccountService')],
        totalSize: 1,
        done: true,
      }),
    );
    const { records, truncated } = await client.fetchAll();
    expect(records[0]).toEqual({
      componentName: 'AccountTrigger',
      componentType: 'ApexTrigger',
      refName: 'AccountService',
      refType: 'ApexClass',
    });
    expect(truncated).toBe(false);
  });

  it('marks truncated when query is not done', async () => {
    const client = new MetadataComponentDependencyClient(
      runnerReturning({ records: [row('A', 'B')], totalSize: 5000, done: false }),
    );
    const { truncated } = await client.fetchAll();
    expect(truncated).toBe(true);
  });

  it('marks truncated when result hits the row cap', async () => {
    const records = Array.from({ length: DEPENDENCY_ROW_CAP }, (_, i) => row(`C${String(i)}`, 'R'));
    const client = new MetadataComponentDependencyClient(
      runnerReturning({ records, totalSize: DEPENDENCY_ROW_CAP, done: true }),
    );
    const { truncated } = await client.fetchAll();
    expect(truncated).toBe(true);
  });

  it('rejects a non read-only query before it reaches the runner', async () => {
    let reached = false;
    const client = new MetadataComponentDependencyClient({
      query: () => {
        reached = true;
        return Promise.resolve({ records: [], totalSize: 0, done: true });
      },
      describe: () => Promise.resolve({}),
    });
    await expect(client.query('DELETE FROM MetadataComponentDependency')).rejects.toThrow();
    expect(reached).toBe(false);
  });
});
