# Evaluation

Evaluation is chapter-5 procedure over structured prototype outputs. It drives same core IDE
drives, then measures output against frozen ground truth. Module depends on core; core never depends
on it, so `manualGroundTruth` is physically unable to reach analysis - methodological isolation is
module boundary, not promise.

## Steps

- **Scenario (`scenario.ts`).** SCENARIO entity: object, DML event, cluster (programmatic /
  declarative / mixed), expansion depth, and snapshot it runs against, plus benchmark provenance -
  fixed task prompt, starting point, complexity and expansion profile, link to its ground-truth
  record, why it is in set, and pinned versions - so selection is transparent and run reproduces.
- **Ground truth (`groundTruth.ts`).** GROUND_TRUTH set, sole home of `manualGroundTruth`. Describes
  the expected world, not the prototype's confidence decision: expected nodes and typed relationships
  (`invokes`, `writes`, `reads`, `triggers`, `depends_on`), each with `expectedPresence`, a
  `detectability` (`static-direct`, `static-inferred`, `risk-only`, `runtime-only`, `out-of-scope`),
  rationale, source, and adjudication (`scorable`, `ambiguous`, `boundary`, `excluded`), plus deliberate
  exclusions. The prototype decides confirmed or inferred itself. Ids follow same stable scheme
  reconstructed output uses; ground truth is hashed (sha256 over canonical JSON) before runs, and the
  hash is stored with results, so truth cannot be quietly tuned to output.
- **Comparison (`compare.ts`).** Diffs reconstructed nodes and edges against expected ones. Edge
  identity is `(from, to, relationship)`, so a right pair with the wrong relationship is not a free
  match. Only statically-detectable expected elements enter precision and recall; runtime-only and
  out-of-scope expectations are scored apart, and correct handling of a runtime-only edge is to leave
  it unresolved, not claim it. Reports node and edge precision and recall, edge F1, relationship
  accuracy, ordered path coverage, node phase-assignment accuracy, final-graph edge noise rate,
  final-graph omission rate, runtime-only handling, boundary-handling accuracy, and a confidence-state
  distribution. Adjudication decides scoring: `scorable` counts, `ambiguous` sits out of denominators,
  `boundary` is scored apart, `excluded` is never scored.
- **Metrics (`metrics.ts`).** Rolls scenarios up to overall and per-cluster figures with mean and
  normal-approximation interval, and shapes per-scenario and aggregate CSV. This is an engineering
  summary; the reported inference lives in the statistics tool.
- **Skeleton latency (`latency.ts`).** Tool first-paint time: L1 timing read from run meta, measured
  inside cascade. Per-repeat samples and CSV.
- **Human study (`human-study/`).** Optional, off the automated path. `ttfaf.ts` records operator
  time-to-first-actionable-feedback from timed candidate answers; `baseline.ts` records one operator
  session - task prompt, candidates, identified components with evidence, inspection log, timeout,
  counterbalanced condition order. Human-authored, walled off from analysis.
- **Runner (`runScenario.ts`).** Loads snapshot, runs core, compares, stamps ground-truth hash.
  Snapshot carries component bodies, so run parses offline.
- **Evaluation runner (`runner.ts`, `cli.ts`).** Ties the pieces into a reproducible run: core per
  scenario, determinism by double run, comparison, latency samples, and a manifest that stamps the
  freeze. `serializeBundle` shapes the output; the cli writes `results/<freeze-id>/`. Phases pilot,
  main, repeat, aggregate, run by `eval:*` scripts from repository root.
- **Calibration (`calibration.ts`).** Ranking-only: picks the weight set whose score best orders the
  output (confirmed above inferred above unresolved), by tier-score concordance. Reads reconstruction
  state and score, never ground truth, and runs on validation scenarios held out from evaluation. No
  reported metric depends on it, since state is rule-based.

## Metrics, exactly

- **node / edge precision** = TP / (TP + FP), **recall** = TP / (TP + FN), **edge F1** = harmonic
  mean, over statically-detectable scorable expected elements. Node TP is a scorable expected node
  whose id is claimed; edge TP is a scorable static expected edge matched by `(from, to, relationship)`.
