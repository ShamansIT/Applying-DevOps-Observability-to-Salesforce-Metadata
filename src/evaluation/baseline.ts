// Baseline session record. The operator side of one task attempt under one condition, captured by
// hand: fixed task prompt, timed candidate answers, what the operator identified and the evidence
// behind it, a timed inspection log, timeout, and where this condition sat in the counterbalanced
// order. TTFAF is derived from the same candidates, so the timing measure and the session share one
// source. Human-authored on the evaluation side, never reaches analysis.

import { proceduralTtfaf, validateProceduralRecord } from './ttfaf.js';
import type {
  CandidateAnswer,
  ProceduralTtfaf,
  ProceduralTtfafRecord,
  TaskCondition,
} from './ttfaf.js';

// One timed thing the operator looked at during the task - a metadata page, a source body, a query.
export interface InspectionEvent {
  atMs: number; // elapsed from task start
  action: string; // what the operator did, e.g. `opened flow`, `read trigger body`
  target?: string; // component or object the action was on
}

// One component or relationship the operator reported, with the evidence and source behind it, so a
// baseline answer carries the same kind of provenance ground truth does.
export interface IdentifiedItem {
  ref: string;
  kind: 'component' | 'relationship';
  evidence?: string;
  source?: string;
}

export interface BaselineSession {
  scenarioId: string;
  operator: string; // anonymised operator id
  condition: TaskCondition;
  conditionOrder: number; // 1-based order this condition ran for the operator, for counterbalancing
  taskPrompt: string;
  candidates: CandidateAnswer[];
  timedOut: boolean;
  timeoutMs?: number;
  identified: IdentifiedItem[];
  inspectionLog: InspectionEvent[];
  notes?: string;
}

const KINDS = new Set<string>(['component', 'relationship']);

// Build the procedural TTFAF record from a session, so the timing measure reads the same candidates.
export function proceduralRecordOf(session: BaselineSession): ProceduralTtfafRecord {
  return {
    scenarioId: session.scenarioId,
    condition: session.condition,
    taskPrompt: session.taskPrompt,
    candidates: session.candidates,
    timedOut: session.timedOut,
    ...(session.timeoutMs !== undefined ? { timeoutMs: session.timeoutMs } : {}),
  };
}

export function validateBaselineSession(session: BaselineSession): void {
  if (!session.operator) {
    throw new Error(`baseline ${session.scenarioId}: operator is required`);
  }
  if (!Number.isInteger(session.conditionOrder) || session.conditionOrder < 1) {
    throw new Error(`baseline ${session.scenarioId}: conditionOrder must be a positive integer`);
  }
  for (const [index, item] of session.identified.entries()) {
    if (!item.ref || !KINDS.has(item.kind)) {
      throw new Error(
        `baseline ${session.scenarioId}: identified ${String(index)} needs ref and kind component or relationship`,
      );
    }
  }
  for (const [index, event] of session.inspectionLog.entries()) {
    if (typeof event.atMs !== 'number' || event.atMs < 0 || !event.action) {
      throw new Error(
        `baseline ${session.scenarioId}: inspection ${String(index)} needs non-negative atMs and action`,
      );
    }
  }
  // Reuse the procedural checks for prompt, condition, candidates and timeout.
  validateProceduralRecord(proceduralRecordOf(session));
}

// Reduce a session to its TTFAF outcome.
export function sessionTtfaf(session: BaselineSession): ProceduralTtfaf {
  validateBaselineSession(session);
  return proceduralTtfaf(proceduralRecordOf(session));
}

// CSV summary: one row per session, so baseline and assisted lines sit side by side.
export function toBaselineCsv(sessions: BaselineSession[]): string {
  const header = [
    'scenario',
    'operator',
    'condition',
    'condition_order',
    'ttfaf_ms',
    'reached',
    'correct_at_ttfaf',
    'identified',
    'inspections',
    'timed_out',
  ];
  const rows = sessions.map((session) => {
    const outcome = sessionTtfaf(session);
    return [
      session.scenarioId,
      session.operator,
      session.condition,
      String(session.conditionOrder),
      String(outcome.ttfafMs),
      String(outcome.reached),
      String(outcome.correctAtTtfaf),
      String(session.identified.length),
      String(session.inspectionLog.length),
      String(session.timedOut),
    ].join(',');
  });
  return [header.join(','), ...rows, ''].join('\n');
}
