// Runtime probe generator. A runtime-only failure shows only when automation runs, so a runtime scenario
// executes anonymous apex - insert (and, for update, update) one record of the target object.
// Deterministic. Standard objects use required-field seeds; others fall back to describe, flagged for review.

const REQUIRED_FIELDS: Record<string, string[]> = {
  Account: ["Name = 'probe'"],
  Contact: ["LastName = 'probe'"],
  Lead: ["LastName = 'probe'", "Company = 'probe'"],
  Opportunity: ["Name = 'probe'", "StageName = 'Prospecting'", 'CloseDate = Date.today()'],
  Case: ["Subject = 'probe'"],
  Task: ["Subject = 'probe'"],
  Event: ["Subject = 'probe'", 'DurationInMinutes = 30', 'ActivityDateTime = System.now()'],
};

export interface RuntimeProbe {
  path: string;
  apex: string;
  requiresOperatorReview: boolean; // true when the object has no known required-field seed
}

// Build the anonymous-apex probe for one object and event. The path sits outside the package directory,
// so the probe file never joins a deploy.
export function runtimeProbe(object: string, event: 'create' | 'update'): RuntimeProbe {
  const seeds = REQUIRED_FIELDS[object];
  const known = seeds !== undefined;
  const dml = event === 'update' ? 'insert rec;\nupdate rec;' : 'insert rec;';
  const apex = known
    ? `${object} rec = new ${object}(${seeds.join(', ')});\n${dml}\n`
    : `SObject rec = Schema.getGlobalDescribe().get('${object}').newSObject();\n${dml}\n`;
  return {
    path: 'scripts/probe.apex',
    apex,
    requiresOperatorReview: !known,
  };
}