- **relationship accuracy** = of expected pairs the tool found, share with the right relationship.
- **ordered path coverage** = (nodes placed in phase + matched edges from a placed node) / (static
  expected nodes + edges).
- **phase-assignment accuracy** = share of matched nodes placed in expected phase.
- **final edge noise rate** = FP / claimed edges (final-graph, not first-feedback).
- **final expected edge omission rate** = missed static-direct expected edges over that set.
- **runtime-only handling** = of expected runtime-only edges, how many the tool did not falsely claim.
- **boundary-handling accuracy** = share of boundary-adjudicated items the tool left unresolved or
  excluded rather than claimed; 1 when none apply.
- **confidence-state distribution** = counts of confirmed / inferred / unresolved / excluded across
  nodes and edges.

Claimed = reconstructed nodes or edges in confirmed or inferred state. Adjudication `scorable` counts,
`ambiguous` and `boundary` leave the standard denominators, `excluded` is never scored;
`runtime-only` and `out-of-scope` are scored apart, not as static misses.

## Pilot S01

Account update: Apex trigger split before and after with a dependency-record class link and one
dynamic SOQL a human knows targets Contact; before-save and after-save flows, after-save creating
Task; one validation rule. Tool recovers every expected node in its phase (node recall and precision
1, phase accuracy 1) and every statically-detectable edge (edge precision, recall, F1 and relationship
accuracy 1, no noise, ordered path coverage 1). The one runtime-only edge - the dynamic Contact
reference - is left unresolved rather than guessed, and scored as correctly handled, not as a recall
miss. Distribution reads eight confirmed and two unresolved: the two unresolved edges stand in for the
dynamic reference, uncertainty shown rather than dropped.

## Statistics

Inference lives outside this module, in `scripts/stats.py` - a standalone Python tool, standard
library only, that never imports the core and only reads csv the runner froze. It takes a
`results/<freeze-id>/` directory with `paired.csv` (`unit,metric,prototype,baseline`), optional
`outcomes.csv` (`unit,prototype_correct,baseline_correct`), and an optional `statistics-config.json`
naming the confirmatory family, alpha, seed, bootstrap and permutation rounds, and the zero-difference
fraction that switches Wilcoxon to the sign test. It writes `stats.json` and `stats.csv`: median and
IQR per arm, median difference with a seeded bootstrap interval, Wilcoxon signed-rank with a
matched-pairs rank-biserial effect size, exact sign test, seeded paired permutation sensitivity test,
Cohen's dz, and McNemar with a paired risk difference and interval. Holm correction applies only to
the confirmatory family. `npm run eval:stats -- results/<freeze-id>` runs it; `npm run
eval:stats:selftest` checks the maths against textbook inputs with no data present. Kept apart on
purpose, so the tool that judges the figures cannot reach the code that made them.

## Open, decided with human

- Pilot (S01) and the main benchmark are disjoint - `eval:main` refuses an empty or pilot-overlapping
  set. Main scenarios, **N**, and their human-authored ground truth are agreed and hashed before
  freeze.

## Files

| File             | Responsibility                                                   |
| ---------------- | ---------------------------------------------------------------- |
| `scenario.ts`    | SCENARIO type with benchmark provenance, loader, validation.     |
| `groundTruth.ts` | GROUND_TRUTH type - nodes, typed edges, adjudication - and hash. |
| `compare.ts`     | One-scenario comparison metrics.                                 |
| `metrics.ts`     | Aggregate by cluster with confidence intervals, CSV.             |
| `latency.ts`     | Skeleton first-paint latency samples and CSV.                    |
| `plan.ts`        | Pilot/main disjointness check for the benchmark.                 |
| `runScenario.ts` | Load, run core, compare, stamp ground-truth hash.                |
| `runner.ts`      | Run set, check determinism, assemble bundle and freeze manifest. |
| `cli.ts`         | Phase shell: load config, run, write `results/<freeze-id>/`.     |
| `calibration.ts` | Ranking-only weight search by tier-score concordance, held out.  |
| `human-study/`   | Optional operator TTFAF and baseline-session records.            |
