# Cascade

Cascade is how tool turns one captured snapshot into phase-ordered execution flow and dependency
graph for one `(object, event)` pair. It runs as ordered layers; each layer adds to picture and can
run on its own, so skeleton renders early while later layers keep enriching. All of it is pure
TypeScript with no `vscode` import, so same core drives both extension and evaluation.

## Layers

Five layers. Each returns increment; L5 is optional and off by default.

- **L1 inventory (`inventory.ts`).** Build candidate set for chosen object and event. It reads
  snapshot components bound to object and keeps those that could fire for event: record-triggered
  Flows, Apex triggers, validation rules, duplicate rules, and legacy automations (workflow rules,
  Process Builder). Event scope is data, not branching - before-save flows fire on create and update,
  after-save flows add delete, validation and duplicate rules fire on create and update, and Apex
  triggers are matched verb by verb (`insert` reads as create). No source body is parsed here, so
  inventory stays fast.
- **L2 phase classification (`classify.ts`).** Assign each item its phase from pinned model. Mapping
  is keyed off node kind, so release change swaps `phases.v<NN>.json` without touching classifier.
  Result is set of `ExecNode`, one per participant per phase.
- **L3 reference extraction (`extract.ts`).** Parse node bodies and read direct dependency records,
  then emit `dependency` edges and enrich node evidence. Flow record references become edges to their
  objects, subflow calls to their flows, explicit trigger order to `config_link` evidence; Apex
  symbol references become edges to classes. Dynamic or unrecoverable targets come back as low-weight
  `heuristic` signals that resolve to `unresolved`, with reason in evidence detail. Parse failure
  never drops node - it is captured as evidence, since missed component is most expensive
  error for reviewer.
- **L4 graph assembly (`assemble.ts`).** Merge and dedupe nodes and edges by stable id, score each
  from its evidence, resolve state, and freeze output order. Scope exclusion wins over score.
- **L5 optional expansion (`expand.ts`).** Expand referenced targets (subflows, transitive flows) to
  configured depth, behind flag, with cycle guard keyed on stable id. Depth 0 is no-op.

## Scoring and state

Score is sum of weights of present evidence, clamped to `[0, 1]`; thresholds turn score into state
(`score.ts`, `weights.ts`). Weights and thresholds live in `config/weights.json` - data, not code -
so calibration replaces them without touching scorer. State resolution order is exact: scope
exclusion first (`excludeReason` set means `excluded` whatever score), then `confirmed` at or
above confirmed threshold, `inferred` at or above inferred threshold, else `unresolved`. Node in
asynchronous phase is out of scope and is excluded with reason.

## Risk indicators

`risk/indicators.ts` computes seven review-attention signals after assembly: fan-in / fan-out,
cross-phase coupling, unresolved references, low-confidence cluster, deferred / post-commit
reachability, recursion / re-entry hint, automation density per object. Each carries its character -
`deterministic` or `heuristic` - so UI never mixes them and fakes precision method does not
claim. Thresholds come from scenario config with defaults.

## Reconstruct - orchestrator

`reconstruct.ts` runs layers in contract order and emits skeleton after L1, L2, and final assembly,
so caller renders backbone early and fills phases as scoring lands. Output is one `ReconstructResult`:
phase-ordered `Skeleton`, flat node list, dependency edges, seven risk indicators, and `AnalysisRun`
meta. Source body lookup, dependency records, depth limit, weights, and risk thresholds are injected
options, all defaulted, so run is offline and testable with no network.

Determinism is load-bearing. Nodes, edges, skeleton, and risk are byte-identical across runs: phases
follow pinned order, nodes and edges sort by stable id, evidence is deduped and sorted. Per-layer
timings are wall-clock and vary run to run, so they live in `meta.timings` and stay out of graph.
Clock is injected, so tests pin it and compare graph output directly.

## Degrade matrix

Fallbacks are data plus flags, not silent branches, so degraded run is never compared to full run
without flag. When dependency query is truncated, caller passes `truncated`, `meta.truncated` is
set, `meta.degraded` names `dependency_truncated`, and every edge backed by dependency record
degrades to `unresolved` - tool reports incompleteness rather than optimistic picture. Offline run
with no source or dependency records is normal, not degraded: nodes still classify and score from
what evidence exists, edges are simply fewer.

## Modelling decisions

Recorded in ADR 005 and ADR 006; summary here.

- **Trigger firing in both timings becomes two nodes** - one per phase, id suffixed by phase key.
- **Skeleton state is interim until assembly** - classify emits `inferred`; L4 scores and resolves.
- **Scoring defaults are provisional** - `config/weights.json` holds placeholders until calibration.
- **Dynamic constructs are `heuristic`** - lowest weight, so they resolve to `unresolved` honestly.

## Webview

Two pure renderers turn output into HTML - no `vscode`, no timestamp, no nonce - so both are
unit-tested off-screen and yield same markup for same input. `renderSkeleton.ts` draws phase backbone
for progressive first paint after L1; `renderReport.ts` draws full report: phase tree with state
badges and evidence popovers, state and type filters, dependency-edge table, seven risk indicators
split by character, and embedded SVG figure. Extension host (`extension/index.ts`) is thin glue: pick
snapshot, object, and event, render skeleton on first emission, then report, and expose JSON /
Markdown / SVG export commands. Exporters live in `src/persistence` (see persistence.md).

## Not here yet

- Live per-layer streaming into persistent webview shell (current host swaps HTML per emission,
  which is instant since analysis is sub-millisecond).
- Calibration replaces provisional weights and thresholds on pilot subset.

## Files

| File                        | Responsibility                                              |
| --------------------------- | ----------------------------------------------------------- |
| `inventory.ts`              | L1 candidate set for `(object, event)`, offline.            |
| `classify.ts`               | L2 phase assignment from pinned model.                      |
| `extract.ts`                | L3 body parse and dependency records to edges.              |
| `expand.ts`                 | L5 depth-bounded expansion with cycle guard.                |
| `assemble.ts`               | L4 merge, dedupe, score, resolve state, freeze order.       |
| `reconstruct.ts`            | Orchestrate layers, emit skeleton, degrade, record timings. |
| `../score/`                 | Weight model loader plus score and state resolution.        |
| `../risk/indicators.ts`     | Seven review-attention signals, deterministic vs heuristic. |
| `../parse/`                 | Flow XML and Apex header parsers.                           |
| `webview/renderSkeleton.ts` | Deterministic skeleton-to-HTML render (no `vscode`).        |
