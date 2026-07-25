# ADR 002 - Repository layout and evaluation approach

## Context

Repository layout is documented in dissertation. Earlier working sketch differed from it in
few module names and in level of detail; this ADR reconciles them so code and write-up agree.

Same sketch also framed evaluation as separate implemented `Evaluation Harness` (CLI,
first-class deliverable). No such component exists or is planned: placeholder `harness/` directory
held only stub (`export {};` plus comment), no runner and no commands, and produced nothing.
Describing harness would make false implementation claim.

## Decision

### Layout

Dissertation layout as on-disk structure.

```
src/core          domain types, release-pinned phase model, confidence states,
                  scoring, risk indicators, progressive-discovery cascade (pure TS)
src/ingestion     orgSnapshot.ts, toolingClient.ts, metadataComponentDependencyClient.ts,
                  flowParser.ts, apexParser.ts, dxProjectReader.ts
src/extension     activation, commands, webview host, progress reporting, graph/list rendering
src/persistence   workspace cache, graph cache, run log, exporters (JSON, Markdown, SVG)
fixtures/         snapshots/, scenarios/, ground-truth/ (Expected Execution Maps)
config/           weights.json, thresholds, latency budgets, analysis settings
docs/             ADR/, RUNBOOK, VERSIONS, modules/
results/          structured prototype outputs, run metadata, metric CSVs (results/summary tracked)
```

- ingestion dependency client is `metadataComponentDependencyClient.ts` (self-describing, names API
  it wraps), not sketch's `dependencyApi.ts`.
- `dxProjectReader.ts` is first-class ingestion module.
- persistence keeps `graph cache` and `run log` as distinct concerns from workspace cache.

For now code directories carry placeholder `index.ts` barrel each; named modules land later, one by
one.

### Evaluation

Prototype is one workflow:

```
VS Code extension -> metadata ingestion -> TypeScript analysis core
  -> persistence / structured export -> developer-facing output
```

Evaluation runs over what prototype exports: structured prototype outputs (JSON) and recorded run
metadata, version snapshot in `docs/VERSIONS.md`, frozen benchmark scenarios and their Ground
Truth / Expected Execution Maps, and comparison procedure with metrics calculation run against
those maps. Same `src/core` logic produces outputs procedure consumes, so evaluation numbers
come from code that runs in IDE.

Deliberate deviation from normative spec, which framed harness as first-class deliverable.
Evaluation _logic_ is unchanged; only claim that it ships as separate CLI is dropped. Flag for
dissertation decision log.

## Consequences

- Repository and dissertation module listing agree by construction, and repository claims no
  component it does not implement.
- `commander` is removed from dependencies - it was there for CLI and is unused.
- Evaluation results come from prototype's exported JSON and run metadata compared to Ground Truth /
  Expected Execution Maps - documented procedure researcher runs, reproducible from exports and
  version snapshot.
- Empty output/data directories are kept in version control with `.gitkeep` so structure is
  reproducible from fresh clone.
- If small export or snapshot helper is added later, it lands only when it actually exists, with
  its own ADR - not described in advance.
