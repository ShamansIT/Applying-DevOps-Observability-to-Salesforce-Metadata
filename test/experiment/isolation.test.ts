import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Prototype prediction must be produced from mutated metadata only. It must never receive ground
// truth, mutation's expected outcome, Salesforce oracle result, scenario validity label,
// or failure-class label. This guard asserts that at the module level: prototype-side files do
// not import evaluation truth, oracle, or scenario expectations.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../src/experiment/${relative}`, import.meta.url)),
    'utf8',
  );
}

const PROTOTYPE_SIDE = ['prototypeAdapter.ts', 'preflight.ts'];

const FORBIDDEN = [
  { pattern: /from '\.\.\/evaluation\//, name: 'evaluation module import' },
  { pattern: /[Gg]roundTruth/, name: 'ground truth reference' },
  { pattern: /from '\.\/oracle\.js'/, name: 'oracle import' },
  { pattern: /ValidationResult/, name: 'oracle validation type' },
  {
    pattern: /expectedValidity|oracleOutcome|expectedFailureClass/,
    name: 'scenario expectation field',
  },
];

describe('prototype isolation from ground truth', () => {
  for (const file of PROTOTYPE_SIDE) {
    const text = source(file);
    for (const forbidden of FORBIDDEN) {
      it(`${file} does not reference ${forbidden.name}`, () => {
        expect(forbidden.pattern.test(text)).toBe(false);
      });
    }
  }

  it('the prototype adapter reads only reconstruction, snapshot and preflight', () => {
    // public entry points take a snapshot, target and model - never a truth or oracle argument.
    const text = source('prototypeAdapter.ts');
    expect(text).toContain('export function runPrototype(');
    expect(text).toContain('componentIdsFromSnapshot(snapshot)');
  });
});
