# Applying DevOps Observability to Salesforce Metadata

IDE-native, pre-deployment observability for Salesforce record-triggered execution flow.

Prototype reconstructs record-triggered execution flow for given Salesforce object and trigger
event **before deployment and without executing anything in org**. It orders participants at
**phase level** of Salesforce Order of Execution and attaches explicit evidence and confidence state
to every node and edge.

Research prototype (MSc), built around one analysis core:

- **VS Code extension** that renders phase-grouped, progressively-discovered flow map, and
- **structured exports** (JSON, run metadata, version snapshot) produced for developer review and
  later fed to evaluation procedure.

## Principles

- **Read-only.** Never writes to org - metadata reads and Tooling API queries only. No DML, no
  deploys, no telemetry.
- **Honesty over completeness.** Uncertainty is shown, never hidden. Constructs that cannot be
  statically resolved are marked `unresolved`; out-of-scope behaviour is marked `excluded` with
  reason. Nothing is guessed.
- **Determinism.** Same inputs produce byte-identical outputs.
- **Release pinning.** Platform behaviour traces to release-pinned official documentation; tool and
  API versions are pinned and recorded.

## Confidence states

Every node and edge carries one of: `confirmed`, `inferred`, `unresolved`, `excluded`.

## Architecture

One workflow: **VS Code extension -> metadata ingestion -> TypeScript analysis core -> persistence /
structured export -> developer-facing output**. Analysis core is pure TypeScript (no `vscode`
imports), so its structured outputs are reproducible and reusable by evaluation procedure.

```
src/core          domain types, phase model, scoring, discovery cascade (pure TS)
src/ingestion     org snapshot, Tooling client, MetadataComponentDependency client, Flow/Apex parsers
src/extension     activation, commands, webview host, progressive rendering
src/persistence   workspace cache, graph cache, run log, exporters (JSON, Markdown, SVG)
src/evaluation    reconstruction evaluation: scenarios, ground truth, comparison, metrics, calibration
src/experiment    automated mutation-based experiment: mutation, oracle, race, metrics, storage
fixtures/         org snapshots, scenarios, Ground Truth / Expected Execution Maps
config/           weights, thresholds, latency budgets
docs/             RUNBOOK, VERSIONS, module notes
results/          structured prototype outputs, run metadata, metric CSVs
```

## Org access

Auth is delegated to user's `sf` CLI or `@salesforce/core` connection; nothing stores credentials.
All queries are read-only.
