import { describe, expect, it } from 'vitest';
import { classify } from '../../../src/core/cascade/classify.js';
import type { InventoryItem } from '../../../src/core/cascade/inventory.js';
import { loadPhaseModel } from '../../../src/core/phases/phaseModel.js';
import { assertValidExecNode } from '../../../src/core/validate.js';
import type { MetadataComponent } from '../../../src/ingestion/index.js';

const MODEL = loadPhaseModel();

function raw(type: string, fullName: string): MetadataComponent {
  return { type, fullName, object: 'Account', attributes: {} };
}

function item(
  partial: Partial<InventoryItem> & Pick<InventoryItem, 'nodeType' | 'fullName'>,
): InventoryItem {
  return {
    object: 'Account',
    timings: [],
    active: true,
    legacy: false,
    source: raw('X', partial.fullName),
    ...partial,
  };
}

describe('classify (L2)', () => {
  it('maps single-phase kinds onto pinned phase keys', () => {
    const nodes = classify(
      [
        item({ nodeType: 'flow_before', fullName: 'F_Before' }),
        item({ nodeType: 'flow_after', fullName: 'F_After' }),
        item({ nodeType: 'validation_rule', fullName: 'V' }),
        item({ nodeType: 'duplicate_rule', fullName: 'D' }),
      ],
      MODEL,
    );
    const byType = Object.fromEntries(nodes.map((n) => [n.type, n.phase]));
    expect(byType).toEqual({
      flow_before: 'before_save_flows',
      flow_after: 'after_save_flows',
      validation_rule: 'custom_validation',
      duplicate_rule: 'duplicate_rules',
    });
  });

  it('splits a before+after trigger into one node per phase with unique ids', () => {
    const nodes = classify(
      [
        item({
          nodeType: 'apex_trigger',
          fullName: 'AccountTrigger',
          timings: ['after', 'before'],
        }),
      ],
      MODEL,
    );
    expect(nodes).toHaveLength(2);
    const phases = nodes.map((n) => n.phase).sort();
    expect(phases).toEqual(['after_triggers', 'before_triggers']);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(2);
    expect(nodes.every((n) => n.apiName === 'AccountTrigger')).toBe(true);
  });

  it('marks inactive participant excluded with reason and passes node invariant', () => {
    const nodes = classify(
      [item({ nodeType: 'validation_rule', fullName: 'V_Off', active: false })],
      MODEL,
    );
    expect(nodes[0]?.state).toBe('excluded');
    expect(nodes[0]?.excludeReason).toBe('inactive');
    for (const node of nodes) {
      expect(() => {
        assertValidExecNode(node);
      }).not.toThrow();
    }
  });

  it('gives active participants confirmed state with ranking score filled later', () => {
    const nodes = classify([item({ nodeType: 'flow_before', fullName: 'F' })], MODEL);
    expect(nodes[0]?.state).toBe('confirmed');
    expect(nodes[0]?.score).toBe(0); // ranking score is filled at assembly
    expect(nodes[0]?.evidence[0]?.type).toBe('config_link');
  });

  it('flags legacy participants', () => {
    const nodes = classify(
      [item({ nodeType: 'workflow_rule', fullName: 'W', legacy: true })],
      MODEL,
    );
    expect(nodes[0]?.legacy).toBe(true);
    expect(nodes[0]?.phase).toBe('workflow_rules');
  });

  it('every produced node satisfies the exclude-reason invariant', () => {
    const nodes = classify(
      [
        item({ nodeType: 'apex_trigger', fullName: 'T', timings: ['before'] }),
        item({ nodeType: 'process_builder', fullName: 'PB', legacy: true }),
        item({ nodeType: 'duplicate_rule', fullName: 'DR', active: false }),
      ],
      MODEL,
    );
    for (const node of nodes) {
      expect(() => {
        assertValidExecNode(node);
      }).not.toThrow();
    }
  });
});
