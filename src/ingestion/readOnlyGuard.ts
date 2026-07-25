// Read-only guard. Everything that talks to org goes through here: only SOQL SELECT queries and
// Tooling describe/list calls pass; DML or deploy is rejected before it goes out.

// Tooling calls we allow - all read-only.
export const READ_ONLY_OPERATIONS = ['query', 'describe', 'list'] as const;

export type ReadOnlyOperation = (typeof READ_ONLY_OPERATIONS)[number];

// Throw unless soql is one bare SELECT.
export function assertReadOnlySoql(soql: string): void {
  const trimmed = soql.trim();
  if (!/^select\s/i.test(trimmed)) {
    throw new Error('read-only guard: only SELECT queries are allowed');
  }
  if (trimmed.includes(';')) {
    throw new Error('read-only guard: chained statements (;) are not allowed');
  }
}

// Throw unless operation is one we allow.
export function assertReadOnlyOperation(operation: string): asserts operation is ReadOnlyOperation {
  if (!(READ_ONLY_OPERATIONS as readonly string[]).includes(operation)) {
    throw new Error(
      `read-only guard: operation '${operation}' is not allowed (only ${READ_ONLY_OPERATIONS.join(', ')})`,
    );
  }
}
