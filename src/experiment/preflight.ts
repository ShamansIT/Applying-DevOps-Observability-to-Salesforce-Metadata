// Conservative preflight over reconstructed graph. Emits `blocking_finding` only on direct static
// evidence - reference to component absent from project; versioned rules, never touches ground truth.

import type { ReconstructResult } from '../core/index.js';
import type { OrgSnapshot } from '../ingestion/index.js';

export const PREFLIGHT_VERSION = '1.0.0';

export type DiagnosticCategory = 'blocking_finding' | 'material_warning';

export interface DiagnosticFinding {
  ruleId: string;
  category: DiagnosticCategory;
  component: string;
  reason: string;
  evidence: string;
}

export interface PreflightInput {
  result: ReconstructResult;
  presentComponentIds: ReadonlySet<string>;
}

export interface DiagnosticRule {
  id: string;
  description: string;
  supports: string[];
  category: DiagnosticCategory;
  version: string;
  evaluate: (input: PreflightInput) => DiagnosticFinding[];
}

export interface PreflightResult {
  findings: DiagnosticFinding[];
  blocking: DiagnosticFinding[];
}

const TYPE_PREFIX: Record<string, string> = {
  ApexClass: 'apex_class',
  ApexTrigger: 'apex_trigger',
  Flow: 'flow',
  CustomObject: 'object',
  ValidationRule: 'validation_rule',
};

// Stable ids of components that exist in the project, in the same scheme the core uses for edge
// targets, so a missing target is a set miss. Mirrors the core target-id scheme.
export function componentIdsFromSnapshot(snapshot: OrgSnapshot): Set<string> {
  return new Set(
    snapshot.components.map(
      (component) =>
        `${TYPE_PREFIX[component.type] ?? component.type.toLowerCase()}:${component.fullName}`,
    ),
  );
}

// Targets that name a deployable component (not a data object or an unresolved placeholder), so their
// absence is a hard failure rather than an out-of-scope reference.
const COMPONENT_PREFIXES = ['apex_class:', 'apex_trigger:', 'flow:'];

// Source-parse evidence: the code or flow body itself names the target. Strong enough to assert a
// reference, but on its own it does not prove the target exists.
const SOURCE_EVIDENCE = new Set(['apex_static', 'flow_xml_static']);

// A dependency record is the platform confirming the target exists, so it clears a missing claim.
const EXISTENCE_EVIDENCE = 'dependency_api';

function isClaim(state: string): boolean {
  return state === 'confirmed' || state === 'inferred';
}

// Source reference to an Apex class, trigger or Flow the project does not contain, unconfirmed by a
// dependency record, is a deterministic deploy failure. Dependency-record edges, objects, unresolved
// and heuristic references never fire.
const missingComponentReference: DiagnosticRule = {
  id: 'missing-component-reference',
  description:
    'A source reference targets an Apex class, trigger or Flow that is not present in the project and is not confirmed by a dependency record.',
  supports: ['ApexClass', 'ApexTrigger', 'Flow'],
  category: 'blocking_finding',
  version: '1.0.0',
  evaluate: ({ result, presentComponentIds }) => {
    const findings: DiagnosticFinding[] = [];
    for (const edge of result.edges) {
      if (!isClaim(edge.state)) continue;
      if (!COMPONENT_PREFIXES.some((prefix) => edge.to.startsWith(prefix))) continue;
      if (presentComponentIds.has(edge.to)) continue;
      if (edge.evidence.some((item) => item.type === EXISTENCE_EVIDENCE)) continue; // confirmed to exist
      const source = edge.evidence.find((item) => SOURCE_EVIDENCE.has(item.type));
      if (!source) continue;
      findings.push({
        ruleId: missingComponentReference.id,
        category: 'blocking_finding',
        component: edge.to,
        reason: `${edge.from} references ${edge.to}, which is not present in the project`,
        evidence: source.type,
      });
    }
    return findings;
  },
};

export const PREFLIGHT_RULES: DiagnosticRule[] = [missingComponentReference];

// Run the diagnostic rules over one reconstruction. Findings are deterministic and ordered by rule.
export function preflight(input: PreflightInput): PreflightResult {
  const findings = PREFLIGHT_RULES.flatMap((rule) => rule.evaluate(input));
  return { findings, blocking: findings.filter((f) => f.category === 'blocking_finding') };
}
