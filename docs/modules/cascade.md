# Cascade

Cascade is how tool turns one captured snapshot into phase-ordered execution skeleton for one
`(object, event)` pair. It runs as ordered layers; each layer adds to picture and can run on its own,
so skeleton renders early while later layers keep enriching. All of it is pure TypeScript with no
`vscode` import, so same core drives both extension and evaluation.

## Layers

Two layers land here; later layers (reference extraction, graph assembly, optional expansion) arrive
after.

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

## Reconstruct - orchestrator

`reconstruct.ts` runs layers in contract order: L1 inventory, emit skeleton, L2 classify, emit
again. `emit` hook is what makes progressive render possible - caller renders backbone after L1 and
fills phases after L2. Output is one `ReconstructResult`: phase-ordered `Skeleton`, flat node list
sorted by stable id, and `AnalysisRun` meta.

Determinism is load-bearing. Nodes and skeleton are byte-identical across runs: phases follow pinned
order, and nodes inside phase are sorted by id only (platform guarantees order between phases, not
inside one). Per-layer timings are wall-clock and vary run to run, so they live in `meta.timings`
and stay out of graph. Clock is injected, so tests pin it and compare graph output directly.

## Two modelling decisions

Recorded in ADR 005; summary here.

- **Trigger firing in both timings becomes two nodes.** Apex trigger active on before and after for
  same event runs in two phases (`before_triggers`, `after_triggers`). Each phase gets own node, id
  suffixed by phase key so both stay unique, label carries timing. Single node cannot express two
  phases, so split is honest shape.
- **Skeleton state is interim.** Classified node carries state `inferred` with score 0. Real score
  needs calibrated weights, and state resolution runs after graph assembly, so skeleton does not
  pretend to confidence it has not computed yet. Inactive participant is different: it will not fire,
  so it is marked `excluded` with reason `inactive` right away.

## Webview

`extension/webview/renderSkeleton.ts` turns skeleton into HTML. It is pure and deterministic - no
`vscode`, no timestamp, no nonce - so it is unit-tested off-screen and always yields same markup for
same skeleton. Phases render in pinned order as collapsible groups; each node shows state badge,
kind, and label; excluded nodes are struck through; legacy and async are flagged. Extension host
(`extension/index.ts`) is thin glue: pick snapshot, object, and event, run `reconstruct`, and set
webview HTML on each emission.

## Not here yet

- Reference and evidence extraction (Flow XML, Apex headers, dependency records), graph assembly,
  and optional depth expansion arrive with later layers.
- Scoring and threshold-based state resolution wait on calibrated `config/weights.json`; skeleton
  score stays 0 until then, never hand-set in code.
- Packaged extension must ship `phases.v<NN>.json` next to bundle and resolve it there; source
  loader uses `import.meta.url`, which needs asset copy and loader wiring at package step.

## Files

| File                        | Responsibility                                       |
| --------------------------- | ---------------------------------------------------- |
| `inventory.ts`              | L1 candidate set for `(object, event)`, offline.     |
| `classify.ts`               | L2 phase assignment from pinned model.               |
| `reconstruct.ts`            | Orchestrate layers, emit skeleton, record timings.   |
| `webview/renderSkeleton.ts` | Deterministic skeleton-to-HTML render (no `vscode`). |
| `extension/index.ts`        | Activation and command; wire cascade to webview.     |
