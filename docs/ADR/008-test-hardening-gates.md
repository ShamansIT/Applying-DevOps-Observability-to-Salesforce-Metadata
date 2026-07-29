# ADR 008 - Test hardening and CI gates

Status: accepted
Date: 2026-07-28
Resolves: which quality gates block merge and how each is enforced

## Context

Hardening phase promotes several quality checks from ad-hoc to enforced gates, so regressions fail CI
rather than slip through. Each gate needed definition and enforcement point.

## Decision

### Coverage gate

`vitest.config.ts` sets coverage thresholds (lines, statements, functions at 85; branches at 70) over
`src/**`. Excluded: barrels (re-exports only), extension host glue and live Salesforce adapter (both
need VS Code or real org, covered by e2e smoke and manual runs), and pure type declarations. Core
sits far above threshold; gate catches drop, not target to chase. CI runs `npm run test:coverage`,
so coverage regression fails build.

### Determinism gate

Double-run deep-equal is promoted from single fixture to gate across every degrade path - offline,
full, expanded, and truncated - plus check that graph output is independent of injected clock.
Timings vary and are excluded. A difference is defect, so it fails build.

### Latency-budget gate

Budgets live in `config/budgets.json` as data (L1 P50, full-cascade P95), provisional until pilot
recalibration. Budget test runs pilot scenario repeatedly and checks percentiles against budgets.
Fixture runs sit far under budget, so gate catches real regression rather than noise.

### e2e smoke

One smoke runs under `@vscode/test-electron`: it loads repository as extension in real VS
Code and asserts its commands are registered. Registration, not interactive command runs, since
commands open dialogs. It needs display and VS Code download, so it runs on human machine and
in dedicated CI job with `xvfb`, not in offline unit run. Suite uses `node:assert`, so no extra
test framework is pulled in.

## Consequences

- Coverage, determinism and budget regressions block merge through one `test:coverage` step; e2e
  smoke is second CI job.
- Budgets and coverage thresholds are tunable data and config, so pilot recalibration changes numbers
  without code edits.
- Human dry-run of RUNBOOK is acceptance check: demo plus one pilot comparison reproduced from
  document alone.
