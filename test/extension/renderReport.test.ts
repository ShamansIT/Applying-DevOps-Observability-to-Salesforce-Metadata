import { describe, expect, it } from 'vitest';
import { reconstruct } from '../../src/core/cascade/reconstruct.js';
import type { SourceResolver } from '../../src/core/cascade/extract.js';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import { renderReport } from '../../src/extension/webview/renderReport.js';
import type { MetadataComponent, OrgSnapshot } from '../../src/ingestion/index.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

const APEX = `trigger AccountTrigger on Account (before update) {
  AccountService.run(Trigger.new);
  List<SObject> r = Database.query('SELECT Id FROM ' + o);
}`;

const SNAPSHOT: OrgSnapshot = {
  meta: {
    apiVersion: '67.0',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'fixture',
    toolVersion: '0.0.1',
  },
  components: [
    {
      type: 'ApexTrigger',
      fullName: 'AccountTrigger',
      object: 'Account',
      attributes: { events: ['before update'], status: 'Active' },
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
  const resolver: SourceResolver = (c) => (c.type === 'ApexTrigger' ? APEX : undefined);
  const result = reconstruct(SNAPSHOT, { object: 'Account', event: 'update' }, MODEL, {
    sourceResolver: resolver,
    dependencies: {
      records: [
        {
          componentName: 'AccountTrigger',
          componentType: 'ApexTrigger',
          refName: 'AccountService',
          refType: 'ApexClass',
        },
      ],
    },
    weights: WEIGHTS,
  });
  return renderReport(result);
}

describe('renderReport', () => {
  it('is deterministic', () => {
    expect(render()).toBe(render());
  });

  it('renders filters, badges, evidence, risk and figure', () => {
    const html = render();
    expect(html).toContain('class="filters"');
    expect(html).toContain('class="fstate"');
    expect(html).toContain('badge-'); // state badge classes
    expect(html).toContain('ul class="evidence"');
    expect(html).toContain('class="risk"');
    expect(html).toContain('<svg');
  });

  it('carries node data attributes used by filters', () => {
    const html = render();
    expect(html).toMatch(/data-state="[a-z]+"/);
    expect(html).toMatch(/data-type="[a-z_]+"/);
  });

  it('shows exclude reason for inactive participant', () => {
    expect(render()).toContain('inactive');
  });

  it('escapes html in labels', () => {
    const snap: OrgSnapshot = {
      ...SNAPSHOT,
      components: [
        {
          type: 'ApexTrigger',
          fullName: '<x>',
          object: 'Account',
          attributes: { events: ['before update'] },
        },
      ],
    };
    const result = reconstruct(snap, { object: 'Account', event: 'update' }, MODEL, {
      weights: WEIGHTS,
    });
    const html = renderReport(result);
    expect(html).not.toContain('<x> (before)');
    expect(html).toContain('&lt;x&gt;');
  });
});
