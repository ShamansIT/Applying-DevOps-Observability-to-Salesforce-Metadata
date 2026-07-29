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
- **Ground truth (`groundTruth.ts`).** GROUND_TRUTH set, sole home of `manualGroundTruth`. Holds
  expected nodes and typed relationships (`invokes`, `writes`, `reads`, `triggers`, `depends_on`),
  each with rationale, source, and adjudication (`scorable`, `ambiguous`, `boundary`, `excluded`),
  plus deliberate exclusions. Ids follow same stable scheme reconstructed output uses, so comparison
  matches by key. Ground truth is hashed (sha256 over canonical JSON) before runs, and hash is stored
  with results, so truth cannot be quietly tuned to output.
- **Comparison (`compare.ts`).** Diffs reconstructed nodes and edges against expected ones. Only
  claimed elements (confirmed or inferred) count as positives - unresolved and excluded are explicit
  uncertainty, not false claims, so they never hurt precision. Reports node and edge precision and
  recall, edge F1, ordered path coverage, node phase-assignment accuracy, noise, false-omission rate,
  boundary-handling accuracy, and a confidence-state distribution. Adjudication decides scoring:
  `scorable` counts, `ambiguous` sits out of denominators, `boundary` is scored apart, `excluded` is
  never scored.
- **Metrics (`metrics.ts`).** Rolls scenarios up to overall and per-cluster figures with mean and
  normal-approximation confidence interval, and shapes per-scenario and aggregate CSV.
- **Skeleton latency (`latency.ts`).** Tool first-paint time: L1 timing read from run meta, measured
  inside cascade. Per-repeat samples and CSV, same columns for prototype and baseline.
- **Procedural TTFAF (`ttfaf.ts`).** Operator time-to-first-actionable-feedback: from timed candidate
  answers, TTFAF is elapsed time to the first the operator would act on, and correctness at TTFAF is
  that answer adjudicated after the run. Human-authored records, walled off from analysis. This is the
  TTFAF the evaluation reports; skeleton latency is a separate tool timing.
- **Baseline session (`baseline.ts`).** One operator attempt under one condition: task prompt, timed
  candidates, identified components and relationships with evidence, timed inspection log, timeout, and
  counterbalanced condition order. TTFAF is derived from the session's own candidates, so timing and
  session share one source.
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
  mean. Node TP is a scorable expected node whose id is claimed; edge TP is a scorable expected edge
  matched by `(from, to)`.
- **ordered path coverage** = (nodes placed in phase + matched edges from a placed node) / (scorable
  expected nodes + edges). Backbone reconstructed, not a rename of recall.
- **phase-assignment accuracy** = share of matched nodes placed in expected phase.
- **noise** = FP / claimed edges (share of claimed edges that are spurious).
- **false-omission rate** = missed expected-confirmed / expected-confirmed (worst omissions).
- **boundary-handling accuracy** = share of boundary-adjudicated items the tool did not over-claim; 1
  when none apply.
- **confidence-state distribution** = counts of confirmed / inferred / unresolved / excluded across
  nodes and edges.

Claimed = reconstructed nodes or edges in confirmed or inferred state. Match is on stable ids -
node id, or edge `(from, to)`. Adjudication `scorable` counts, `ambiguous` and `boundary` leave the
standard denominators, `excluded` is never scored.

## Pilot S01

Account update: Apex trigger split before and after with dependency-record class reference and one
dynamic SOQL human knows targets Contact; before-save and after-save flows, after-save creating
Task; one validation rule. Tool recovers every expected node in its phase (node recall and precision
1, phase accuracy 1) and reproduces confirmed dependency and flow edges (edge precision 1, no noise),
and misses dynamic Contact reference rather than guessing (edge recall 0.75, ordered path coverage
0.889) - which is point: tool does not claim what it cannot statically resolve, and evaluation shows
recall cost of that honesty. Distribution reads eight confirmed and two unresolved: the two
unresolved edges stand in for the dynamic reference, uncertainty shown rather than dropped.

## Statistics

Inference lives outside this module, in `scripts/stats.py` - a standalone Python tool, standard
library only, that never imports the core and only reads csv the runner froze. It takes a
`results/<freeze-id>/` directory with `paired.csv` (`unit,metric,prototype,baseline`) and optional
`outcomes.csv` (`unit,prototype_correct,baseline_correct`), and writes `stats.json` and `stats.csv`:
median and IQR per arm, median difference with a seeded bootstrap interval, Wilcoxon signed-rank, sign
test, Holm correction across the metric family, and McNemar on paired outcomes. `npm run eval:stats --
results/<freeze-id>` runs it; `npm run eval:stats:selftest` checks the maths against textbook inputs
with no data present. Kept apart on purpose, so the tool that judges the figures cannot reach the code
that made them.

## Open, decided with human

- **N** and scenarios **S02–S06** are not fixed here. Pilot is S01 only; rest are agreed before
  freeze. Ground truth for real scenarios is human-authored and reviewed, then hashed.

## Files

| File             | Responsibility                                                   |
| ---------------- | ---------------------------------------------------------------- |
| `scenario.ts`    | SCENARIO type with benchmark provenance, loader, validation.     |
| `groundTruth.ts` | GROUND_TRUTH type - nodes, typed edges, adjudication - and hash. |
| `compare.ts`     | One-scenario comparison metrics.                                 |
| `metrics.ts`     | Aggregate by cluster with confidence intervals, CSV.             |
| `latency.ts`     | Skeleton first-paint latency samples and CSV.                    |
| `ttfaf.ts`       | Procedural operator TTFAF record, outcome, stats and CSV.        |
| `baseline.ts`    | Operator session record - answers, evidence, inspection log.     |
| `runScenario.ts` | Load, run core, compare, stamp ground-truth hash.                |
| `runner.ts`      | Run set, check determinism, assemble bundle and manifest.        |
| `cli.ts`         | Phase shell: load config, run, write `results/<freeze-id>/`.     |
| `calibration.ts` | Ranking-only weight search by tier-score concordance, held out.  |
