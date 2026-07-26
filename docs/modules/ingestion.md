# Ingestion

Ingestion is how tool gathers Salesforce metadata to analyse. It collects raw components (Apex
triggers, flows, validation rules, and so on) for one object and hands them to analysis core as one
snapshot. It never changes anything in org.

## Read-only guarantee

Everything that could talk to org goes through read-only guard (`readOnlyGuard.ts`). Query passes
only if it is one `SELECT` statement; anything that looks like DML (`insert`, `update`, `delete`,
...) or chained statement is rejected before it is ever sent. Allowed operations are `query`,
`describe`, and `list`. So tool cannot deploy, cannot write, and cannot run automation.

## Where metadata comes from

Two kinds of source, both feeding same component shape:

- **Offline (no network).**
  - `dxProjectReader.ts` reads local Salesforce DX project. It walks package directories and
    inventories source files by type and name. Where folder layout encodes object (validation rules
    live under `objects/<Object>/...`), it records object; for triggers and flows object is resolved
    later by parsers.
  - `orgSnapshot.ts` loads previously captured snapshot from JSON.
- **Live (read-only).**
  - `toolingClient.ts` runs Tooling API queries and describes. It does not know how to connect on
    its own: it is handed runner, so tests inject fake and touch no network. Every query still
    passes read-only guard first.
  - `metadataComponentDependencyClient.ts` reads direct dependency records over same injectable
    runner. Direct edges only - transitive links need expansion, not one query. Row cap is 2000; on
    cap result is marked truncated, and analysis degrades affected claims to `unresolved`.
  - `salesforceConnection.ts` builds real runner over `@salesforce/core` connection. It reuses
    whatever auth user's `sf` CLI already holds and stores no credentials. Thin adapter, exercised
    against real org rather than unit tests.

## Snapshot - unit of reproducibility

`OrgSnapshot` is captured state analysis runs against. Because analysis always runs against frozen
snapshot, same snapshot always gives same result, and run needs no network at all. That is what
makes evaluation reproducible.

`captureSnapshot.ts` assembles snapshot: merges components from sources, drops duplicates, sorts
into stable order, and stamps `meta`. Two rules keep snapshots deterministic:

- Timestamps live only in `meta`. Rest of snapshot is byte-identical across runs, and capture time
  is injected rather than read from clock, so tests and diffs stay stable.
- Only org alias is recorded - never credentials.

`writeSnapshot` saves snapshot as formatted JSON, and `loadSnapshot` reads it back and validates
it. Written then loaded, snapshot equals original - which is what lets captured org replay
offline.

Deep parsing of Flow XML and Apex headers lives in analysis core (`src/core/parse`), not here -
ingestion inventories and hands over raw records; core reads bodies through injected resolver.

## Files

| File                                   | Responsibility                                          |
| -------------------------------------- | ------------------------------------------------------- |
| `readOnlyGuard.ts`                     | Reject anything that is not read-only query or call.    |
| `orgSnapshot.ts`                       | Snapshot types, dependency records, loader, validation. |
| `dxProjectReader.ts`                   | Inventory local DX project (offline).                   |
| `toolingClient.ts`                     | Guarded, injectable Tooling API client.                 |
| `metadataComponentDependencyClient.ts` | Guarded dependency reader with row cap and truncation.  |
| `salesforceConnection.ts`              | Live `@salesforce/core` runner (auth via `sf` CLI).     |
| `captureSnapshot.ts`                   | Merge, dedupe, stamp, persist snapshot.                 |
