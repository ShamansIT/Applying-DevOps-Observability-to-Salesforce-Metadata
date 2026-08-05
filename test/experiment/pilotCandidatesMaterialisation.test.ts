import { describe, expect, it } from 'vitest';
import { pilotCandidates } from '../../src/experiment/pilotCandidates.js';
import { parseFlow } from '../../src/core/parse/flowParser.js';
import type { FileMap } from '../../src/experiment/mutation.js';

const CANDIDATES = pilotCandidates();

function flowFiles(files: FileMap): [string, string][] {
  return Object.entries(files).filter(([p]) => p.endsWith('.flow-meta.xml'));
}

function classNames(files: FileMap): Set<string> {
  const names = new Set<string>();
  for (const p of Object.keys(files)) {
    const m = /\/classes\/([^/]+)\.cls$/.exec(p);
    if (m) names.add(m[1] as string);
  }
  return names;
}

function flowNames(files: FileMap): Set<string> {
  const names = new Set<string>();
  for (const p of Object.keys(files)) {
    const m = /\/flows\/([^/]+)\.flow-meta\.xml$/.exec(p);
    if (m) names.add(m[1] as string);
  }
  return names;
}

// Unresolved references in a package: an invoked Apex handler with no class file, or a called subflow
// with no flow definition. General - reads the metadata, hard-codes no scenario id or component name.
function unresolvedDeps(files: FileMap): string[] {
  const classes = classNames(files);
  const flows = flowNames(files);
  const missing: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (/\/triggers\/[^/]+\.trigger$/.test(path)) {
      for (const m of content.matchAll(/\b([A-Z]\w*)\.run\s*\(/g)) {
        const ref = m[1] as string;
        if (!classes.has(ref)) missing.push(`${path} -> class ${ref}`);
      }
    }
    if (path.endsWith('.flow-meta.xml')) {
      for (const sub of parseFlow(content).subflows) {
        if (!flows.has(sub)) missing.push(`${path} -> subflow ${sub}`);
      }
    }
  }
  return missing;
}

describe('pilot candidate clean materialisation', () => {
  it('covers exactly the 3x3 design across three clusters', () => {
    expect(CANDIDATES).toHaveLength(9);
    const clusters = new Set(CANDIDATES.map((c) => c.cluster));
    expect([...clusters].sort()).toEqual(['declarative', 'mixed', 'programmatic']);
    for (const cluster of clusters) {
      const variants = CANDIDATES.filter((c) => c.cluster === cluster)
        .map((c) => c.variant)
        .sort();
      expect(variants).toEqual(['risk', 'static_fail', 'valid']);
    }
  });

  // Regression for the exact real diagnostic observed in pilot-20260805-01:
  //   "<Flow> | Error | Required field is missing: label"
  // Every clean Flow must carry the required <label>, and parse without error.
  it('every clean Flow has the required label, status and processType and parses cleanly', () => {
    const withFlows = CANDIDATES.filter((c) => flowFiles(c.cleanFiles).length > 0);
    // declarative + mixed carry flows; the guard proves the cluster coverage is real.
    expect(withFlows.map((c) => c.cluster)).toEqual(
      expect.arrayContaining(['declarative', 'mixed']),
    );
    for (const c of CANDIDATES) {
      for (const [path, xml] of flowFiles(c.cleanFiles)) {
        expect(xml, `${c.id} ${path} missing <label>`).toMatch(/<label>[^<]+<\/label>/);
        expect(xml, `${c.id} ${path} missing <status>`).toContain('<status>');
        expect(xml, `${c.id} ${path} missing <processType>`).toContain('<processType>');
        expect(parseFlow(xml).errors, `${c.id} ${path} parse errors`).toEqual([]);
      }
    }
  });

  it('programmatic clean bases carry no Flow (explains why they already passed)', () => {
    for (const c of CANDIDATES.filter((c) => c.cluster === 'programmatic')) {
      expect(flowFiles(c.cleanFiles)).toHaveLength(0);
    }
  });

  it('every clean candidate is self-contained - all invoked classes and called subflows exist', () => {
    for (const c of CANDIDATES) {
      expect(unresolvedDeps(c.cleanFiles), `${c.id} clean base has a missing dependency`).toEqual(
        [],
      );
    }
  });
});

describe('pilot candidate mutation semantics preserved', () => {
  it('clean and mutated hashes differ for every candidate', () => {
    for (const c of CANDIDATES) expect(c.cleanHash, c.id).not.toBe(c.mutatedHash);
  });

  it('static_fail mutations still break exactly the planned dependency (org would fail)', () => {
    for (const c of CANDIDATES.filter((c) => c.variant === 'static_fail')) {
      expect(c.designExpectation.validationOutcome).toBe('fail');
      // The mutation removes a referenced component, so the mutated package no longer resolves.
      expect(
        unresolvedDeps(c.mutatedFiles).length,
        `${c.id} mutated still resolves`,
      ).toBeGreaterThan(0);
    }
  });

  it('valid and risk mutations stay Salesforce-shaped - self-contained flows keep their label', () => {
    for (const c of CANDIDATES.filter((c) => c.variant !== 'static_fail')) {
      expect(unresolvedDeps(c.mutatedFiles), `${c.id} mutated has a missing dependency`).toEqual(
        [],
      );
      for (const [path, xml] of flowFiles(c.mutatedFiles)) {
        expect(xml, `${c.id} ${path} mutated missing <label>`).toMatch(/<label>[^<]+<\/label>/);
        expect(parseFlow(xml).errors, `${c.id} ${path} mutated parse errors`).toEqual([]);
      }
    }
  });
});
