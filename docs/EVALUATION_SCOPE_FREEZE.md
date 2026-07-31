# Evaluation scope freeze

Consolidation phase. Scope is frozen here: no new topology families, mutation families, statistical
models, policy engines, runtime simulators or UI. The purpose is to verify the existing implementation
against a real Salesforce scratch org and decide whether the repository is ready for a formal pilot.

## A. Primary artefact

The primary artefact is the existing read-only Salesforce metadata observability prototype. It:

- analyses local Salesforce metadata or a read-only metadata snapshot;
- reconstructs relevant nodes and dependency relationships;
- produces a phase-level Predicted Execution Map;
- attaches evidence and confidence states;
- identifies unresolved and excluded behaviour;
- produces conservative risk annotations;
- exports structured output.

It does not:

- guarantee exact runtime execution;
- act as a full Salesforce compiler;
- replace Salesforce deployment validation;
- guarantee pass or fail for all changes;
- execute DML;
- deploy metadata;
- simulate all runtime data conditions;
- act as a production deployment gate.

## B. Primary evaluation

The primary evaluation measures, against ground truth that describes the world:

- node precision and recall;
- edge precision and recall;
- edge F1;
- relationship-type accuracy;
- ordered path coverage;
- phase-assignment accuracy;
- boundary handling;
- semantic determinism;
- local analysis latency.

## C. Supplementary shift-left evaluation

The supplementary experiment measures:

- whether the prototype produces relevant impact or risk information before Salesforce validation
  completes;
- machine-measured prototype TTFAF;
- machine-measured Salesforce TTFAF;
- paired lead time;
- agreement between prototype findings and Salesforce validation outcomes for directly supported
  scenarios.

The supplementary experiment does not claim the prototype predicts all deployment, test or runtime
failures. It reports agreement only for directly supported scenarios, and treats runtime-only and
test-only outcomes apart.

## D. Deferred or out of scope

The following are future work or out of scope for this consolidation, unless already complete and
directly required by the three readiness scenarios:

- universal Salesforce pass/fail prediction;
- complete runtime simulation;
- production policy gating;
- exercising all twelve mutation families;
- automatic ground truth for arbitrary runtime behaviour;
- support for every Salesforce metadata type (readiness detection covers Apex component references and
  dynamic constructs; field-level and formula-level resolution stay deferred);
- 72-scenario execution as a fixed requirement;
- human-performance evaluation;
- production-grade experiment management.

## Readiness scenarios

Three engineering readiness scenarios verify the end-to-end workflow against a real scratch org. They
are not part of the formal pilot or main dissertation dataset.

- **R01 valid control** - clean project deploys; a real (non-comment) valid change stays valid;
  Salesforce validation passes; the prototype raises no blocking or risk finding.
- **R02 direct static failure** - a trigger directly references a handler component; the mutation
  removes that component; the clean project validates, the mutated project fails Salesforce validation
  for that missing reference, and the prototype flags the missing dependency. A field-level reference is
  a valid alternative but field resolution is deferred (section D), so readiness uses a component
  reference the prototype resolves statically today.
- **R03 risk or unresolved** - a valid project gains a dynamic construct (`Database.query`) static
  analysis cannot resolve; the project still deploys; the prototype reports `unresolved` (or a risk
  `material_warning`), never a proven pass or an unsupported blocking failure.

## Readiness decision

The readiness command emits `READY_FOR_PILOT` only after a real scratch-org run where every criterion in
section 9 of the consolidation brief holds. Mock success alone is not readiness. Without an authenticated
Dev Hub the command emits `NOT_READY_FOR_PILOT` and names the blocker.
