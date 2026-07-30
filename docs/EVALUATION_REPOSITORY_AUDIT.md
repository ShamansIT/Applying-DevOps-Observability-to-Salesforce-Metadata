# Evaluation repository audit

Snapshot of the repository before the move to an automated, mutation-based evaluation. Records what
works now, what conflicts with the new methodology, and which known issues are still present at this
commit.

## Environment

- Commit: `1bb6c69` on `main`, working tree clean.
- Package version: `0.0.1`.
- Node: v24.14.0. npm: 11.9.0. Python: 3.12.0.
- Salesforce CLI: present, `@salesforce/cli` 2.119.8 (update to 2.144.6 available).
- Dev Hub / scratch-org capacity: not verified from this machine - real org runs are unconfirmed.
- Pinned Salesforce API for the phase model: 67.0.

## Test status

- `npm run typecheck` - clean.
- `npm run test` - 198 passing across 30 files.
- `npm run lint` - clean.
- `npm run test:coverage` - passes with thresholds (checked earlier this session).
- `npm run build:extension` - builds (two harmless `import.meta` cjs warnings; extension loads assets
  lazily via `extensionUri`, so they do not affect activation).
- `npm run eval:stats:selftest` - passes.
- `npm run test:e2e` - NOT run here (needs a display); runs on CI under xvfb.

Do not read the green suite as "the evaluation is done": those are unit and pilot assertions plus one
fixture scenario (S01). No org-side results exist.

## What works now

- Read-only analysis core: inventory, phase classification, reference extraction, assembly, optional
  expansion, risk indicators. Deterministic, offline, never deploys or mutates an org.
- Rule-based confidence: state assigned at creation, score for ranking only.
- Evaluation layer: scenario and ground-truth schemas, comparison metrics, aggregate, skeleton
  latency, procedural (human) TTFAF, baseline session record, ranking-only calibration.
- Reproducible runner: `eval:pilot/main/repeat/aggregate`, `results/<freeze-id>/` package with a
  manifest, ground-truth hashing, double-run determinism check.
- Separate Python statistics tool with a self-test.

## What conflicts with the new methodology

The current evaluation is built around a human operator timed in VS Code. The new design is an
automated race: prototype static preflight against Salesforce `deploy --dry-run` (and, where needed,
scratch-org deploy plus tests plus a scripted runtime transaction), from a shared start, with a
mutation as the controlled independent variable. Consequences:

- Human-timing modules (`ttfaf.ts` operator flow, `baseline.ts`) move out of the primary path - kept
  only as optional usability material.
- The runner must gain a headless prototype adapter, a Salesforce CLI oracle adapter, a mutation
  generator and materialiser, scratch-org lifecycle, race-mode timing, and richer result storage.
- Ground truth must describe the expected world (presence, detectability) rather than prescribe the
  prototype's confidence state.

## Known issues at this commit

Verified against current HEAD.

| #   | Issue                                                                                                                          | Status                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | pilot and main configs both list S01                                                                                           | present                                                                  |
| 2   | S01 used as both pilot and main                                                                                                | present                                                                  |
| 3   | RUNBOOK describes human-collected baseline                                                                                     | present                                                                  |
| 4   | `baseline.ts` models a manual operator session                                                                                 | present (by design so far)                                               |
| 5   | `ttfaf.ts` defines TTFAF via human candidate answers                                                                           | present                                                                  |
| 6   | runner only runs prototype vs ground truth                                                                                     | present                                                                  |
| 7   | no Salesforce validation adapter                                                                                               | absent - to build                                                        |
| 8   | no mutation generator or materialiser                                                                                          | absent - to build                                                        |
| 9   | no automated org-side oracle                                                                                                   | absent - to build                                                        |
| 10  | edge matching ignores relationship type                                                                                        | present (matches `from`+`to` only)                                       |
| 11  | ground truth requires a prototype confidence state (`expected`)                                                                | present                                                                  |
| 12  | boundary handling accepts an `inferred` claim as handled                                                                       | present                                                                  |
| 13  | noise is only final false-positive edge proportion                                                                             | present                                                                  |
| 14  | false-omission is only missed expected-confirmed final edges                                                                   | present                                                                  |
| 15  | aggregate uses arithmetic mean and normal-approximation CI                                                                     | present                                                                  |
| 16  | statistics tool lacks permutation, rank-biserial, paired risk difference, binary CI, frozen confirmatory family, decision rule | present                                                                  |
| 17  | manifest does not record the full frozen configuration                                                                         | present (partial manifest)                                               |
| 18  | latency does not preserve all stage timings                                                                                    | partial - per-layer timings exist in `meta.timings`, not surfaced to CSV |
| 19  | results do not include raw Salesforce CLI responses                                                                            | not applicable yet - no CLI adapter                                      |
| 20  | packaging does not create a checksummed archive                                                                                | present                                                                  |

## Prototype-side gap that affects scoring

The reconstructed edges carry only `kind: 'dependency'`; they do not carry a typed relationship
(`invokes`, `writes`, `reads`, `triggers`, `depends_on`). Relationship-type-aware edge matching (issue
10 and the impact-reconstruction metrics) therefore needs the extractor to emit a relationship type
first. This is core work, not just a comparison-key change.

## Files to modify

- `config/eval/pilot.json`, `config/eval/main.json` - disjoint sets, validated.
- `src/evaluation/compare.ts` - relationship-typed edge identity, boundary strictness, metric renames,
  separate final-graph and early-feedback metrics.
- `src/evaluation/groundTruth.ts` - expected-world fields instead of prescribed confidence.
- `src/evaluation/metrics.ts` - label aggregate as engineering summary or move to median/IQR.
- `src/evaluation/runner.ts` - headless prototype adapter, oracle, race timing.
- `src/core/cascade/extract.ts` - emit relationship types on edges.
- `scripts/stats.py` - permutation, rank-biserial, paired risk difference, binary CI, frozen family,
  decision rule.

## Optional legacy to keep

- `baseline.ts`, human `ttfaf.ts`, and the human-study parts of the RUNBOOK - retained as optional
  usability evaluation, renamed or moved so they are not on the automated primary path.

## Real versus fixture

- Real: unit and pilot assertions, S01 reconstruction numbers (node recall/precision 1, edge recall
  0.75, ordered path coverage 0.889).
- Fixture / not yet real: everything org-side; no mutation runs, no dry-run oracle, no frozen main
  results. Tables in the dissertation cannot be filled from real data until the automated harness runs
  against orgs.
