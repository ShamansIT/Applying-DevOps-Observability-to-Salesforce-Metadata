// Benchmark-quality checks. Before a main run, flags duplicate or cloned scenarios, pilot/main overlap,
// ineffective mutations and imbalance; a critical violation blocks the run.

import type { GeneratedScenario } from './scenarioGenerator.js';

export interface BenchmarkQualityReport {
  pilotCount: number;
  mainCount: number;
  clusterBalance: Record<string, number>;
  complexityBalance: Record<string, number>;
  validityBalance: { valid: number; invalid: number };
  detectabilityBalance: Record<string, number>;
  mutationDistribution: Record<string, number>;
  duplicateSignatures: string[];
  pilotMainOverlap: string[];
  ineffectiveMutations: string[];
  criticalViolations: string[];
  ok: boolean;
}

function signature(scenario: GeneratedScenario): string {
  return Object.entries(scenario.changedFileHashes)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, hash]) => `${path}:${hash}`)
    .join('|');
}

function tally<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

export function benchmarkQuality(
  pilot: GeneratedScenario[],
  main: GeneratedScenario[],
): BenchmarkQualityReport {
  const critical: string[] = [];

  // Duplicate changed-file signatures within main - trivial clones.
  const seen = new Map<string, string>();
  const duplicateSignatures: string[] = [];
  for (const scenario of main) {
    const sig = signature(scenario);
    const clash = seen.get(sig);
    if (clash) duplicateSignatures.push(`${scenario.id} == ${clash}`);
    else seen.set(sig, scenario.id);
  }
  if (duplicateSignatures.length > 0) {
    critical.push(`${duplicateSignatures.length} duplicate main scenario(s)`);
  }

  // Pilot/main overlap by id.
  const mainIds = new Set(main.map((s) => s.id));
  const pilotMainOverlap = pilot.filter((s) => mainIds.has(s.id)).map((s) => s.id);
  if (pilotMainOverlap.length > 0)
    critical.push(`${pilotMainOverlap.length} pilot/main overlap(s)`);

  // Ineffective mutations - no file actually changed.
  const ineffectiveMutations = [...pilot, ...main]
    .filter((s) => s.mutationManifest.changedFiles.length === 0)
    .map((s) => s.id);
  if (ineffectiveMutations.length > 0) {
    critical.push(`${ineffectiveMutations.length} ineffective mutation(s)`);
  }

  if (main.length === 0) critical.push('main benchmark is empty');

  const validity = { valid: 0, invalid: 0 };
  for (const s of main) {
    if (s.designExpectation.validationOutcome === 'pass') validity.valid += 1;
    else validity.invalid += 1;
  }

  return {
    pilotCount: pilot.length,
    mainCount: main.length,
    clusterBalance: tally(main.map((s) => s.cluster)),
    complexityBalance: tally(main.map((s) => s.complexity)),
    validityBalance: validity,
    detectabilityBalance: tally(main.map((s) => s.designExpectation.detectability)),
    mutationDistribution: tally(main.map((s) => s.mutationFamily)),
    duplicateSignatures,
    pilotMainOverlap,
    ineffectiveMutations,
    criticalViolations: critical,
    ok: critical.length === 0,
  };
}

export function toBenchmarkQualityMarkdown(report: BenchmarkQualityReport): string {
  const lines = [
    '# Benchmark quality report',
    '',
    `- pilot scenarios: ${String(report.pilotCount)}`,
    `- main scenarios: ${String(report.mainCount)}`,
    `- cluster balance: ${JSON.stringify(report.clusterBalance)}`,
    `- complexity balance: ${JSON.stringify(report.complexityBalance)}`,
    `- validity balance: ${JSON.stringify(report.validityBalance)}`,
    `- detectability balance: ${JSON.stringify(report.detectabilityBalance)}`,
    `- mutation distribution: ${JSON.stringify(report.mutationDistribution)}`,
    `- duplicate signatures: ${String(report.duplicateSignatures.length)}`,
    `- pilot/main overlap: ${String(report.pilotMainOverlap.length)}`,
    `- ineffective mutations: ${String(report.ineffectiveMutations.length)}`,
    '',
    report.ok
      ? 'Status: OK - main run may proceed.'
      : `Status: BLOCKED - ${report.criticalViolations.join('; ')}`,
    '',
  ];
  return lines.join('\n');
}
