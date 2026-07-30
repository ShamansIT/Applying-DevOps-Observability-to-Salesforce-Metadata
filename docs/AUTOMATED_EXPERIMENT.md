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
- **preflight.ts** - conservative diagnostic layer over the reconstruction. Emits `blocking_finding`
  only on direct static evidence of a deterministic failure - a source reference to an Apex class,
  trigger or Flow absent from the project and unconfirmed by a dependency record. Rules are versioned
  data; the diagnostic-rule version is recorded in the freeze manifest. Reads the reconstruction and
  the project's component inventory only, never ground truth.
- **oracle.ts** - Salesforce CLI argument arrays (never shell strings), a dry-run deploy with local
  tests, and normalisation of the JSON into an outcome and failure class. The runner is injected, so it
  is tested against canned responses with no org.
- **race.ts** - monotonic-clock timing, prototype and oracle from one t0, TTFAF and lead time.
- **experimentMetrics.ts** - detection recall and precision over static-detectable invalid scenarios,
  false-warning rate on valid scenarios, feedback-timing summaries, and a policy-gate simulation.
- **storage.ts** - immutable, checksummed result bundle with secrets redacted.
- **random.ts / schedule.ts / power.ts** - seeded generator, blocked-randomised execution schedule with
  a uniqueness guard, and simulation-based sample-size power planning.

## Automated authoring (Phase 3)

The benchmark is generated, not hand-authored. `topologyGenerator.ts` produces structurally distinct,
deployable topology instances from eight family templates; `scenarioGenerator.ts` combines them with a
controlled subset of mutation families into 18 pilot and 72 main scenarios, disjoint by construction,
each with a provisional design-expectation ground truth derived from the topology and the mutation.
`benchmarkQuality.ts` blocks a main run on duplicates, clones, pilot/main overlap, ineffective
mutations, or imbalance. `snapshotBuilder.ts` bridges a materialised project to the snapshot the core
analyses, so a mutation's effect is visible to the prototype.

Truth is two layers: the **design expectation** (before any run) and the **observed oracle** result
(after), stored apart. Where they disagree, `exceptions.ts` queues a machine-generated exception for
human review; adjudication is append-only and never overwrites either layer. Human involvement is
limited to Dev Hub auth, approving the generated plan, reviewing the exception queue, and adjudicating
genuinely ambiguous cases.

## Live integration (Phase 3.1)

A live run materialises each scenario to disk and points the CLI at that directory, so the prototype and
the oracle judge the same bytes rather than the repository working directory.

- **workspace.ts** - writes the mutated file map to a temporary project, reads it back and checksum-
  verifies it against the in-memory mutation. On mismatch the run is refused. Injectable: an in-memory
  workspace drives the offline path, the node workspace drives real runs.
- **stageOracle.ts** - runs only the oracle stages a scenario's manifest requires. Static stages take one
  dry-run deploy (with local tests when asked); a runtime stage provisions a disposable scratch org,
  deploys for real, runs an anonymous-apex probe (`runtimeProbe.ts`), and tears the org down.
- **orgProvisioner.ts** - creates and deletes scratch orgs through the injected runner; teardown never
  throws, a failed create is reported.
- **cleanTopology.ts** - before any mutation, deploys the clean base dry-run and checks its component
  counts, so a later Salesforce failure is attributable to the mutation and not a broken base.
- **executionPlan.ts** - freezes the blocked-randomised order, seed and counterbalancing to
  `execution-schedule.<kind>.json`; a live run reads that file and never re-derives the order.
- **liveRunner.ts** - one per-scenario lifecycle: materialise and verify, prototype determinism
  repetitions, one shared-t0 observation of the prototype against the stage oracle, prototype-timing
  repetitions for the timing subset, scenario run, raw record, workspace teardown.
- **rawStorage.ts** - one redacted raw record per attempt: materialised hash, prototype output and
  repetitions, every CLI call with stdout and stderr, timing marks, design expectation, observed oracle,
  and the comparison. Folded into the immutable bundle.
- **orgSession.ts** - the real-org orchestration: create one shared scratch org, gate every distinct base
  on the clean topology, run the frozen schedule, write the bundle with raw records, plan and exception
  queue, then delete the shared org. Runs only against a Dev Hub, so it is off the offline gate.

The runtime probe uses required-field seeds for the standard objects and a describe fallback otherwise;
a fallback probe is flagged for operator review rather than trusted blindly.

## Commands

Offline, no org:

```
npm run exp:generate                 # generate the benchmark and print its quality summary
npm run exp:validate-plan            # fail if the benchmark has a critical quality violation
npm run exp:freeze-plan              # write execution-schedule.main.json (add "pilot" for the pilot)
npm run exp:walking-skeleton         # run one generated scenario end to end against a mock oracle
npm run exp:selftest                 # run the pure pipeline in memory and check it wires together
npm run exp:schedule scenarios.json 42   # print a frozen blocked-randomised schedule
npm run exp:power pilot-diffs.json 7     # print a sample-size power plan
```

Live, needs a Dev Hub (the runner creates and deletes scratch orgs itself, writes an immutable
checksummed bundle with raw records, the frozen plan and an exception queue):

```
npm run exp:walking-skeleton:org -- <freeze-id> <dev-hub-alias>   # one scenario, full lifecycle
npm run exp:pilot:org            -- <freeze-id> <dev-hub-alias>   # reads execution-schedule.pilot.json
npm run exp:main:org             -- <freeze-id> <dev-hub-alias>   # reads execution-schedule.main.json
```

Run `walking-skeleton:org` first and check its raw bundle before the full pilot. Real scratch-org runs
are the operator's; nothing in this repository fabricates an org outcome, and these commands are not run
in ordinary pull-request CI.

## Benchmark plan

- **Pilot:** 18 scenarios (3 clusters x 3 complexity x 2 valid/invalid), excluded from main.
- **Main:** at least 72 scenarios (9 cluster-complexity cells x 8 structurally distinct mutations),
  disjoint from pilot, structurally varied - not clones of one topology.
- **Determinism:** every main scenario runs through the prototype five times for P50/P95 and semantic
  determinism; these are technical replicates, not independent observations.
- **Timing subset:** a balanced subset runs paired race repetitions; aggregated to scenario level
  before inference.

## What is built versus what is manual

Built and offline-tested here: the topology and scenario generators (8 families, 18 pilot and 72 main
disjoint scenarios with a provisional design ground truth), the mutation model and materialiser, the
prototype categoriser and preflight, the mock-tested oracle and stage oracle, disk materialisation with
checksum parity, the clean-topology gate, the frozen execution plan, the live runner with determinism
repetitions, raw per-attempt storage, metrics, immutable storage, schedule and power planning, and the
offline walking skeleton. The benchmark is generated, not authored - the operator does not write the 90
scenarios.

**Manual, and the operator's:** authorising a Dev Hub; approving the frozen plan; running the live
commands against real scratch orgs; reviewing the exception queue; and adjudicating genuinely ambiguous
or runtime cases. Real scratch-org behaviour is not exercised in CI - the runtime probe and scratch-org
lifecycle are mock-tested against canned CLI output and confirmed against a real org by the operator. No
real main results exist yet; the harness is the frame they land in.
