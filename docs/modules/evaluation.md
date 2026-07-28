# Evaluation

Evaluation is chapter-5 procedure over structured prototype outputs. It drives same core IDE
drives, then measures output against frozen ground truth. Module depends on core; core never depends
on it, so `manualGroundTruth` is physically unable to reach analysis - methodological isolation is
module boundary, not promise.

## Steps

- **Scenario (`scenario.ts`).** SCENARIO entity: object, DML event, cluster (programmatic /
  declarative / mixed) for chapter-5 split, expansion depth, and snapshot it runs against.
- **Ground truth (`groundTruth.ts`).** GROUND_TRUTH_EDGE set, sole home of `manualGroundTruth`. Ids
  follow same stable scheme reconstructed edges use, so comparison matches by key. Ground truth is
  hashed (sha256 over canonical JSON) before runs, and hash is stored with results, so truth cannot
  be quietly tuned to output.
- **Comparison (`compare.ts`).** Diffs reconstructed edges against expected edges. Only claimed edges
  (confirmed or inferred) count as positives - unresolved and excluded are explicit uncertainty, not
  false claims, so they never hurt precision. Reports precision, recall, F1, coverage, noise,
  false-omission rate, phase-ordering accuracy.
- **Metrics (`metrics.ts`).** Rolls scenarios up to overall and per-cluster figures with mean and
  normal-approximation confidence interval, and shapes per-scenario and aggregate CSV.
- **TTFAF (`ttfaf.ts`).** Time-to-first-actionable-feedback is L1 timing read from run meta, measured
  inside cascade. Writes CSV shaped same way for prototype and baseline, so they line up.
- **Runner (`runScenario.ts`).** Loads snapshot, runs core, compares, stamps ground-truth hash.
  Snapshot carries component bodies, so run parses offline.
- **Calibration (`calibration.ts`).** Searches weight and threshold candidates on pilot subset and
  picks best mean F1, so scoring is fit to data rather than hand-set.

## Metrics, exactly

- **precision** = TP / (TP + FP), **recall** = TP / (TP + FN), **F1** = harmonic mean.
- **coverage** = recall (share of expected edges found).
- **noise** = FP / claimed (share of claimed edges that are spurious).
- **false-omission rate** = missed expected-confirmed / expected-confirmed (worst omissions).
- **phase-ordering accuracy** = share of matched edges whose from-node sits in expected phase.

Claimed = reconstructed edges in confirmed or inferred state. Match is by `(from, to)` on stable ids.

## Pilot S01

Account update: Apex trigger split before and after with dependency-record class reference and one
dynamic SOQL human knows targets Contact; before-save and after-save flows, after-save creating
Task; one validation rule. Tool reproduces confirmed dependency edges and inferred flow edge
(precision 1, no noise), and misses dynamic Contact reference rather than guessing (recall 0.75) -
which is point: tool does not claim what it cannot statically resolve, and evaluation shows
recall cost of that honesty.

## Open, decided with human

- **N** and scenarios **S02–S06** are not fixed here. Pilot is S01 only; rest are agreed before
  freeze. Ground truth for real scenarios is human-authored and reviewed, then hashed.

## Files

| File             | Responsibility                                       |
| ---------------- | ---------------------------------------------------- |
| `scenario.ts`    | SCENARIO type, loader, validation.                   |
| `groundTruth.ts` | GROUND_TRUTH_EDGE type, loader, canonical-JSON hash. |
| `compare.ts`     | One-scenario comparison metrics.                     |
| `metrics.ts`     | Aggregate by cluster with confidence intervals, CSV. |
| `ttfaf.ts`       | Time-to-first-actionable-feedback samples and CSV.   |
| `runScenario.ts` | Load, run core, compare, stamp ground-truth hash.    |
| `calibration.ts` | Search weight candidates for best mean F1 on pilot.  |
