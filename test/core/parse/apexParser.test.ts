import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseApexTrigger } from '../../../src/core/parse/apexParser.js';

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/parse/apex/${name}`, import.meta.url)),
    'utf8',
  );
}

describe('parseApexTrigger (L3 static)', () => {
  it('reads trigger header name, object and events', () => {
    const parsed = parseApexTrigger(fixture('AccountTrigger.trigger'));
    expect(parsed.header.name).toBe('AccountTrigger');
    expect(parsed.header.object).toBe('Account');
    expect(parsed.header.events).toEqual(['before update', 'after update']);
    expect(parsed.errors).toEqual([]);
  });

  it('collects coarse symbol references and drops built-ins', () => {
    const parsed = parseApexTrigger(fixture('AccountTrigger.trigger'));
    expect(parsed.symbolRefs).toContain('AccountService');
    expect(parsed.symbolRefs).toContain('ContactSync');
    expect(parsed.symbolRefs).not.toContain('Trigger');
    expect(parsed.symbolRefs).not.toContain('List');
  });

  it('flags dynamic constructs as reasons', () => {
    const parsed = parseApexTrigger(fixture('DynamicTrigger.trigger'));
    expect(parsed.header.object).toBe('Opportunity');
    expect(parsed.dynamic).toContain('dynamic SOQL via Database query');
    expect(parsed.dynamic).toContain('dynamic type resolution via Type.forName');
  });

  it('reports missing header without throwing', () => {
    const parsed = parseApexTrigger(fixture('NoHeader.trigger'));
    expect(parsed.header.name).toBeUndefined();
    expect(parsed.errors[0]).toMatch(/no trigger header/i);
  });

  it('ignores references that only appear in comments', () => {
    const parsed = parseApexTrigger(
      'trigger T on Account (before insert) { /* SecretClass.call(); */ }',
    );
    expect(parsed.symbolRefs).not.toContain('SecretClass');
  });
});
