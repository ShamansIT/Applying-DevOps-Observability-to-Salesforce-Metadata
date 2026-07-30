# Threats to validity

Honest limits of the automated mutation-based evaluation, so results are read with the right caution.

## Construct

- **Prototype is not a validator.** The core reconstructs phase-ordered execution flow with
  confidence and risk, it does not prove a reference broken. So its strongest current prediction is a
  material warning, and `blocking_finding` is reserved for a future validator and not emitted. Detection
  metrics measure whether the prototype raises a concern, not whether it proves a defect.
- **Project-to-snapshot fidelity.** The prototype analyses a snapshot. Building a faithful snapshot from
  an arbitrary mutated project depends on the readers; where a mutation's effect is not represented in
  the snapshot, the prototype cannot see it. Base topologies must carry snapshots rich enough for the
  core, or the reader must be extended - a known limitation.
- **Oracle coverage.** A dry-run deploy with local tests catches compile, reference and test failures,
  not every runtime condition. Runtime-only mutations need a scratch-org deploy plus a scripted
  transaction; where that stage is not run, a runtime-only miss is not a static false negative and is
  reported apart.

## Internal

- **Single author.** The base topologies, mutations and ground truth are authored by one person who
  also built the prototype. Mutation manifests and ground truth are hashed before runs to limit quiet
  tuning, but independent review of a sample is the mitigation and is not yet done.
- **Mock-tested integration.** The oracle and scratch-org adapters are tested against canned CLI
  responses, not a live org, in this repository. Real-org behaviour may differ; real runs are required
  before any hypothesis is reported as supported.

## External

- **Small samples.** Even at 72 main scenarios, statistical power is limited; the sample-size plan is
  simulation-based on sparse pilot data. Findings characterise behaviour more than they prove
  population effects.
- **One platform version.** The phase model is pinned to one Salesforce API version; behaviour on other
  releases is not evaluated.

## Reporting rule

No hypothesis is reported as supported or rejected until real frozen main results exist. The harness,
its metrics, and its self-tests are green offline; that is evidence the machinery works, not evidence
about the research questions.
