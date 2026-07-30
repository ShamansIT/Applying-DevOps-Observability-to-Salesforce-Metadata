// Snapshot builder for generated topologies. Reads a materialised file map into the offline snapshot the
// core consumes, so the mutation shows up in what the prototype analyses. Generated topologies only.

import type { FileMap } from './mutation.js';
import type { OrgSnapshot } from '../ingestion/index.js';

interface Component {
  type: string;
  fullName: string;
  object?: string;
  attributes: Record<string, unknown>;
  source?: string;
}

const TRIGGER_HEADER = /trigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]*)\)/;

function triggerComponent(path: string, source: string): Component | null {
  const match = TRIGGER_HEADER.exec(source);
  if (!match) return null;
  const [, name, object, events] = match;
  const eventList = (events ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  return {
    type: 'ApexTrigger',
    fullName: name ?? path,
    ...(object ? { object } : {}),
    attributes: { events: eventList, status: 'Active' },
    source,
  };
}

function classComponent(path: string, source: string): Component {
  const name = path.replace(/^.*\//, '').replace(/\.cls$/, '');
  return { type: 'ApexClass', fullName: name, attributes: {}, source };
}

function flowComponent(path: string, source: string): Component {
  const name = path.replace(/^.*\//, '').replace(/\.flow-meta\.xml$/, '');
  const object = /<object>([^<]+)<\/object>/.exec(source)?.[1];
  const triggerType = /<triggerType>([^<]+)<\/triggerType>/.exec(source)?.[1] ?? 'RecordAfterSave';
  return {
    type: 'Flow',
    fullName: name,
    ...(object ? { object } : {}),
    attributes: { processType: 'AutoLaunchedFlow', triggerType, status: 'Active' },
    source,
  };
}

function validationRuleComponent(path: string, source: string): Component {
  const object = /\/objects\/([^/]+)\/validationRules\//.exec(path)?.[1];
  const name = path.replace(/^.*\//, '').replace(/\.validationRule-meta\.xml$/, '');
  return {
    type: 'ValidationRule',
    fullName: `${object ?? ''}.${name}`,
    ...(object ? { object } : {}),
    attributes: { active: true },
    source,
  };
}

// Build an offline snapshot from a materialised project. Meta timestamps are fixed, so the snapshot is
// deterministic; timings never enter analysis anyway.
export function snapshotFromFiles(files: FileMap): OrgSnapshot {
  const components: Component[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.trigger')) {
      const component = triggerComponent(path, content);
      if (component) components.push(component);
    } else if (path.endsWith('.cls')) {
      components.push(classComponent(path, content));
    } else if (path.endsWith('.flow-meta.xml')) {
      components.push(flowComponent(path, content));
    } else if (path.endsWith('.validationRule-meta.xml')) {
      components.push(validationRuleComponent(path, content));
    }
  }
  return {
    meta: {
      apiVersion: '67.0',
      capturedAt: '1970-01-01T00:00:00.000Z',
      source: 'generated',
      toolVersion: '0.0.0',
    },
    components,
  } as unknown as OrgSnapshot;
}
