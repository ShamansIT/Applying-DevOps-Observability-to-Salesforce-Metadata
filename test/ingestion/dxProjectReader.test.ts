import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDxProject } from '../../src/ingestion/index.js';

const PROJECT = fileURLToPath(new URL('../fixtures/dx-project', import.meta.url));

describe('readDxProject (offline)', () => {
  const result = readDxProject(PROJECT);

  const namesOfType = (type: string): string[] =>
    result.components.filter((component) => component.type === type).map((c) => c.fullName);

  it('reads sourceApiVersion from sfdx-project.json', () => {
    expect(result.apiVersion).toBe('67.0');
  });

  it('inventories triggers, classes, flows and validation rules', () => {
    expect(namesOfType('ApexTrigger')).toContain('AccountTrigger');
    expect(namesOfType('ApexClass')).toContain('AccountService');
    expect(namesOfType('Flow')).toContain('Account_Before_Save');
    expect(namesOfType('ValidationRule')).toContain('Account.Require_Industry');
  });

  it('derives object for validation rules from path', () => {
    const rule = result.components.find((component) => component.type === 'ValidationRule');
    expect(rule?.object).toBe('Account');
  });

  it('stores paths relative to project with forward slashes (deterministic)', () => {
    const trigger = result.components.find((component) => component.type === 'ApexTrigger');
    expect(trigger?.attributes.path).toBe('force-app/main/default/triggers/AccountTrigger.trigger');
  });

  it('does not inventory companion -meta.xml files as components', () => {
    // Trigger has .trigger-meta.xml companion; only .trigger becomes component.
    expect(namesOfType('ApexTrigger')).toEqual(['AccountTrigger']);
  });

  it('is deterministic: two reads are deep-equal', () => {
    expect(readDxProject(PROJECT)).toEqual(readDxProject(PROJECT));
  });

  it('returns nothing for directory without sources', () => {
    // missing package directory yields empty inventory, not error
    const empty = readDxProject(
      fileURLToPath(new URL('../fixtures/dx-project-empty', import.meta.url)),
    );
    expect(empty.components).toEqual([]);
  });
});
