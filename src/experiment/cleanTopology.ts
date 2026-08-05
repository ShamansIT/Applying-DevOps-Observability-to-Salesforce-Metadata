// Clean-topology gate. Before any mutation, deploys the untouched base dry-run and checks component
// counts, so a later Salesforce failure is the mutation's fault, not a broken base. Refuses to proceed.

import { deployArgs, normaliseValidation } from './oracle.js';
import type { Outcome, ProcRunner } from './oracle.js';
import { projectChecksum } from './project.js';
import type { TopologyInstance } from './topologyGenerator.js';
import { materialiseVerified, safeRemove } from './workspace.js';
import type { Workspace } from './workspace.js';

export interface CleanTopologyDeps {
  workspace: Workspace;
  run: ProcRunner;
  alias: string;
  timeoutMs?: number;
  keepWorkspace?: boolean;
}

export interface ComponentCount {
  kind: string;
  expected: number;
  present: number;
}

export interface CleanTopologyResult {
  instanceId: string;
  deployable: boolean;
  outcome: Outcome;
  message: string;
  components: ComponentCount[];
  componentsComplete: boolean;
}

const COMPONENT_MATCHERS: {
  kind: string;
  matcher: RegExp;
  expected: (i: TopologyInstance) => number;
}[] = [
  { kind: 'apex_class', matcher: /\/classes\/[^/]+\.cls$/, expected: (i) => i.params.handlers },
  {
    kind: 'apex_trigger',
    matcher: /\/triggers\/[^/]+\.trigger$/,
    expected: (i) => i.params.triggers,
  },
  { kind: 'flow', matcher: /\/flows\/[^/]+\.flow-meta\.xml$/, expected: (i) => i.params.flows },
  {
    kind: 'validation_rule',
    matcher: /\/validationRules\/[^/]+\.validationRule-meta\.xml$/,
    expected: (i) => i.params.validationRules,
  },
];

function componentCounts(instance: TopologyInstance): ComponentCount[] {
  const paths = Object.keys(instance.files);
  return COMPONENT_MATCHERS.map((matcher) => ({
    kind: matcher.kind,
    expected: matcher.expected(instance),
    present: paths.filter((path) => matcher.matcher.test(path)).length,
  }));
}

const DEFAULT_TIMEOUT_MS = 600_000;

// Validate one clean topology. Static component check first, then a single dry-run deploy. No mutation,
// no tests - only that the untouched base is well-formed and deployable.
export async function validateCleanTopology(
  instance: TopologyInstance,
  deps: CleanTopologyDeps,
): Promise<CleanTopologyResult> {
  const components = componentCounts(instance);
  const componentsComplete = components.every(
    (component) => component.present >= component.expected,
  );

  const material = materialiseVerified(
    deps.workspace,
    `clean-${instance.instanceId}`,
    instance.files,
    projectChecksum(instance.files),
  );
  try {
    const proc = await deps.run(
      'sf',
      deployArgs(deps.alias, { dryRun: true, testLevel: 'NoTestRun', sourceDir: 'force-app' }),
      { cwd: material.dir, timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    const result = normaliseValidation(proc);
    const deployable = result.outcome === 'pass' && componentsComplete;
    return {
      instanceId: instance.instanceId,
      deployable,
      outcome: result.outcome,
      message: deployable ? 'clean topology deployable' : result.message,
      components,
      componentsComplete,
    };
  } finally {
    // Non-masking teardown - a permanent cleanup failure never overwrites this topology check.
    if (!deps.keepWorkspace) safeRemove(deps.workspace, material.dir);
  }
}
