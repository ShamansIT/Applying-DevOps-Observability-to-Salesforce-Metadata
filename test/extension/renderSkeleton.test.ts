import { describe, expect, it } from 'vitest';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { reconstruct } from '../../src/core/cascade/reconstruct.js';
import { renderSkeleton } from '../../src/extension/webview/renderSkeleton.js';
import type { MetadataComponent, OrgSnapshot } from '../../src/ingestion/index.js';

const MODEL = loadPhaseModel();

const SNAPSHOT: OrgSnapshot = {
  meta: {
    apiVersion: '67.0',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'fixture',
    toolVersion: '0.0.1',
  },
  components: [
    {
      type: 'Flow',
      fullName: 'Account_Before_Save',
      object: 'Account',
      attributes: { triggerType: 'RecordBeforeSave', status: 'Active' },
    },
    {
      type: 'ValidationRule',
      fullName: 'Account.Off',
      object: 'Account',
      attributes: { active: false },
    },
  ] satisfies MetadataComponent[],
};

function render(): string {
  const { skeleton } = reconstruct(SNAPSHOT, { object: 'Account', event: 'update' }, MODEL);
  return renderSkeleton(skeleton);
}

describe('renderSkeleton', () => {
  it('is deterministic for the same skeleton', () => {
    expect(render()).toBe(render());
  });

  it('renders every pinned phase in order', () => {
    const html = render();
    let last = -1;
    for (const phase of MODEL.phases) {
      const at = html.indexOf(`data-phase="${phase.key}"`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('shows subject header and state badges', () => {
    const html = render();
    expect(html).toContain('Account - update');
    expect(html).toContain('state-inferred');
    expect(html).toContain('state-excluded');
  });

  it('escapes angle brackets in labels', () => {
    const snap: OrgSnapshot = {
      ...SNAPSHOT,
      components: [
        {
          type: 'Flow',
          fullName: '<script>',
          object: 'Account',
          attributes: { triggerType: 'RecordBeforeSave', status: 'Active' },
        },
      ],
    };
    const { skeleton } = reconstruct(snap, { object: 'Account', event: 'update' }, MODEL);
    const html = renderSkeleton(skeleton);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks empty phases with no-participants note', () => {
    const html = render();
    expect(html).toContain('no participants');
  });
});
