# Applying DevOps Observability to Salesforce Metadata

IDE-native, pre-deployment observability for Salesforce record-triggered execution flow.

Prototype `Applying DevOps Observability to Salesforce Metadata` reconstructs record-triggered
execution flow for given Salesforce object and trigger event
**before deployment and without executing anything in the org**. It orders participants
at **phase level** of the Salesforce Order of Execution and attaches explicit evidence
and confidence state to every node and edge.

Project is a research prototype (MSc). It is a single prototype built around one analysis core:

- a **VS Code extension** that renders a phase-grouped, progressively-discovered flow map, and
- **structured exports** (JSON, run metadata, version snapshot) that the prototype produces for
  developer review and that later feed evaluation procedure.

## Principles

- **Read-only.** Tool never writes to a Salesforce org - metadata reads and Tooling API
  queries only. No DML, no deploys, no telemetry.
- **Honesty over completeness.** Uncertainty is displayed, never hidden. Constructs that cannot
  be statically resolved are marked `unresolved`; out-of-scope behaviour is marked `excluded`
  with reason. Nothing is guessed.
- **Determinism.** Same inputs produce byte-identical outputs.
- **Release pinning.** Platform behaviour traces to release-pinned official documentation; tool
  and API versions are pinned and recorded.

## Confidence states

Every node and edge carries one of: `confirmed`, `inferred`, `unresolved`, `excluded`.

## Architecture

One prototype workflow: **VS Code extension -> metadata ingestion -> TypeScript analysis core ->
persistence / structured export -> developer-facing output**. The analysis core is a pure
TypeScript library (no `vscode` imports), so its structured outputs are reproducible and can be
reused by evaluation procedure.

```
src/core          domain types, phase model, scoring, discovery cascade (pure TS)
src/ingestion     org snapshot, Tooling client, MetadataComponentDependency client, Flow/Apex parsers
src/extension     activation, commands, webview host, progressive rendering
src/persistence   workspace cache, graph cache, run log, exporters (JSON, Markdown, SVG)
fixtures/         org snapshots, scenarios, Ground Truth / Expected Execution Maps
config/           weights, thresholds, latency budgets
docs/             ADRs, RUNBOOK, VERSIONS, ASSUMPTIONS, module notes
results/          structured prototype outputs, run metadata, metric CSVs
```

## Org access

Authentication is delegated to user's `sf` CLI or `@salesforce/core` connection; the tool
never stores credentials. All queries are read-only.
