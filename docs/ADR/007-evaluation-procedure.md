# ADR 007 - Evaluation procedure and ground-truth isolation

Status: accepted
Date: 2026-07-27
Resolves: how chapter-5 evaluation runs over prototype outputs without contaminating analysis

## Context

Evaluation measures reconstructed output against known-correct edges. Several choices had to be
settled so numbers are honest and reproducible, and so ground truth never leaks into analysis.

This is chapter-5 procedure implemented as pure library researcher calls, not shipped harness
or CLI - consistent with ADR 002, which removed harness as deliverable while keeping evaluation
logic that runs over same core.

## Decision

### Ground truth is walled off by module boundary

Evaluation lives in `src/evaluation` and depends on core; core never imports evaluation.
`manualGroundTruth` and `GroundTruthEdge` exist only in evaluation, so core cannot represent, load or
consume ground truth. Isolation is enforced by dependency direction, not by discipline.

### Ground truth is hashed before runs

Ground truth is hashed with sha256 over canonical JSON (keys sorted at every level, so edge order and
whitespace do not change hash). Hash is stamped onto each run result. A reviewer can confirm truth
was frozen before output existed, so truth cannot be quietly tuned to match tool.

### Only claimed edges are positives

Comparison counts edge as positive only when its state is `confirmed` or `inferred`. `unresolved`
and `excluded` edges are explicit uncertainty, not claims of real link, so they never enter
precision as false positives. Penalising them would punish honesty design values (NFR5).

### Metric definitions

precision = TP / (TP + FP); recall = TP / (TP + FN); F1 = harmonic mean; coverage = recall; noise =
FP / claimed; false-omission rate = missed expected-confirmed / expected-confirmed; phase-ordering
accuracy = share of matched edges whose from-node sits in expected phase. Match is by `(from, to)` on
stable ids. These are recorded here so chapter-5 tables trace to one definition.

### Scenario event is DML event

Prompt sketch phrased scenario event as `before_save | after_save`. Analysis target is `(object, DML
event)`, so scenario `event` is DML event (`create | update | delete | undelete`), matching what
core consumes. Save timing is derived by classification, not carried on scenario.

### Snapshot carries bodies for offline parse

`MetadataComponent` gained optional `source`, so captured snapshot can hold Flow XML and Apex body.
Evaluation resolves bodies straight from snapshot, so scenario run parses offline and stays
reproducible from committed fixtures alone.

## Consequences

- Analysis and evaluation share one core, yet ground truth cannot reach analysis - chapter-5
  asymmetry holds by construction.
- Pilot S01 runs snapshot to comparison end-to-end and is deterministic; hash is stable.
- **N** and scenarios S02-S06 stay open, decided with human before freeze. Their ground truth is
  human-authored and reviewed, then hashed - not generated from tool output.
- Calibration can replace provisional weights, since it searches candidates against frozen ground
  truth on pilot subset.
