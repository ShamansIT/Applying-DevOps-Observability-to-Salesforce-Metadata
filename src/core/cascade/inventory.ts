// L1 inventory. First cascade layer: build candidate set of record-triggered participants for one
// (object, event) pair from captured snapshot. No parsing of source bodies here and no phase
// assignment - just enumerate what could fire, so skeleton can render fast. Pure, offline.

import type { MetadataComponent, OrgSnapshot } from '../../ingestion/orgSnapshot.js';
import { componentsForObject } from '../../ingestion/orgSnapshot.js';
import type { NodeType } from '../types.js';

// DML operation that starts record-triggered execution. undelete included for completeness even
// though few automations subscribe to it.
export type DmlEvent = 'create' | 'update' | 'delete' | 'undelete';

// Save timing Apex trigger fires in for chosen event. Flows carry timing in triggerType, so this
// applies to triggers only.
export type SaveTiming = 'before' | 'after';

// Chosen analysis subject: one object and one DML event.
export interface AnalysisTarget {
  object: string;
  event: DmlEvent;
}

// One candidate participant found for target, before phase assignment. Carries normalized signals
// L2 needs, plus raw record for evidence references.
export interface InventoryItem {
  fullName: string;
  object: string;
  namespace?: string;
  nodeType: NodeType; // coarse participant kind; apex_trigger stays timing-split until L2
  timings: SaveTiming[]; // timings in scope for apex_trigger; empty for single-phase kinds
  active: boolean;
  legacy: boolean;
  source: MetadataComponent; // raw record, kept for evidence ref and later parsing
}

// Events each single-phase kind subscribes to. Data, not branching: kind is included when target
// event is in its set. Flows split by triggerType below, so Flow is absent here.
const EVENT_SCOPE: Partial<Record<string, DmlEvent[]>> = {
  ValidationRule: ['create', 'update'],
  DuplicateRule: ['create', 'update'],
  WorkflowRule: ['create', 'update'],
};

// Flow triggerType to firing events. Before-save runs on create and update; after-save adds delete.
const FLOW_EVENT_SCOPE: Record<string, DmlEvent[]> = {
  RecordBeforeSave: ['create', 'update'],
  RecordAfterSave: ['create', 'update', 'delete'],
};

// Apex trigger DML verb to DML event. insert reads as create; rest map by name.
const TRIGGER_OP: Record<string, DmlEvent> = {
  insert: 'create',
  update: 'update',
  delete: 'delete',
  undelete: 'undelete',
};

// Build candidate set for (object, event). Deterministic order: keeps snapshot order, so caller can
// sort by stable id at emit time.
export function inventory(snapshot: OrgSnapshot, target: AnalysisTarget): InventoryItem[] {
  const components = componentsForObject(snapshot, target.object);
  const items: InventoryItem[] = [];
  for (const component of components) {
    const item = toItem(component, target.event);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

// Map one component to inventory item when it fires for event, else null. Object match already done
// by caller.
function toItem(component: MetadataComponent, event: DmlEvent): InventoryItem | null {
  const base = {
    fullName: component.fullName,
    object: component.object ?? '',
    ...(component.namespace !== undefined ? { namespace: component.namespace } : {}),
    source: component,
  };

  switch (component.type) {
    case 'Flow':
      return flowItem(component, event, base);
    case 'ApexTrigger':
      return triggerItem(component, event, base);
    case 'ValidationRule':
    case 'DuplicateRule':
    case 'WorkflowRule':
      return scopedItem(component, event, base);
    default:
      return null;
  }
}

type ItemBase = Pick<InventoryItem, 'fullName' | 'object' | 'source'> &
  Partial<Pick<InventoryItem, 'namespace'>>;

// Record-triggered Flow, or legacy Process Builder. triggerType decides save phase; Process Builder
// (processType Workflow) is legacy and modelled on after-save area.
function flowItem(
  component: MetadataComponent,
  event: DmlEvent,
  base: ItemBase,
): InventoryItem | null {
  const processType = asString(component.attributes['processType']);
  const triggerType = asString(component.attributes['triggerType']);

  if (processType === 'Workflow' || processType === 'InvocableProcess') {
    // Process Builder fires on create and update.
    if (event !== 'create' && event !== 'update') {
      return null;
    }
    return {
      ...base,
      nodeType: 'process_builder',
      timings: [],
      active: isActive(component),
      legacy: true,
    };
  }

  const scope = FLOW_EVENT_SCOPE[triggerType];
  if (!scope || !scope.includes(event)) {
    return null;
  }
  const nodeType: NodeType = triggerType === 'RecordBeforeSave' ? 'flow_before' : 'flow_after';
  return { ...base, nodeType, timings: [], active: isActive(component), legacy: false };
}

// Apex trigger. Parse events attribute into timings that match target event; drop trigger when it
// does not subscribe to event.
function triggerItem(
  component: MetadataComponent,
  event: DmlEvent,
  base: ItemBase,
): InventoryItem | null {
  const raw = component.attributes['events'];
  const events = Array.isArray(raw) ? raw.map(String) : [];
  const timings = new Set<SaveTiming>();
  for (const entry of events) {
    const [timingWord, opWord] = entry.trim().toLowerCase().split(/\s+/);
    const op = opWord ? TRIGGER_OP[opWord] : undefined;
    if (op === event && (timingWord === 'before' || timingWord === 'after')) {
      timings.add(timingWord);
    }
  }
  if (timings.size === 0) {
    return null;
  }
  return {
    ...base,
    nodeType: 'apex_trigger',
    timings: [...timings].sort(),
    active: isActive(component),
    legacy: false,
  };
}

// Single-phase, object-bound kinds (validation, duplicate, legacy workflow). Fixed event scope.
function scopedItem(
  component: MetadataComponent,
  event: DmlEvent,
  base: ItemBase,
): InventoryItem | null {
  const scope = EVENT_SCOPE[component.type];
  if (!scope || !scope.includes(event)) {
    return null;
  }
  const nodeType: NodeType =
    component.type === 'ValidationRule'
      ? 'validation_rule'
      : component.type === 'DuplicateRule'
        ? 'duplicate_rule'
        : 'workflow_rule';
  return {
    ...base,
    nodeType,
    timings: [],
    active: isActive(component),
    legacy: component.type === 'WorkflowRule',
  };
}

// Read raw attribute as string, or empty when absent or non-string. Never stringifies objects.
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Active flag from common attribute shapes. Missing flag reads as active, so unknown status never
// hides participant from skeleton.
function isActive(component: MetadataComponent): boolean {
  const attrs = component.attributes;
  if (typeof attrs['active'] === 'boolean') {
    return attrs['active'];
  }
  const status = attrs['status'];
  if (typeof status === 'string') {
    return status.toLowerCase() === 'active';
  }
  return true;
}
