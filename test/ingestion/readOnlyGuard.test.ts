import { describe, expect, it } from 'vitest';
import { assertReadOnlyOperation, assertReadOnlySoql } from '../../src/ingestion/index.js';

describe('assertReadOnlySoql', () => {
  it('accepts SELECT queries', () => {
    expect(() => {
      assertReadOnlySoql('SELECT Id FROM Account');
    }).not.toThrow();
    expect(() => {
      assertReadOnlySoql("  select Id, Name from Contact where Name = 'x'  ");
    }).not.toThrow();
  });

  it('rejects DML statements', () => {
    for (const query of [
      'DELETE FROM Account',
      'update Account set Name = null',
      'insert into Account',
      'upsert Account',
    ]) {
      expect(() => {
        assertReadOnlySoql(query);
      }).toThrow(/only SELECT/i);
    }
  });

  it('rejects chained statements', () => {
    expect(() => {
      assertReadOnlySoql('SELECT Id FROM Account; DELETE FROM Account');
    }).toThrow(/chained/i);
  });

  it('rejects empty query', () => {
    expect(() => {
      assertReadOnlySoql('   ');
    }).toThrow(/only SELECT/i);
  });
});

describe('assertReadOnlyOperation', () => {
  it('accepts read-only operations', () => {
    for (const operation of ['query', 'describe', 'list']) {
      expect(() => {
        assertReadOnlyOperation(operation);
      }).not.toThrow();
    }
  });

  it('rejects mutating or unknown operations', () => {
    for (const operation of ['deploy', 'create', 'update', 'delete', 'metadataUpdate', '']) {
      expect(() => {
        assertReadOnlyOperation(operation);
      }).toThrow(/not allowed/i);
    }
  });
});
