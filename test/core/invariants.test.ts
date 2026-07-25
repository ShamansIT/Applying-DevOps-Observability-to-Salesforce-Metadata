import { describe, expect, it } from 'vitest';
import { assertValidExecNode } from '../../src/core/index.js';
import type { ExecEdge, ExecNode } from '../../src/core/index.js';

/**
 * Representative, valid node. Individual tests spread over this and change one thing.
 */
const base: ExecNode = {
  id: 'apex_trigger:Account:AccountTrigger',
  apiName: 'AccountTrigger',
  label: 'AccountTrigger',
  type: 'apex_trigger',
  object: 'Account',
  phase: 'before_triggers',
  active: true,
  state: 'confirmed',
  score: 1,
  evidence: [],
};

describe('invariant 1: model cannot express intra-phase ordering', () => {
  // Real enforcement is at type level, checked by `tsc` (typecheck / CI). If any
  // ordering-ish key were added to ExecNode or ExecEdge, `NoForbiddenKeys<T>` would resolve to
  // `false` and `= true` assignments below would fail to compile. esbuild strips types, so at
  // Vitest runtime these just pass - runtime key check afterwards documents same intent.
  type ForbiddenOrderKey =
    | 'order'
    | 'ordering'
    | 'orderIndex'
    | 'phaseOrder'
    | 'intraPhaseOrder'
    | 'sequence'
    | 'sequenceNumber'
    | 'seq'
    | 'position'
    | 'index'
    | 'rank'
    | 'priority'
    | 'sortOrder'
    | 'sortKey'
    | 'step'
    | 'stepNumber';

  type NoForbiddenKeys<T> = Extract<keyof T, ForbiddenOrderKey> extends never ? true : false;

  it('type surface exposes no ordering field (type-level, enforced by tsc)', () => {
    const noOrderOnNode: NoForbiddenKeys<ExecNode> = true;
    const noOrderOnEdge: NoForbiddenKeys<ExecEdge> = true;
    expect(noOrderOnNode).toBe(true);
    expect(noOrderOnEdge).toBe(true);
  });

  it('constructed node carries none of forbidden ordering keys', () => {
    const forbidden = [
      'order',
      'orderIndex',
      'phaseOrder',
      'intraPhaseOrder',
      'sequence',
      'sequenceNumber',
      'position',
      'index',
      'rank',
      'priority',
      'sortOrder',
      'sortKey',
      'step',
      'stepNumber',
    ];
    const keys = Object.keys(base);
    expect(forbidden.filter((k) => keys.includes(k))).toEqual([]);
  });
});

describe('invariant 2: excludeReason is present exactly when excluded', () => {
  it('accepts excluded node with reason', () => {
    const node: ExecNode = { ...base, state: 'excluded', excludeReason: 'async post-commit' };
    expect(() => {
      assertValidExecNode(node);
    }).not.toThrow();
  });

  it('accepts non-excluded node without reason', () => {
    for (const state of ['confirmed', 'inferred', 'unresolved'] as const) {
      const node: ExecNode = { ...base, state };
      expect(() => {
        assertValidExecNode(node);
      }).not.toThrow();
    }
  });

  it('rejects excluded node with no reason', () => {
    const node: ExecNode = { ...base, state: 'excluded' };
    expect(() => {
      assertValidExecNode(node);
    }).toThrow(/excluded.*excludeReason/i);
  });

  it('rejects excluded node with blank reason', () => {
    for (const excludeReason of ['', '   ']) {
      const node: ExecNode = { ...base, state: 'excluded', excludeReason };
      expect(() => {
        assertValidExecNode(node);
      }).toThrow(/excludeReason is missing or empty/i);
    }
  });

  it('rejects non-excluded node that carries reason', () => {
    const node: ExecNode = { ...base, state: 'confirmed', excludeReason: 'should not be here' };
    expect(() => {
      assertValidExecNode(node);
    }).toThrow(/not 'excluded'/i);
  });
});
