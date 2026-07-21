# ADR 002 - Repository layout and evaluation approach

## Context

Repository layout is documented in the dissertation, An earlier working sketch differed from 
dissertation in a few module names and in level of detail; this ADR reconciles them 
so code and the write-up agree.

Same sketch also framed evaluation as a separate implemented `Evaluation Harness` (a CLI, a
first-class deliverable). No such component exists or is planned: the placeholder `harness/`
directory held only a stub (`export {};` + a comment), no runner and no commands, and it produced
nothing. Describing a harness would make a false implementation claim.

## Decision

### Layout

Dissertation layout as the on-disk structure.

```
src/core          domain types, release-pinned phase model, confidence states,
                  scoring, risk indicators, progressive-discovery cascade (pure TS)
src/ingestion     orgSnapshot.ts, toolingClient.ts, metadataComponentDependencyClient.ts,
                  flowParser.ts, apexParser.ts, dxProjectReader.ts
src/extension     activation, commands, webview host, progress reporting, graph/list rendering
src/persistence   workspace cache, graph cache, run log, exporters (JSON, Markdown, SVG)
fixtures/         snapshots/, scenarios/, ground-truth/ (Expected Execution Maps)
config/           weights.json, thresholds, latency budgets, analysis settings
docs/             ADR/, RUNBOOK, VERSIONS, ASSUMPTIONS, modules/
results/          structured prototype outputs, run metadata, metric CSVs (results/summary tracked)
```

- ingestion dependency client is `metadataComponentDependencyClient.ts` (self-describing,
  and it names the API it wraps), not the sketch's `dependencyApi.ts`.
- `dxProjectReader.ts` is a first-class ingestion module.
- persistence keeps `graph cache` and the `run log` as distinct concerns from the workspace
  cache.

At this milestone the code directories carry a placeholder `index.ts` barrel each; the named
modules land in their own milestones (ingestion at M1, parsers at M3, and so on).

### Evaluation

Prototype is one workflow:

```
VS Code extension -> metadata ingestion -> TypeScript analysis core
  -> persistence / structured export -> developer-facing output
```

Evaluation carried out over what the prototype exports:
structured prototype outputs (JSON) and recorded run metadata, a version snapshot in
`docs/VERSIONS.md`, frozen benchmark scenarios and their Ground Truth / Expected Execution Maps,
and a comparison procedure with metrics calculation run against those maps. The same `src/core`
logic produces the outputs the procedure consumes, so evaluation numbers come from the code that
runs in the IDE.

This is a deliberate deviation from the normative specification, which framed the harness as a
first-class deliverable. The evaluation _logic_ is unchanged; only the claim that it ships as a
separate CLI is dropped. Flag for the dissertation decision log.

## Consequences

- epository and the dissertation module listing agree by construction, and the repository
  claims no component it does not implement.
- `commander` is removed from dependencies - it was there for the CLI and is unused.
- evaluation results come from the prototype's exported JSON and run metadata compared to Ground
  Truth / Expected Execution Maps - a documented procedure the researcher runs, reproducible from
  the exports and the version snapshot.
- Empty output/data directories are kept in version control with `.gitkeep` so the structure is
  reproducible from a fresh clone.
- If a small export or snapshot helper is added later, it will be introduced only when it
  actually exists, with its own ADR - not described in advance.
