# Threats to validity

Honest limits of the automated mutation-based evaluation, so results are read with the right caution.

## Construct

- **Prototype is not a full validator.** The core reconstructs phase-ordered execution flow with
  confidence and risk; it does not compile or simulate runtime. A conservative preflight layer emits
  `blocking_finding` only for directly-evidenced deterministic failures (a source reference to a
  component absent from the project and unconfirmed by a dependency record). Everything else is a
  material warning, unresolved, or out of scope. Detection metrics therefore cover the narrow set of
  statically-provable failures the rules implement, not every possible defect.
- **Project-to-snapshot fidelity.** The prototype analyses a snapshot. Building a faithful snapshot from
  an arbitrary mutated project depends on the readers; where a mutation's effect is not represented in
  the snapshot, the prototype cannot see it. The bridge is exact for generated topologies, whose format
  the snapshot builder targets; arbitrary hand-authored projects are out of scope.
- **Prototype and oracle parity.** Each scenario is written to disk and checksum-verified, and the CLI
  runs with that directory as its working directory, so the prototype (in memory) and the oracle (on
  disk) judge the same bytes. The verification guards against a silent divergence but does not prove the
  generated metadata is faithful to production usage.
- **Oracle coverage.** A dry-run deploy with local tests catches compile, reference and test failures,
  not every runtime condition. A runtime stage provisions a disposable scratch org, deploys, and runs an
  anonymous-apex probe; the probe uses required-field seeds for the standard objects and a describe
  fallback otherwise, so a fallback probe is flagged for operator review, not trusted blindly. A
  runtime-only miss is reported apart from a static false negative.

## Internal

- **Single author.** The topology and scenario generators, mutations and provisional ground truth are
  built by one person who also built the prototype. Mutation manifests and ground truth are hashed before
  runs to limit quiet tuning, but independent review of a sample is the mitigation and is not yet done.
- **Mock-tested integration.** The oracle, stage oracle, scratch-org provisioner, clean-topology gate and
  live runner are tested against canned CLI responses and an in-memory workspace, not a live org, in this
  repository. The scratch-org lifecycle and the runtime probe are therefore unverified against a real
  org; real runs are required before any hypothesis is reported as supported.

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
