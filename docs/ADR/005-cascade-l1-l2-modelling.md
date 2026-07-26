# ADR 005 - Cascade L1/L2 modelling decisions

Status: accepted
Date: 2026-07-25
Resolves: node shape and interim state for inventory and phase classification

## Context

First two cascade layers (L1 inventory, L2 phase classification) turn one snapshot into
phase-ordered skeleton for one `(object, event)` pair. Three shape questions had to be settled
before nodes could be emitted, and each could quietly distort later metrics if decided wrong.

## Decision

### One node per phase for multi-phase triggers

Apex trigger can subscribe to both before and after timing for same event, so it runs in two phases
(`before_triggers` and `after_triggers`). `ExecNode` carries exactly one `phase`, on purpose - phase
is between-phase order platform guarantees. Trigger active in both timings therefore becomes two
nodes, one per phase. Node id for triggers is `apex_trigger:<object>:<name>:<phase>`, so both stay
unique; label carries timing (`Name (before)`). Other kinds map to single phase and keep id
`<type>:<object>:<name>`.

### Interim skeleton state, scoring deferred

Classified node carries state `inferred` with score 0. Real score is sum of calibrated evidence
weights, and weights come from calibration procedure on pilot subset - never hand-set in code, or
metrics become self-confirming. State resolution (`confirmed` / `inferred` / `unresolved`) is
threshold-based and runs after graph assembly. So at classification time node is honestly `inferred`
from static config and nothing pretends to computed confidence. Inactive participant is separate:
it will not fire, so it is marked `excluded` with reason `inactive` immediately, which also exercises
exclude-reason invariant end to end.

### Timings in meta, injected clock

Per-layer timings are wall-clock and vary run to run. They live in `AnalysisRun.meta.timings` and
are excluded from graph output, so nodes and skeleton stay byte-identical across runs. Clock is
injected into `reconstruct`, so tests pin it and compare graph directly, and latency instrumentation
lives inside cascade rather than bolted on outside.

## Consequences

- Skeleton is deterministic: phases in pinned order, nodes sorted by stable id, timings quarantined
  to meta. Double-run on `s01-account-update` fixture is deep-equal.
- Downstream scoring can fill score and resolve final state without reshaping nodes; only score and
  state fields change.
- Node count can exceed participant count, since split trigger contributes two nodes. Inventory
  reports candidate count separately from node count so gap is visible.
- Packaged extension still needs `phases.v<NN>.json` resolved next to bundle; source loader uses
  `import.meta.url`. Tracked as follow-up at package step, not in this decision.
