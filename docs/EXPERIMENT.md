# Evaluation and experiment

## Scope

- Primary artefact: the read-only prototype that reconstructs record-triggered execution flow from local
  metadata and scores node/edge/relationship/phase/path fidelity, determinism and latency.
- Supplementary: a shift-left race (prototype vs Salesforce validation) for directly supported scenarios.
- Not: universal pass/fail prediction, runtime simulation, deployment gating - deferred.

## Offline commands (no org)

```
npm run exp:reconstruct              # nine candidates -> real core -> metrics -> checksummed bundle
npm run exp:aggregate -- <id>        # re-roll descriptive summary (median, IQR, bootstrap CI)
npm run exp:stats     -- <id>        # descriptive report; hypotheses stay not_run
npm run exp:package   -- <id>        # validate checksums, write gzip archive + sha256
npm run exp:selftest | exp:generate | exp:validate-plan | exp:walking-skeleton | exp:freeze-plan
```

The candidate register (`pilotCandidates.ts`) is nine provisional scenarios - declarative/programmatic/
mixed x valid/static-failure/risk - each `salesforceValidated=false`. Bundle lands in
`results/reconstruct/<id>/` with a manifest (versions, hashes, seeds, `orgExecutionStatus: not_run`).

## Real-org commands (operator, needs a Dev Hub)

```
npm run exp:org:check        -- --dev-hub <alias> [--target-org <alias>]   # read-only, no scratch
npm run exp:readiness:org    -- --run-id <id> --dev-hub <alias>            # R01-R03 gate
npm run exp:pilot:freeze-plan -- --run-id <id> --seed <seed>              # freeze the nine-scenario plan
npm run exp:pilot:org        -- --run-id <id> --dev-hub <alias> [--resume] # formal pilot, nine candidates
```

The formal pilot runs the **nine candidate scenarios** (never the generated benchmark, never R01-R03),
frozen to **metadata-validation only** - test-execution and runtime-transaction oracle stages are
deferred, not built. The frozen plan carries the candidate-register hash; a run refuses to start or
resume if commit, register or plan drift. Each attempt is written and checksummed the moment it
completes, so `--resume` continues without overwriting a completed valid attempt.

All deploys are polled to a final result (job acceptance is never an outcome; first-actionable and final
feedback are recorded apart, each polling event timestamped by the monotonic clock). Prototype
determinism is judged on the whole canonical graph - nodes, edges, relationships, phases, states,
evidence and risk - not the prediction category. Timing is a single paired observation per scenario from
one shared t0, over a deterministic balanced subset; it is not repeated paired races.

Order: `org:check` -> `readiness:org` -> review the bundle -> (READY) adjudicate candidate ground truth ->
`pilot:freeze-plan` -> `pilot:org`. `main:*` is blocked until a reviewed pilot authorises it. Real runs
are the operator's; nothing here fabricates an org outcome (org-derived fields stay `not_run`), and none
of this runs in CI. `exp:package` refuses to archive an invalid or tampered bundle and never overwrites
an existing archive.

## Common blockers

- `org:check` blocked: install `sf`, authenticate the Dev Hub, fix API version or storage permissions.
- Scratch org not ready: Dev Hub limit or not enabled - the run stops before any scenario.
- Clean topology not deployable: fix the base metadata; a mutated failure cannot be attributed otherwise.
- Deploy never settles: raised as retryable infrastructure, not a product pass or fail.

## Threats to validity

- Prototype is not a full validator: it reconstructs static flow, does not compile or simulate runtime;
  detection covers only statically-provable failures the rules implement.
- Snapshot fidelity is exact for generated topologies; arbitrary hand-authored projects are out of scope.
- Prototype and oracle judge the same checksum-verified bytes, but generated metadata is not proven
  faithful to production usage.
- Oracle coverage: dry-run catches compile/reference/test failures; runtime needs a scratch org and an
  anonymous-apex probe (describe-fallback probes flagged for review).
- Single author, mock-tested integration: the scratch-org lifecycle and runtime probe are unverified
  against a real org; small samples and one pinned API version.
- Reporting rule: no hypothesis is supported or rejected until real frozen main results exist. Green
  offline is evidence the machinery works, not evidence about the research questions.
