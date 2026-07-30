// Procedural time-to-first-actionable-feedback. This is the operator measure, not a tool timing:
// during a task an operator submits candidate answers over elapsed time, marks the one they would
// first act on, and after the run each candidate is adjudicated for correctness against ground truth.
// TTFAF is the elapsed time to that first actionable answer; correctness at TTFAF is whether it was
// right. Records are human-authored on the evaluation side and never reach analysis. Tool first-paint
// latency is a different thing and lives in latency.ts.

export type TaskCondition = 'baseline' | 'assisted';

// One submitted answer version, timed from task start. `actionable` marks the first the operator
// commits to as usable; `correct` is filled after the run, not during it.
export interface CandidateAnswer {
  atMs: number; // elapsed from task start when submitted
  actionable: boolean;
  correct?: boolean; // adjudicated after run against ground truth
  answer?: string;
}

export interface ProceduralTtfafRecord {
  scenarioId: string;
  condition: TaskCondition;
  taskPrompt: string;
  candidates: CandidateAnswer[];
  timedOut: boolean;
  timeoutMs?: number; // cap when operator ran out of time
  notes?: string;
}

export interface ProceduralTtfaf {
  scenarioId: string;
  condition: TaskCondition;
  ttfafMs: number; // elapsed to first actionable answer; timeout cap when none reached
  reached: boolean; // operator produced an actionable answer within time
  correctAtTtfaf: boolean; // that first actionable answer was correct after run
}

export interface TtfafStat {
  mean: number;
  ciHalfWidth: number;
  n: number;
}

const CONDITIONS = new Set<string>(['baseline', 'assisted']);

export function validateProceduralRecord(record: ProceduralTtfafRecord): void {
  if (!record.scenarioId || !record.taskPrompt) {
    throw new Error('procedural ttfaf: scenarioId and taskPrompt are required');
  }
  if (!CONDITIONS.has(record.condition)) {
    throw new Error(
      `procedural ttfaf ${record.scenarioId}: condition must be baseline or assisted`,
    );
  }
  if (!Array.isArray(record.candidates)) {
    throw new Error(`procedural ttfaf ${record.scenarioId}: candidates must be an array`);
  }
  for (const [index, candidate] of record.candidates.entries()) {
    if (typeof candidate.atMs !== 'number' || candidate.atMs < 0) {
      throw new Error(
        `procedural ttfaf ${record.scenarioId}: candidate ${String(index)} atMs must be non-negative`,
      );
    }
    if (typeof candidate.actionable !== 'boolean') {
      throw new Error(
        `procedural ttfaf ${record.scenarioId}: candidate ${String(index)} actionable must be boolean`,
      );
    }
  }
  if (record.timedOut && (typeof record.timeoutMs !== 'number' || record.timeoutMs <= 0)) {
    throw new Error(
      `procedural ttfaf ${record.scenarioId}: timeoutMs is required and positive when timedOut`,
    );
  }
}

// Reduce one operator record to its TTFAF outcome. First actionable answer is the earliest candidate
// marked actionable; when none, operator did not reach an actionable answer and TTFAF is the timeout
// cap. Correctness at TTFAF reads the post-run adjudication of that first actionable answer.
export function proceduralTtfaf(record: ProceduralTtfafRecord): ProceduralTtfaf {
  validateProceduralRecord(record);
  const actionable = record.candidates
    .filter((candidate) => candidate.actionable)
    .sort((a, b) => a.atMs - b.atMs);
  const first = actionable[0];
  if (!first) {
    return {
      scenarioId: record.scenarioId,
      condition: record.condition,
      ttfafMs: round(record.timeoutMs ?? 0),
      reached: false,
      correctAtTtfaf: false,
    };
  }
  return {
    scenarioId: record.scenarioId,
    condition: record.condition,
    ttfafMs: round(first.atMs),
    reached: true,
    correctAtTtfaf: first.correct === true,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stat(values: number[]): TtfafStat {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, ciHalfWidth: 0, n: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) {
    return { mean: round(mean), ciHalfWidth: 0, n };
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean: round(mean), ciHalfWidth: round(1.96 * (Math.sqrt(variance) / Math.sqrt(n))), n };
}

// Mean and confidence interval of TTFAF over records that reached an actionable answer. Records that
// timed out carry no elapsed time to average, so they are counted apart, not folded into the mean.
export function proceduralTtfafStats(records: ProceduralTtfafRecord[]): {
  ttfaf: TtfafStat;
  reached: number;
  correct: number;
  total: number;
} {
  const outcomes = records.map(proceduralTtfaf);
  const reached = outcomes.filter((outcome) => outcome.reached);
  return {
    ttfaf: stat(reached.map((outcome) => outcome.ttfafMs)),
    reached: reached.length,
    correct: outcomes.filter((outcome) => outcome.correctAtTtfaf).length,
    total: outcomes.length,
  };
}

// CSV of outcomes: one row per record, columns shaped for the procedural table.
export function toProceduralTtfafCsv(records: ProceduralTtfafRecord[]): string {
  const header = ['scenario', 'condition', 'ttfaf_ms', 'reached', 'correct_at_ttfaf'];
  const rows = records.map((record) => {
    const outcome = proceduralTtfaf(record);
    return [
      outcome.scenarioId,
      outcome.condition,
      String(outcome.ttfafMs),
      String(outcome.reached),
      String(outcome.correctAtTtfaf),
    ].join(',');
  });
  return [header.join(','), ...rows, ''].join('\n');
}
