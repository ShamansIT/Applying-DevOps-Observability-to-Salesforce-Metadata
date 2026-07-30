# Automated mutation-based experiment

Design and runbook for the automated evaluation. It replaces human-timing baselines with an objective
race: for one frozen base metadata project, apply one controlled mutation, then from a shared start run
the prototype preflight analysis against the standard Salesforce workflow, and compare which produced
correct actionable feedback first. Human interaction speed is not a metric.

The analysis core stays read-only and never deploys. The experiment harness (`src/experiment/`) is
separate and may drive Salesforce CLI against disposable scratch orgs; it never imports the core's
write path and never lets ground truth reach analysis.

## Flow

```
frozen base project
  -> one deterministic controlled mutation        (mutation.ts, materialise.ts)
  -> materialised mutated project + manifest
  -> t0
     |-- prototype preflight analysis             (prototypeAdapter.ts)
     |-- sf project deploy start --dry-run oracle  (oracle.ts)
  -> race timing and lead time                     (race.ts)
  -> normalised scenario run                       (experimentMetrics.ts)
  -> immutable, checksummed, redacted result       (storage.ts)
```

## Modules

- **mutation.ts** - twelve deterministic mutation families over a file map; a manifest records changed
  files and hashes, expected validity, failure class, affected components, detectability, and which
  oracle stages must run. A mutation that would be a silent no-op is refused.
- **project.ts / materialise.ts** - content-addressed checksums, read and write a project file map, and
  build a scenario (mutated files plus `mutation-manifest.json`) verified against the base checksum.
- **prototypeAdapter.ts** - runs the read-only core and categorises its output into a prediction
  (`blocking_finding`, `material_warning`, `no_blocking_finding`, `unresolved`, `out_of_scope`,
  `prototype_failure`). `no_blocking_finding` is never a proven pass; the org run is still required.
- **oracle.ts** - Salesforce CLI argument arrays (never shell strings), a dry-run deploy with local
  tests, and normalisation of the JSON into an outcome and failure class. The runner is injected, so it
  is tested against canned responses with no org.
- **race.ts** - monotonic-clock timing, prototype and oracle from one t0, TTFAF and lead time.
- **experimentMetrics.ts** - detection recall and precision over static-detectable invalid scenarios,
  false-warning rate on valid scenarios, feedback-timing summaries, and a policy-gate simulation.
- **storage.ts** - immutable, checksummed result bundle with secrets redacted.
- **random.ts / schedule.ts / power.ts** - seeded generator, blocked-randomised execution schedule with
  a uniqueness guard, and simulation-based sample-size power planning.

## Commands

Offline, no org:

```
npm run exp:selftest                 # run the whole pipeline in memory and check it wires together
npm run exp:schedule scenarios.json 42   # print a frozen blocked-randomised schedule
npm run exp:power pilot-diffs.json 7     # print a sample-size power plan
```

Real scratch-org runs (deploy, tests, runtime transaction) are a separate, manually dispatched,
credentialed job. They need a Dev Hub and are the operator's to run; nothing in this repository
fabricates an org outcome.

## Benchmark plan

- **Pilot:** 18 scenarios (3 clusters x 3 complexity x 2 valid/invalid), excluded from main.
- **Main:** at least 72 scenarios (9 cluster-complexity cells x 8 structurally distinct mutations),
  disjoint from pilot, structurally varied - not clones of one topology.
- **Determinism:** every main scenario runs through the prototype five times for P50/P95 and semantic
  determinism; these are technical replicates, not independent observations.
- **Timing subset:** a balanced subset runs paired race repetitions; aggregated to scenario level
  before inference.

## What is built versus what is manual

Built and offline-tested here: the mutation model, materialiser, prototype categoriser, mock-tested
oracle adapter and scratch-org argument arrays, race timing, metrics, storage, schedule and power
planning, and the offline self-test. **Not done here:** real scratch-org execution, and the 8 base
topologies plus 18 pilot and 72 main scenarios, which are deployable-metadata content the operator
authors against a Dev Hub. No real main results exist yet; the harness is the frame they land in.
