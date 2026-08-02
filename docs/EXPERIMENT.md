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
npm run exp:org:check     -- --dev-hub <alias> [--target-org <alias>]   # read-only, no scratch
npm run exp:readiness:org -- --run-id <id> --dev-hub <alias>            # R01-R03 gate
npm run exp:walking-skeleton:org | exp:pilot:org | exp:main:org -- <freeze-id> <dev-hub>
```

All deploys are polled to a final result, so job acceptance is never mistaken for an outcome. Order:
`org:check` -> `readiness:org` -> review the bundle -> (READY) adjudicate candidate ground truth ->
`freeze-plan` -> pilot. Real runs are the operator's; nothing here fabricates an org outcome, and none of
this runs in CI.

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
