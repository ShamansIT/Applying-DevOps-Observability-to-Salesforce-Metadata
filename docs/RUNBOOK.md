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

## Notes

- Headless batch generation of exports for many scenarios arrives with evaluation procedure, which
  reads scenario and ground-truth files and drives same core.
- Degraded runs (truncated dependency query, missing bodies) still complete; `meta` records degrade
  flags so degraded run is never mistaken for full one.
