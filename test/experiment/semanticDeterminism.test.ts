import { describe, expect, it } from 'vitest';
import {
  canonicalReconstruction,
  compareRepetitions,
  repetitionHash,
} from '../../src/experiment/semanticDeterminism.js';
import type { ReconstructResult } from '../../src/core/index.js';

function result(edgeTo: string): ReconstructResult {
  return {
    nodes: [
      {
        id: 'apex_trigger:Account:T:before_triggers',
        type: 'apex_trigger',
        phase: 'before_triggers',
        state: 'confirmed',
      },
    ],
    edges: [
      {
        from: 'apex_trigger:Account:T:before_triggers',
        to: edgeTo,
        relationship: 'invokes',
        kind: 'dependency',
        state: 'inferred',
        evidence: [{ type: 'apex_static' }],
      },
    ],
    risk: [{ key: 'recursion_reentry_hint', flagged: false, nodes: [] }],
  } as unknown as ReconstructResult;
}

describe('semantic determinism', () => {
  it('canonicalises the full graph and hashes it stably', () => {
    expect(canonicalReconstruction(result('apex_class:H'))).toBe(
      canonicalReconstruction(result('apex_class:H')),
    );
    expect(repetitionHash(result('apex_class:H'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports deterministic when every repetition is identical', () => {
    const out = compareRepetitions([
      result('apex_class:H'),
      result('apex_class:H'),
      result('apex_class:H'),
    ]);
    expect(out.deterministic).toBe(true);
    expect(out.mismatch).toBeNull();
    expect(out.hashes).toHaveLength(3);
  });

  it('names the first differing aspect on a mismatch', () => {
    const out = compareRepetitions([result('apex_class:H'), result('apex_class:OTHER')]);
    expect(out.deterministic).toBe(false);
    expect(out.mismatch?.aspect).toBe('edges');
    expect(out.mismatch?.repetition).toBe(1);
  });
});
