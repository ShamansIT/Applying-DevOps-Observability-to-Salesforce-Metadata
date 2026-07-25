/**
 * Read-only guard. Every org call must go through here: only SOQL SELECT queries and
 * Tooling describe/list operations are allowed, and any DML or deploy is rejected before it issent.
 */

/** Tooling operations tool is allowed to perform - all read-only. */
export const READ_ONLY_OPERATIONS = ['query', 'describe', 'list'] as const;

export type ReadOnlyOperation = (typeof READ_ONLY_OPERATIONS)[number];

/** Throw unless `soql` is single, bare SELECT statement. */
export function assertReadOnlySoql(soql: string): void {
  const trimmed = soql.trim();
  if (!/^select\s/i.test(trimmed)) {
    throw new Error('read-only guard: only SELECT queries are allowed');
  }
  if (trimmed.includes(';')) {
    throw new Error('read-only guard: chained statements (;) are not allowed');
  }
}

/** Assert `operation` is one of the allowed read-only operations. */
export function assertReadOnlyOperation(operation: string): asserts operation is ReadOnlyOperation {
  if (!(READ_ONLY_OPERATIONS as readonly string[]).includes(operation)) {
    throw new Error(
      `read-only guard: operation '${operation}' is not allowed (only ${READ_ONLY_OPERATIONS.join(', ')})`,
    );
  }
}
