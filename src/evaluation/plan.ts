// Evaluation-plan checks. Pilot and main benchmarks must stay disjoint: a scenario used to refine or
// smoke the procedure cannot also count as main evidence, and main must not be empty. Pure, so it is
// unit-tested without the filesystem.

export function assertDisjointMainPlan(mainIds: string[], pilotIds: string[]): void {
  if (mainIds.length === 0) {
    throw new Error('eval main: case list is empty - add main scenarios to config/eval/main.json');
  }
  const pilot = new Set(pilotIds);
  const seen = new Set<string>();
  for (const id of mainIds) {
    if (pilot.has(id)) {
      throw new Error(`eval main: scenario ${id} is a pilot scenario and must not appear in main`);
    }
    if (seen.has(id)) {
      throw new Error(`eval main: scenario ${id} appears twice in main`);
    }
    seen.add(id);
  }
}
