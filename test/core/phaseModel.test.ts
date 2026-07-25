import { describe, expect, it } from 'vitest';
import { loadPhaseModel, phaseIndex, phaseKeys, validatePhaseModel } from '../../src/core/index.js';
import type { PhaseModel } from '../../src/core/index.js';

const EXPECTED_ORDER = [
  'system_validation',
  'before_save_flows',
  'before_triggers',
  'custom_validation',
  'duplicate_rules',
  'after_triggers',
  'workflow_rules',
  'after_save_flows',
  'rollup_summary',
  'criteria_sharing',
  'commit',
  'post_commit',
];

describe('release-pinned phase model (API 67.0)', () => {
  const model = loadPhaseModel();

  it('is pinned to API 67.0 and verified (not provisional)', () => {
    expect(model.provisional).toBe(false);
    expect(model.apiVersion).toBe('67.0');
    expect(model.source.length).toBeGreaterThan(0);
    expect(model.accessed).not.toBeNull();
  });

  it('has twelve canonical phases in pinned order', () => {
    expect(phaseKeys(model)).toEqual(EXPECTED_ORDER);
  });

  it('flags workflow_rules as legacy and post_commit as async', () => {
    const workflow = model.phases.find((p) => p.key === 'workflow_rules');
    const postCommit = model.phases.find((p) => p.key === 'post_commit');
    expect(workflow?.legacy).toBe(true);
    expect(postCommit?.sync).toBe(false);
  });

  it('preserves between-phase order (before < after < commit < post_commit)', () => {
    expect(phaseIndex(model, 'before_triggers')).toBeLessThan(phaseIndex(model, 'after_triggers'));
    expect(phaseIndex(model, 'after_triggers')).toBeLessThan(phaseIndex(model, 'commit'));
    expect(phaseIndex(model, 'commit')).toBeLessThan(phaseIndex(model, 'post_commit'));
  });

  it('returns -1 for unknown phase key', () => {
    expect(phaseIndex(model, 'not_a_phase')).toBe(-1);
  });
});

describe('validatePhaseModel', () => {
  const good: PhaseModel = {
    apiVersion: null,
    provisional: true,
    source: [],
    accessed: null,
    phases: [
      { key: 'a', label: 'A', sync: true },
      { key: 'b', label: 'B', sync: true },
    ],
  };

  it('rejects duplicate phase keys', () => {
    const duplicate: PhaseModel = {
      ...good,
      phases: [...good.phases, { key: 'a', label: 'again', sync: true }],
    };
    expect(() => {
      validatePhaseModel(duplicate);
    }).toThrow(/duplicate/i);
  });

  it('rejects empty phase list', () => {
    expect(() => {
      validatePhaseModel({ ...good, phases: [] });
    }).toThrow(/no phases/i);
  });
});
