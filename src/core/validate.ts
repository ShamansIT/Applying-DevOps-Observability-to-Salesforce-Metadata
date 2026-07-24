import type { ExecNode } from './types.js';

/**
 * Enforce `ExecNode` invariant from DESIGN 2.3: `excludeReason` is present exactly when
 * `state` is `excluded`. Throws on either mismatch - `excluded` node without reason, or
 * non-`excluded` node that carries one.
 *
 * Reason counts as present only when it is non-empty, non-whitespace string, so
 * `excluded` node cannot pass with blank reason.
 */
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
