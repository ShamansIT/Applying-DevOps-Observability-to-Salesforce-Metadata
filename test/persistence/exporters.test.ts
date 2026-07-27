import { describe, expect, it } from 'vitest';
import { reconstruct } from '../../src/core/cascade/reconstruct.js';
import type { SourceResolver } from '../../src/core/cascade/extract.js';
import { loadPhaseModel } from '../../src/core/phases/phaseModel.js';
import { loadWeights } from '../../src/core/score/index.js';
import {
  exportJson,
  exportMarkdown,
  exportSvg,
  toStructuredExport,
} from '../../src/persistence/index.js';
import type { MetadataComponent, OrgSnapshot } from '../../src/ingestion/index.js';

const MODEL = loadPhaseModel();
const WEIGHTS = loadWeights();

const FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>AutoLaunchedFlow</processType>
  <start><object>Account</object><triggerType>RecordAfterSave</triggerType></start>
  <recordUpdates><name>U</name><object>Contact</object></recordUpdates>
</Flow>`;

const APEX = `trigger AccountTrigger on Account (before update) { AccountService.run(Trigger.new); }`;

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
      fullName: 'Account_After',
      object: 'Account',
      attributes: { triggerType: 'RecordAfterSave', status: 'Active' },
    },
    {
      type: 'ApexTrigger',
      fullName: 'AccountTrigger',
      object: 'Account',
      attributes: { events: ['before update'], status: 'Active' },
    },
  ] satisfies MetadataComponent[],
};

const RESOLVER: SourceResolver = (component) =>
  component.type === 'ApexTrigger' ? APEX : FLOW_XML;

function runResult() {
  return reconstruct(SNAPSHOT, { object: 'Account', event: 'update' }, MODEL, {
    sourceResolver: RESOLVER,
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
}

describe('exportJson', () => {
  it('drops timings and keeps graph, states, evidence, risk and meta', () => {
    const parsed = JSON.parse(exportJson(runResult())) as ReturnType<typeof toStructuredExport>;
    expect(parsed.meta).not.toHaveProperty('timings');
    expect(parsed.meta.object).toBe('Account');
    expect(parsed.phaseOrder).toEqual(MODEL.phases.map((p) => p.key));
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.risk).toHaveLength(7);
  });

  it('is byte-identical across two runs', () => {
    expect(exportJson(runResult())).toBe(exportJson(runResult()));
  });
});

describe('exportMarkdown', () => {
  it('renders phase sections, edge table and risk table', () => {
    const md = exportMarkdown(runResult());
    expect(md).toContain('# Execution flow - Account update');
    expect(md).toContain('## Phases');
    expect(md).toContain('## Dependency edges');
    expect(md).toContain('## Risk indicators');
    expect(md).toBe(exportMarkdown(runResult())); // deterministic
  });
});

describe('exportSvg', () => {
  it('produces a valid deterministic svg with node boxes', () => {
    const svg = exportSvg(runResult());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<rect');
    expect(svg).toBe(exportSvg(runResult()));
  });
});
