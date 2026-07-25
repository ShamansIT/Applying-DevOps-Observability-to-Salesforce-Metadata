import type { ExecNode } from './types.js';

// excludeReason and state must agree: reason set iff excluded. Throws on either mismatch - excluded
// node without reason, or non-excluded node carrying one. Blank or whitespace reason counts as
// missing, so excluded node cannot slip through empty.
export function assertValidExecNode(node: ExecNode): void {
  const hasReason = typeof node.excludeReason === 'string' && node.excludeReason.trim().length > 0;
  const isExcluded = node.state === 'excluded';

  if (isExcluded && !hasReason) {
    throw new Error(
      `ExecNode ${node.id}: state is 'excluded' but excludeReason is missing or empty`,
    );
  }
  if (!isExcluded && hasReason) {
    throw new Error(
      `ExecNode ${node.id}: excludeReason is set but state is '${node.state}', not 'excluded'`,
    );
  }
}
