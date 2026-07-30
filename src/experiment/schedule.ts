// Execution schedule. Freezes the order scenarios run in before any main run, using blocked
// randomisation by cluster, complexity and expected validity so conditions are balanced across the
// run rather than clustered. The seed is recorded, so the schedule is reproducible and the runner
// never picks a fresh random order on each execution. Also guards scenario uniqueness, so a duplicate
// or trivially-cloned mutation cannot inflate the sample.

import { mulberry32, shuffle } from './random.js';

export interface ScenarioDescriptor {
  id: string;
  cluster: 'declarative' | 'programmatic' | 'mixed';
  complexity: 'low' | 'medium' | 'high';
  expectedValidity: 'valid' | 'invalid';
}

export interface ScheduleItem {
  scenarioId: string;
  block: string;
  order: number;
  sequence: 'concurrent' | 'baseline-first' | 'prototype-first';
}

function blockKey(s: ScenarioDescriptor): string {
  return `${s.cluster}/${s.complexity}/${s.expectedValidity}`;
}

// Blocked randomisation: shuffle within each block, then round-robin across blocks, so no cluster or
// complexity runs in one clump. Concurrent race is primary; a 1:1 counterbalanced order is stamped on
// each item for the optional sequential sensitivity subset.
export function blockedSchedule(scenarios: ScenarioDescriptor[], seed: number): ScheduleItem[] {
  const rand = mulberry32(seed);
  const blocks = new Map<string, ScenarioDescriptor[]>();
  for (const scenario of [...scenarios].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = blockKey(scenario);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(scenario);
    else blocks.set(key, [scenario]);
  }

  const shuffled = [...blocks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, items]) => ({ key, items: shuffle(items, rand) }));

  const ordered: ScheduleItem[] = [];
  const maxLen = Math.max(0, ...shuffled.map((b) => b.items.length));
  let order = 0;
  for (let round = 0; round < maxLen; round += 1) {
    for (const block of shuffled) {
      const scenario = block.items[round];
      if (!scenario) continue;
      ordered.push({
        scenarioId: scenario.id,
        block: block.key,
        order,
        sequence: order % 2 === 0 ? 'baseline-first' : 'prototype-first',
      });
      order += 1;
    }
  }
  return ordered;
}

// Reject duplicate or trivially-cloned scenarios by their changed-file signature, so five copies of
// one topology cannot pose as five observations.
export function assertUniqueScenarios(
  manifests: { mutationId: string; changedFileHashes: Record<string, string> }[],
): void {
  const signatures = new Map<string, string>();
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (ids.has(manifest.mutationId)) {
      throw new Error(`schedule: duplicate scenario id ${manifest.mutationId}`);
    }
    ids.add(manifest.mutationId);
    const signature = Object.entries(manifest.changedFileHashes)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, hash]) => `${path}:${hash}`)
      .join('|');
    const clash = signatures.get(signature);
    if (clash) {
      throw new Error(
        `schedule: ${manifest.mutationId} has the same changes as ${clash} - not a distinct scenario`,
      );
    }
    signatures.set(signature, manifest.mutationId);
  }
}
