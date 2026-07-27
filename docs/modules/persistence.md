# Persistence

Persistence turns one run result into output surfaces. Exporters are pure and deterministic - no
timestamps, no locale, no random - so same graph yields byte-identical files, double-run stays
deep-equal, and comparison procedure matches by key. Each exporter reads one `ReconstructResult` and
returns string; extension host writes it to disk on demand.

## Exporters

- **JSON (`exportJson.ts`).** Structured export for comparison procedure: run meta, phase order,
  nodes, edges, risk. Timings are latency, not graph, so they are dropped here and belong to run log
  - keeping them out is what makes export byte-identical.
- **Markdown (`exportMarkdown.ts`).** Human review report: phase-grouped node list with states,
  scores and evidence, dependency-edge table, risk table split by character.
- **SVG (`exportSvg.ts`).** Phase-grouped tree with fixed geometry and state-coloured node boxes on
  white. Usable directly as dissertation figure, so figures come from tool rather than redrawn.

## Not here yet

- Workspace cache, graph cache, and run log are separate concerns and arrive when run needs to
  persist between sessions.

## Files

| File                | Responsibility                                         |
| ------------------- | ------------------------------------------------------ |
| `exportJson.ts`     | Structured JSON for comparison procedure (no timings). |
| `exportMarkdown.ts` | Human review report.                                   |
| `exportSvg.ts`      | Phase-grouped tree figure.                             |
