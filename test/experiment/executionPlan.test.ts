import { describe, expect, it } from 'vitest';
import {
  buildExecutionPlan,
  orderScenarios,
  parseExecutionPlan,
  serialiseExecutionPlan,
} from '../../src/experiment/executionPlan.js';
import { generateBenchmark } from '../../src/experiment/scenarioGenerator.js';

const { main } = generateBenchmark();

describe('execution plan', () => {
  it('freezes a stable order for a fixed seed and round-trips through json', () => {
    const a = buildExecutionPlan(main, 'main', 7);
    const b = buildExecutionPlan(main, 'main', 7);
    expect(a.items.map((i) => i.scenarioId)).toEqual(b.items.map((i) => i.scenarioId));
    const parsed = parseExecutionPlan(serialiseExecutionPlan(a));
    expect(parsed.items).toEqual(a.items);
    expect(parsed.scenarioIds).toHaveLength(main.length);
  });

  it('orders scenarios by the frozen plan', () => {
    const plan = buildExecutionPlan(main, 'main', 3);
    const ordered = orderScenarios(main, plan);
    expect(ordered.map((s) => s.id)).toEqual(
      [...plan.items].sort((x, y) => x.order - y.order).map((i) => i.scenarioId),
    );
  });

  it('rejects a plan whose scenario set does not match the benchmark', () => {
    const plan = buildExecutionPlan(main, 'main', 3);
    expect(() => orderScenarios(main.slice(1), plan)).toThrow(/does not match/);
  });

  it('rejects a plan with an unsupported version', () => {
    const plan = buildExecutionPlan(main, 'main', 3);
    const tampered = serialiseExecutionPlan({ ...plan, version: '9.9.9' });
    expect(() => parseExecutionPlan(tampered)).toThrow(/not supported/);
  });
});
