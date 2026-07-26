# ADR 006 - Scoring defaults, degrade matrix, and optional expansion

Status: accepted
Date: 2026-07-26
Resolves: how L3-L5 turn evidence into scored graph, how incompleteness is reported, how depth is bounded

## Context

Reference extraction, assembly, scoring, risk, and optional expansion needed several load-bearing
choices before edges could carry confidence. Each could distort later metrics if decided wrong, so
they are recorded rather than left implicit.

## Decision

### Scoring defaults are provisional data

Score is sum of weights of present evidence, clamped to `[0, 1]`; thresholds turn score into state.
Weights and thresholds live in `config/weights.json`, not in code, so calibration on pilot subset
replaces them without touching scorer. File is marked `provisional: true` until that search runs -
same discipline as release-pinned phase model. Hand-setting weights in code would make chapter-5
metrics self-confirming, so it is forbidden.

Default weights (pre-calibration): `dependency_api` 0.9, `object_binding` 0.7, `flow_xml_static`
and `apex_static` 0.6, `config_link` 0.5, `heuristic` 0.2. Thresholds: confirmed 0.8, inferred 0.4.

### State resolution order and scope exclusion

Order is exact: scope exclusion first, then score bands. Node with `excludeReason` is `excluded`
whatever score - exclusion is scope decision, not weak-evidence one. Node in asynchronous
phase (`post_commit`, `sync: false`) is out of analysis scope and excluded with reason. Otherwise
score at or above confirmed threshold is `confirmed`, at or above inferred threshold is `inferred`,
else `unresolved`.

### Dynamic constructs resolve to unresolved through weight, not flag

Dynamic SOQL and dynamically built names cannot be resolved statically. Rather than special-case
flag, extraction records them as `heuristic` evidence (lowest weight), so they score below
inferred threshold and resolve to `unresolved` naturally, with reason in evidence detail. This keeps
one code path for state and still surfaces reason.

### Degrade matrix is data plus flags

Fallbacks are data, not silent branches, so degraded run is never compared to full run without
flag. When dependency query is truncated at its row cap, `meta.truncated` is set, `meta.degraded`
names `dependency_truncated`, and every edge backed by dependency record degrades to `unresolved`.
Offline run with no source or dependency records is normal, not degraded - fewer edges, same states.

### Optional expansion is depth-bounded and cycle-guarded

L5 expands referenced subflows and transitive flows to configured depth, off by default (depth 0).
Cycle guard is keyed on stable id: flow reached once is materialized once and never re-expanded, so
ring cannot loop. Materialized subflow inherits caller's phase, since inline subflow runs within
caller's phase. Expansion runs before assembly, so scoring and freeze cover expanded nodes too.

## Consequences

- Scores and states come from swappable data file; calibration changes numbers without code edits,
  and each run records which weight set it used.
- Truncation and offline paths are visible in `meta`, so evaluation can exclude or annotate degraded
  runs. Double-run on fixtures stays deep-equal, since degrade changes state deterministically.
- Expansion cost is deliberate choice, not always-on, and cannot hang on cyclic references.
- Packaged extension must resolve `config/weights.json` next to bundle, same follow-up as phase model.
