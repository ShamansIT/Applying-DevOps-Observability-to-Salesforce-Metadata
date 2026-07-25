# ADR 004 - Pin phase model to API 67.0

Status: accepted
Date: 2026-07-25
Resolves: phase-model release pin

## Context

Phase model shipped provisionally: 12-phase Order-of-Execution skeleton reconstructed from memory,
marked `provisional` with `apiVersion: null`, because release to pin and line-by-line verification
against official documentation were open. Nothing downstream should classify onto unverified
model, and groundwork is not complete while provisional pin remains.

Current General Availability release is **Summer '26, API version 67.0**.

## Decision

Pin phase model to **API 67.0** and verify it against official Salesforce Order-of-Execution
documentation, accessed 2026-07-25:
`https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm`

File is `src/core/phases/phases.v67.json`, with `provisional: false`, `apiVersion: "67.0"`, and
`source` and `accessed` filled. Provisional file is removed and loader defaults to pinned file.

### Verification result

Twelve canonical phases and their order match official steps. Official documentation lists ~20
fine-grained steps; mapping is:

| Official step(s)                                     | Phase                     |
| ---------------------------------------------------- | ------------------------- |
| Load record; load new values; system validation      | `system_validation`       |
| Before-save record-triggered flows                   | `before_save_flows`       |
| Before triggers                                      | `before_triggers`         |
| System validation again; custom validation rules     | `custom_validation`       |
| Duplicate rules                                      | `duplicate_rules`         |
| After triggers (record already saved, not committed) | `after_triggers`          |
| Workflow rules                                       | `workflow_rules` (legacy) |
| After-save record-triggered flows                    | `after_save_flows`        |
| Roll-up summary (parent and grandparent)             | `rollup_summary`          |
| Criteria-based sharing                               | `criteria_sharing`        |
| DML commit                                           | `commit`                  |
| Post-commit logic (email, async)                     | `post_commit` (async)     |

No change to skeleton's phases or order was needed.

### Two documented modelling decisions (not diffs to fix)

- **Object-scoped rule families.** Official steps for assignment rules, auto-response rules,
  escalation rules, and entitlement rules are object-scoped (lead / case / entitlement contexts).
  By design these are **not** separate ordered phases; they are nodes on their governing phase,
  scoped by object.
- **Process Builder / workflow-launched flows.** Official documentation has distinct step for
  these (between escalation and after-save flows). 12-phase canonical model has no dedicated slot
  for it; Process Builder participant is represented as **legacy node** (node type
  `process_builder`), not as its own phase.

## Consequences

- Phase verification is done.
- Model is now `confirmed`, with citable source and access date - downstream classification runs
  against verified model, not draft.
- Future release change means new `phases.v<NN>.json` and new run, never silent edit of this
  file (release pinning).
- If Salesforce changes Order of Execution in later release, re-pinning repeats this verification
  and records any diff here.
