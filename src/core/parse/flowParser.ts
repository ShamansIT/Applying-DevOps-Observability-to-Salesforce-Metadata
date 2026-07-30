// Flow static parse. Reads Flow metadata XML and pulls out what phase classification and dependency
// extraction need: start element, triggerType, bound object, record-trigger type, entry-criteria
// presence, record references, subflow calls, and explicit trigger-order value. Header-level read,
// not full flow execution. Pure; never throws - malformed XML comes back as captured error, since
// dropping component is worse for reviewer than flagged one.

import { XMLParser, XMLValidator } from 'fast-xml-parser';

// One outbound reference from flow to some record operation or subflow.
export interface FlowReference {
  kind: 'recordCreate' | 'recordUpdate' | 'recordLookup' | 'recordDelete' | 'subflow';
  name: string;
  object?: string; // target sObject for record ops
  flowName?: string; // called flow for subflows
}

export interface ParsedFlow {
  processType?: string;
  triggerType?: string; // RecordBeforeSave / RecordAfterSave / ...
  object?: string; // start element bound object
  recordTriggerType?: string; // Create / Update / CreateAndUpdate / Delete
  hasEntryCriteria: boolean;
  triggerOrder?: number; // explicit intra-phase order, when set; sanctioned config_link
  references: FlowReference[];
  subflows: string[];
  errors: string[]; // parse problems; empty on clean read
}

const RECORD_OPS: { tag: string; kind: FlowReference['kind'] }[] = [
  { tag: 'recordCreates', kind: 'recordCreate' },
  { tag: 'recordUpdates', kind: 'recordUpdate' },
  { tag: 'recordLookups', kind: 'recordLookup' },
  { tag: 'recordDeletes', kind: 'recordDelete' },
];

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: true, trimValues: true });

// Coerce repeated-or-single XML child into array. Missing yields empty.
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// Read child value as trimmed string, or undefined when absent or non-scalar.
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

// Parse Flow metadata XML. Returns structured view; on failure returns empty view with reason.
export function parseFlow(xml: string): ParsedFlow {
  const empty: ParsedFlow = { hasEntryCriteria: false, references: [], subflows: [], errors: [] };

  let root: Record<string, unknown>;
  try {
    const valid = XMLValidator.validate(xml);
    if (valid !== true) {
      return { ...empty, errors: [`flow: XML invalid - ${valid.err.msg}`] };
    }
    const parsed = asRecord(parser.parse(xml));
    root = asRecord(parsed['Flow']);
    if (Object.keys(root).length === 0) {
      return { ...empty, errors: ['flow: no Flow root element'] };
    }
  } catch (error) {
    return { ...empty, errors: [`flow: XML parse failed - ${String(error)}`] };
  }

  const start = asRecord(root['start']);
  const references: FlowReference[] = [];
  for (const { tag, kind } of RECORD_OPS) {
    for (const entry of asArray(root[tag])) {
      const record = asRecord(entry);
      const object = asString(record['object']);
      references.push({
        kind,
        name: asString(record['name']) ?? '',
        ...(object !== undefined ? { object } : {}),
      });
    }
  }

  const subflows: string[] = [];
  for (const entry of asArray(root['subflows'])) {
    const record = asRecord(entry);
    const flowName = asString(record['flowName']);
    if (flowName !== undefined) {
      subflows.push(flowName);
      references.push({ kind: 'subflow', name: asString(record['name']) ?? '', flowName });
    }
  }

  const order = Number(start['triggerOrder'] ?? root['triggerOrder']);

  const result: ParsedFlow = {
    hasEntryCriteria: 'filters' in start || 'filterLogic' in start,
    references,
    subflows,
    errors: [],
  };
  const processType = asString(root['processType']);
  const triggerType = asString(start['triggerType']);
  const object = asString(start['object']);
  const recordTriggerType = asString(start['recordTriggerType']);
  if (processType !== undefined) result.processType = processType;
  if (triggerType !== undefined) result.triggerType = triggerType;
  if (object !== undefined) result.object = object;
  if (recordTriggerType !== undefined) result.recordTriggerType = recordTriggerType;
  if (Number.isFinite(order)) result.triggerOrder = order;
  return result;
}
