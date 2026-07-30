import { describe, expect, it } from 'vitest';
import {
  TOPOLOGY_FAMILIES,
  generateTopologyInstances,
} from '../../src/experiment/topologyGenerator.js';

describe('generateTopologyInstances', () => {
  const instances = generateTopologyInstances(3);

  it('covers eight families with three instances each', () => {
    expect(TOPOLOGY_FAMILIES).toHaveLength(8);
    expect(instances).toHaveLength(24);
    for (const family of TOPOLOGY_FAMILIES) {
      expect(instances.filter((i) => i.familyId === family)).toHaveLength(3);
    }
  });

  it('emits a deployable project skeleton with components', () => {
    for (const instance of instances) {
      expect(instance.files['sfdx-project.json']).toBeDefined();
      const componentFiles = Object.keys(instance.files).filter(
        (p) =>
          p.includes('/classes/') ||
          p.includes('/triggers/') ||
          p.includes('/flows/') ||
          p.includes('/validationRules/'),
      );
      expect(componentFiles.length).toBeGreaterThan(0);
    }
  });

  it('produces a graph the core can match, with typed edges', () => {
    const mixed = instances.find((i) => i.familyId === 'mixed_single');
    expect(mixed?.expectedNodes.length).toBeGreaterThan(0);
    expect(mixed?.expectedEdges.some((e) => e.relationship === 'writes')).toBe(true);
  });

  it('gives every instance a distinct checksum', () => {
    const checksums = new Set(instances.map((i) => i.checksum));
    expect(checksums.size).toBe(instances.length);
  });

  it('covers all three clusters', () => {
    const clusters = new Set(instances.map((i) => i.cluster));
    expect(clusters).toEqual(new Set(['declarative', 'programmatic', 'mixed']));
  });

  it('makes instances structurally distinct within a family', () => {
    const family = instances.filter((i) => i.familyId === 'declarative_single');
    const fingerprints = new Set(family.map((i) => JSON.stringify(i.fingerprint)));
    expect(fingerprints.size).toBe(family.length);
  });

  it('is deterministic', () => {
    expect(generateTopologyInstances(3)).toEqual(instances);
  });
});
