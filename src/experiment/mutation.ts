// Mutation model for the automated experiment. A mutation is one deterministic, controlled change to
// a frozen base metadata project - never uncontrolled random text replacement. Each family transforms
// an in-memory file map and declares what the change means: whether it should still deploy, what class
// of failure it introduces, which components it affects, how detectable it is from static evidence,
// and which oracle stages must run to catch it. Pure and offline: operates on a file map, so it is
// unit-tested without a scratch org. The harness is separate from the read-only analysis core and
// never imports it.

import { createHash } from 'node:crypto';

export type MutationFamily =
  | 'control_noop'
  | 'valid_impacting'
  | 'missing_field_reference'
  | 'missing_dependency'
  | 'apex_compile_break'
  | 'flow_reference_break'
  | 'cross_object_impact'
  | 'recursion_risk'
  | 'inactive_component'
  | 'dynamic_unresolved'
  | 'test_only_failure'
  | 'runtime_failure';

// Class of failure a mutation is expected to surface, or none for a valid change.
export type FailureClass =
  | 'compile'
  | 'missing_dependency'
  | 'metadata_reference'
  | 'validation_rule'
  | 'flow_reference'
  | 'apex_test'
  | 'flow_test'
  | 'runtime_exception'
  | 'governor_limit'
  | 'data_condition'
  | 'none';

// How reachable the introduced condition is from static analysis alone.
export type MutationDetectability =
  'static-direct' | 'static-inferred' | 'risk-only' | 'runtime-only' | 'out-of-scope';

// Oracle stage that must run for the platform to reveal the condition.
export type OracleStage = 'metadata_validation' | 'tests' | 'runtime_transaction';

// Project as a map of repository-relative path to file content.
export type FileMap = Record<string, string>;

export interface MutationSpec {
  id: string;
  family: MutationFamily;
  seed: number;
  baseTopologyId: string;
  target: { object: string; event: string };
  file?: string; // file the family mutates
  token?: string; // token a replace family swaps out
  replacement?: string; // token a replace family swaps in
  removeFile?: string; // file a dependency family deletes
}

export interface MutationOperation {
  file: string;
  kind: 'append' | 'replace' | 'delete';
  detail: string;
}

export interface MutationManifest {
  mutationId: string;
  family: MutationFamily;
  seed: number;
  baseTopologyId: string;
  target: { object: string; event: string };
  changedFiles: string[];
  operations: MutationOperation[];
  expectedValidity: 'valid' | 'invalid';
  expectedFailureClass: FailureClass;
  expectedAffectedComponents: string[];
  detectability: MutationDetectability;
  requiredOracleStages: OracleStage[];
  changedFileHashes: Record<string, string>; // sha256 of new content, or 'deleted'
}

export interface MutationResult {
  files: FileMap;
  manifest: MutationManifest;
}

