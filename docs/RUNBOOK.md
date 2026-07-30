# Runbook

End-to-end demo of prototype: build, run one analysis on fixture snapshot, read phase-grouped
webview, and export structured output. Offline throughout - no org connection needed.

## Prerequisites

- Node 22 or newer.
- VS Code 1.125 or newer.
- Dependencies installed: `npm install`.

## Build

```
npm run build:extension
```

This bundles extension host to `dist/extension/index.cjs` and copies runtime data files
(`phases.v67.json`, `weights.json`) to `dist/assets/`, so packaged code resolves them without source
paths.

## Run analysis in VS Code

1. Open repository folder in VS Code.
2. Press `F5` (Run Extension) to launch extension development host.
3. In new window, open Command Palette and run `SF Observer: Reconstruct record-triggered execution flow`.
4. Pick snapshot `fixtures/snapshots/s01-account-update.json`.
5. Enter object `Account`, then pick event `update`.

Webview opens beside editor. It renders phase skeleton first (after L1), then upgrades to full report:
phase-grouped tree in pinned Order-of-Execution order, state badge per node (confirmed / inferred /
unresolved / excluded), evidence popover on each node, state and type filters, dependency-edge table,
seven risk indicators split by deterministic and heuristic character, and SVG tree figure.

## Export

With report open, run any of:

- `SF Observer: Export last run as JSON` - structured export for comparison procedure.
- `SF Observer: Export last run as Markdown` - human review report.
- `SF Observer: Export last run as SVG` - phase-grouped tree, usable directly as dissertation figure.

Each prompts for save location and writes deterministic output: same snapshot and pins yield
byte-identical files across runs.

## What S01 exercises

- Before-save and after-save flows, Apex trigger split across before and after phases, validation
  and duplicate rules, legacy workflow rule and Process Builder.
- One draft flow marked `excluded` with reason `inactive`.
- Dynamic Apex SOQL surfaced as `unresolved` edge with reason.
- Process Builder writing back to Account trips recursion / re-entry risk indicator.

## Tests and gates

Run full suite with coverage and regression gates:

```
npm run test:coverage
```

This runs every unit test plus determinism gate (double-run deep-equal across offline, full,
expanded and degraded paths) and latency-budget gate (L1 P50 and full-cascade P95 against
`config/budgets.json`). Coverage thresholds in `vitest.config.ts` fail run on drop. CI runs same
command, so regression blocks merge.

## e2e smoke

```
npm run test:e2e
```

Downloads pinned VS Code, loads this repository as extension, and checks its commands are registered.
Needs display; on headless machine or CI wrap with `xvfb-run -a`.

## Reproduce pilot comparison

S01 pilot runs snapshot -> run -> comparison and reports metrics:

```
npx vitest run test/evaluation/pilot.test.ts
```

It loads `fixtures/scenarios/S01.json`, drives same core IDE drives against S01 snapshot, compares
against hashed ground truth in `fixtures/ground-truth/S01.json`, and asserts node and edge recall and
precision 1, relationship accuracy 1, ordered path coverage 1, and the one runtime-only reference
(dynamic Contact SOQL) left unresolved rather than guessed - scored as correctly handled, not a miss.

## Evaluation run and statistics

Run the frozen-results pipeline from repository root:

```
npm run eval:pilot
```

This builds the evaluation bundle (`dist/eval/cli.mjs`), runs core over the scenarios in
`config/eval/pilot.json`, checks determinism by a double run, and writes `results/<date>-pilot/` with
`manifest.json` (freeze id, versions, per-scenario ground-truth hash, determinism stamp),
`metrics-scenario.csv`, `metrics-aggregate.csv`, `latency.csv`, and `graphs/<id>.json`. `results/` is
git-ignored except the committed summary.

`npm run eval:main` runs the main benchmark in `config/eval/main.json`, which must be **disjoint from
pilot**: S01 stays pilot-only, and `eval:main` refuses an empty set or any scenario also used in
pilot. Append main scenarios as `scenario` / `groundTruth` pairs (S02 onward). `npm run eval:repeat`
runs the same main set more times for a latency distribution. `npm run eval:aggregate -- --freeze
<id>` re-rolls an existing run's metrics without touching core.

Statistics live in a separate Python tool, outside vitest and the core:

```
npm run eval:stats:selftest                 # checks the maths against textbook inputs, no data needed
npm run eval:stats -- results/<freeze-id>   # median/iqr, wilcoxon, sign, bootstrap, holm, mcnemar
```

`eval:stats` reads `paired.csv` (`unit,metric,prototype,baseline`) and optional `outcomes.csv`
(`unit,prototype_correct,baseline_correct`) from the run directory - the human-collected baseline and
assisted figures - and writes `stats.json` and `stats.csv`. Needs Python 3 on the path.

## Verification checklist

Reproducible from this document alone:

- [ ] `npm ci` installs cleanly.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:coverage` all pass.
- [ ] `npm run build:extension` produces `dist/extension/index.cjs` and `dist/assets/`.
- [ ] `F5` opens extension host; reconstruct command renders S01 skeleton then report.
- [ ] JSON, Markdown and SVG export commands each write file.
- [ ] `npx vitest run test/evaluation/pilot.test.ts` reproduces pilot comparison.
- [ ] `npm run eval:pilot` writes `results/<date>-pilot/` with a deterministic manifest.
- [ ] `npm run eval:stats:selftest` passes the statistics self-test.
- [ ] `npm run test:e2e` (with display) passes command-registration smoke.

## Notes

- Headless batch generation of exports for many scenarios arrives with evaluation procedure, which
  reads scenario and ground-truth files and drives same core.
- Degraded runs (truncated dependency query, missing bodies) still complete; `meta` records degrade
  flags so degraded run is never mistaken for full one.
