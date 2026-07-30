// Race orchestration and timing. From one shared start, the prototype preflight analysis and the
// standard Salesforce validation run independently; the harness records when each first produced
// actionable feedback and computes the lead time. Durations use a monotonic high-resolution clock
// (nanoseconds), injected so tests are deterministic; wall-clock timestamps for traceability are the
// caller's concern. The oracle always runs, so ground truth is preserved - the prototype never blocks
// it during the experiment.

import type { PrototypeOutcome } from './prototypeAdapter.js';
import type { ValidationResult } from './oracle.js';

export type NanoClock = () => bigint;

export const hrtimeClock: NanoClock = () => process.hrtime.bigint();

export interface RaceTimestamps {
  t0Ns: bigint;
  prototypeFirstActionableNs: bigint;
  prototypeCompletedNs: bigint;
  orgFirstActionableNs: bigint;
  orgValidationCompletedNs: bigint;
}

export interface RaceTiming {
  prototypeTtfafMs: number;
  baselineTtfafMs: number;
  leadTimeMs: number; // baseline minus prototype; positive means the prototype was first
  prototypeLatencyMs: number;
  oracleLatencyMs: number;
  prototypeFirst: boolean;
}

function ms(from: bigint, to: bigint): number {
  return Math.round((Number(to - from) / 1e6) * 1000) / 1000;
}

// Compute timing from recorded nanosecond marks. Pure.
export function computeTiming(ts: RaceTimestamps): RaceTiming {
  const prototypeTtfafMs = ms(ts.t0Ns, ts.prototypeFirstActionableNs);
  const baselineTtfafMs = ms(ts.t0Ns, ts.orgFirstActionableNs);
  return {
    prototypeTtfafMs,
    baselineTtfafMs,
    leadTimeMs: Math.round((baselineTtfafMs - prototypeTtfafMs) * 1000) / 1000,
    prototypeLatencyMs: ms(ts.t0Ns, ts.prototypeCompletedNs),
    oracleLatencyMs: ms(ts.t0Ns, ts.orgValidationCompletedNs),
    prototypeFirst: prototypeTtfafMs <= baselineTtfafMs,
  };
}

export interface RaceResult {
  prototype: PrototypeOutcome;
  oracle: ValidationResult;
  timestamps: RaceTimestamps;
  timing: RaceTiming;
}

export interface RaceOptions {
  prototype: () => PrototypeOutcome; // synchronous core run
  oracle: () => Promise<ValidationResult>; // async CLI run
  now: NanoClock;
}

// Run both paths from one t0. The oracle promise is started first, then the synchronous prototype
// runs, then the oracle is awaited - so the two overlap rather than run one after the other.
export async function runRace(options: RaceOptions): Promise<RaceResult> {
  const t0Ns = options.now();
  const oraclePromise = options.oracle();

  const prototype = options.prototype();
  const prototypeCompletedNs = options.now();
  // A synchronous prototype's first actionable output coincides with its completion.
  const prototypeFirstActionableNs = prototypeCompletedNs;

  const oracle = await oraclePromise;
  const orgValidationCompletedNs = options.now();
  // The mock oracle reports its outcome on completion; a real poller would mark this earlier.
  const orgFirstActionableNs = orgValidationCompletedNs;

  const timestamps: RaceTimestamps = {
    t0Ns,
    prototypeFirstActionableNs,
    prototypeCompletedNs,
    orgFirstActionableNs,
    orgValidationCompletedNs,
  };
  return { prototype, oracle, timestamps, timing: computeTiming(timestamps) };
}