interface FamilyOutcome {
  files: FileMap;
  operations: MutationOperation[];
  affected: string[];
  expectedValidity: 'valid' | 'invalid';
  expectedFailureClass: FailureClass;
  detectability: MutationDetectability;
  requiredOracleStages: OracleStage[];
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function requireFile(base: FileMap, path: string | undefined, family: string): string {
  if (path === undefined || base[path] === undefined) {
    throw new Error(`mutation ${family}: file '${path ?? '(unset)'}' is not in the base project`);
  }
  return base[path];
}

// Replace the first occurrence of a token, refusing a silent no-op so a mutation is always real.
function replaceOnce(source: string, token: string, replacement: string, family: string): string {
  const index = source.indexOf(token);
  if (index < 0) {
    throw new Error(`mutation ${family}: token '${token}' not found, mutation would be a no-op`);
  }
  return source.slice(0, index) + replacement + source.slice(index + token.length);
}

// Append a family marker snippet to a file. Deterministic and reversible by re-materialising.
function append(base: FileMap, path: string, snippet: string, family: string): FileMap {
  const source = requireFile(base, path, family);
  return { ...base, [path]: `${source}\n${snippet}\n` };
}

function replace(base: FileMap, path: string, token: string, replacement: string): FileMap {
  const source = requireFile(base, path, 'replace');
  return { ...base, [path]: replaceOnce(source, token, replacement, 'replace') };
}

function del(base: FileMap, path: string): FileMap {
  requireFile(base, path, 'missing_dependency');
  const next = { ...base };
  delete next[path];
  return next;
}

const FAMILIES: Record<MutationFamily, (base: FileMap, spec: MutationSpec) => FamilyOutcome> = {
  control_noop: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(base, file, `// control mutation ${spec.id}`, 'control_noop'),
      operations: [{ file, kind: 'append', detail: 'benign comment, no impact' }],
      affected: [],
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'out-of-scope',
      requiredOracleStages: ['metadata_validation'],
    };
  },
  valid_impacting: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(base, file, `// impacting change ${spec.id}`, 'valid_impacting'),
      operations: [{ file, kind: 'append', detail: 'valid change with downstream impact' }],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'static-inferred',
      requiredOracleStages: ['metadata_validation', 'tests'],
    };
  },
  missing_field_reference: (base, spec) => {
    const file = spec.file ?? '';
    const token = spec.token ?? '';
    const replacement = spec.replacement ?? `${token}__missing`;
    return {
      files: replace(base, file, token, replacement),
      operations: [{ file, kind: 'replace', detail: `${token} -> ${replacement}` }],
      affected: [file],
      expectedValidity: 'invalid',
      expectedFailureClass: 'metadata_reference',
      detectability: 'static-direct',
      requiredOracleStages: ['metadata_validation'],
    };
  },
  missing_dependency: (base, spec) => {
    const removed = spec.removeFile ?? '';
    return {
      files: del(base, removed),
      operations: [{ file: removed, kind: 'delete', detail: 'referenced component removed' }],
      affected: [removed],
      expectedValidity: 'invalid',
      expectedFailureClass: 'missing_dependency',
      detectability: 'static-direct',
      requiredOracleStages: ['metadata_validation'],
    };
  },
  apex_compile_break: (base, spec) => {
    const file = spec.file ?? '';
    const source = requireFile(base, file, 'apex_compile_break');
    const last = source.lastIndexOf('}');
    if (last < 0) {
      throw new Error(`mutation apex_compile_break: no closing brace in '${file}'`);
    }
    return {
      files: { ...base, [file]: source.slice(0, last) + source.slice(last + 1) },
      operations: [{ file, kind: 'replace', detail: 'removed a closing brace' }],
      affected: [file],
      expectedValidity: 'invalid',
      expectedFailureClass: 'compile',
      detectability: 'static-direct',
      requiredOracleStages: ['metadata_validation'],
    };
  },
  flow_reference_break: (base, spec) => {
    const file = spec.file ?? '';
    const token = spec.token ?? '';
    const replacement = spec.replacement ?? `${token}_broken`;
    return {
      files: replace(base, file, token, replacement),
      operations: [{ file, kind: 'replace', detail: `flow reference ${token} -> ${replacement}` }],
      affected: [file],
      expectedValidity: 'invalid',
      expectedFailureClass: 'flow_reference',
      detectability: 'static-inferred',
      requiredOracleStages: ['metadata_validation'],
    };
  },
  cross_object_impact: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(base, file, `// cross-object impact ${spec.id}`, 'cross_object_impact'),
      operations: [{ file, kind: 'append', detail: 'valid change reaching another object' }],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'static-inferred',
      requiredOracleStages: ['metadata_validation', 'tests'],
    };
  },
  recursion_risk: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(
        base,
        file,
        `// recursion risk ${spec.id}: writes back to same object`,
        'recursion_risk',
      ),
      operations: [{ file, kind: 'append', detail: 'introduces a re-entry path' }],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'risk-only',
      requiredOracleStages: ['tests', 'runtime_transaction'],
    };
  },
  inactive_component: (base, spec) => {
    const file = spec.file ?? '';
    const token = spec.token ?? 'Active';
    const replacement = spec.replacement ?? 'Inactive';
    return {
      files: replace(base, file, token, replacement),
      operations: [{ file, kind: 'replace', detail: `status ${token} -> ${replacement}` }],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'out-of-scope',
      requiredOracleStages: ['metadata_validation'],
    };
  },
  dynamic_unresolved: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(
        base,
        file,
        `// dynamic reference ${spec.id}: target built at runtime`,
        'dynamic_unresolved',
      ),
      operations: [{ file, kind: 'append', detail: 'reference static analysis cannot resolve' }],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'none',
      detectability: 'runtime-only',
      requiredOracleStages: ['tests', 'runtime_transaction'],
    };
  },
  test_only_failure: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(base, file, `// test-only failure ${spec.id}`, 'test_only_failure'),
      operations: [{ file, kind: 'append', detail: 'behaviour a test asserts against fails' }],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'apex_test',
      detectability: 'runtime-only',
      requiredOracleStages: ['tests'],
    };
  },
  runtime_failure: (base, spec) => {
    const file = spec.file ?? '';
    return {
      files: append(
        base,
        file,
        `// runtime failure ${spec.id}: deploys and compiles, throws at runtime`,
        'runtime_failure',
      ),
      operations: [
        { file, kind: 'append', detail: 'runtime transaction fails, validation does not' },
      ],
      affected: [file],
      expectedValidity: 'valid',
      expectedFailureClass: 'runtime_exception',
      detectability: 'runtime-only',
      requiredOracleStages: ['runtime_transaction'],
    };
  },
};

// Files whose content differs from the base, or that the mutation removed.
function changedFiles(base: FileMap, next: FileMap): string[] {
  const paths = new Set([...Object.keys(base), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const path of paths) {
    if (base[path] !== next[path]) {
      changed.push(path);
    }
  }
  return changed.sort();
}

// Apply one controlled mutation to a base project. Deterministic: same base and spec give byte-equal
// files and manifest, so a scenario re-materialises exactly.
export function applyMutation(base: FileMap, spec: MutationSpec): MutationResult {
  const family = FAMILIES[spec.family];
  if (!family) {
    throw new Error(`mutation: unknown family '${spec.family}'`);
  }
  const outcome = family(base, spec);
  const changed = changedFiles(base, outcome.files);
  const changedFileHashes: Record<string, string> = {};
  for (const path of changed) {
    const content = outcome.files[path];
    changedFileHashes[path] = content === undefined ? 'deleted' : sha256(content);
  }

  const manifest: MutationManifest = {
    mutationId: spec.id,
    family: spec.family,
    seed: spec.seed,
    baseTopologyId: spec.baseTopologyId,
    target: spec.target,
    changedFiles: changed,
    operations: outcome.operations,
    expectedValidity: outcome.expectedValidity,
    expectedFailureClass: outcome.expectedFailureClass,
    expectedAffectedComponents: outcome.affected,
    detectability: outcome.detectability,
    requiredOracleStages: outcome.requiredOracleStages,
    changedFileHashes,
  };
  return { files: outcome.files, manifest };
}
