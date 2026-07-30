// Frozen execution plan. Order, seed and counterbalancing are decided once and written to a file the
// live runner reads back, so the schedule never drifts between runs. Uniqueness asserted at freeze time.

import { assertUniqueScenarios, blockedSchedule } from './schedule.js';
import type { ScenarioDescriptor, ScheduleItem } from './schedule.js';
import type { GeneratedScenario } from './scenarioGenerator.js';

export const PLAN_VERSION = '1.0.0';

export interface ExecutionPlan {
  version: string;
  kind: 'pilot' | 'main';
  seed: number;
  scenarioIds: string[];
  items: ScheduleItem[];
}

function descriptor(scenario: GeneratedScenario): ScenarioDescriptor {
  return {
    id: scenario.id,
    cluster: scenario.cluster,
    complexity: scenario.complexity,
    expectedValidity: scenario.mutationManifest.expectedValidity,
  };
}

// Freeze the plan: assert uniqueness, then blocked-randomise the order under the seed.
export function buildExecutionPlan(
  scenarios: GeneratedScenario[],
  kind: 'pilot' | 'main',
  seed: number,
): ExecutionPlan {
  assertUniqueScenarios(
    scenarios.map((s) => ({ mutationId: s.id, changedFileHashes: s.changedFileHashes })),
  );
  const items = blockedSchedule(scenarios.map(descriptor), seed);
  return {
    version: PLAN_VERSION,
    kind,
    seed,
    scenarioIds: scenarios.map((s) => s.id).sort(),
    items,
  };
}

export function serialiseExecutionPlan(plan: ExecutionPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function parseExecutionPlan(text: string): ExecutionPlan {
  const plan = JSON.parse(text) as ExecutionPlan;
  if (plan.version !== PLAN_VERSION) {
    throw new Error(`execution plan: version ${plan.version} is not supported (${PLAN_VERSION})`);
  }
  return plan;
}

// Order the scenarios by a frozen plan. The plan and the generated set must describe the same scenarios,
// so a stale plan against a changed benchmark is rejected rather than silently run in generated order.
export function orderScenarios(
  scenarios: GeneratedScenario[],
  plan: ExecutionPlan,
): GeneratedScenario[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const planIds = [...plan.items].map((i) => i.scenarioId).sort();
  const haveIds = scenarios.map((s) => s.id).sort();
  if (planIds.length !== haveIds.length || planIds.some((id, i) => id !== haveIds[i])) {
    throw new Error('execution plan: scenario set does not match the frozen plan');
  }
  return [...plan.items]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const scenario = byId.get(item.scenarioId);
      if (!scenario) throw new Error(`execution plan: unknown scenario ${item.scenarioId}`);
      return scenario;
    });
}
