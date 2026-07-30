// Scenario materialiser. Turns a frozen base project plus one controlled mutation into a materialised
// scenario: the mutated file map with a `mutation-manifest.json` written alongside, the base and
// mutated checksums, and the manifest. Pure - it operates on file maps, so a scenario re-materialises
// byte-for-byte and can be unit-tested without touching a scratch org. Writing to disk is a separate
// step (see project.ts), so setup cost stays out of the pure build.

import { applyMutation } from './mutation.js';
import type { FileMap, MutationManifest, MutationSpec } from './mutation.js';
import { projectChecksum } from './project.js';

// A base topology is a known-valid metadata project representing one automation structure.
export interface BaseTopology {
  id: string;
  version: string;
  object: string;
  event: string;
  cluster: 'declarative' | 'programmatic' | 'mixed';
  complexity: 'low' | 'medium' | 'high';
  crossObject: boolean;
}

export interface MaterialisedScenario {
  scenarioId: string;
  files: FileMap; // mutated project plus mutation-manifest.json
  manifest: MutationManifest;
  baseChecksum: string;
  mutatedChecksum: string;
}

const MANIFEST_FILE = 'mutation-manifest.json';

// Build one scenario. The base is verified by checksum before mutation; the mutated checksum stamps
// the result. The manifest is written into the file map so the on-disk scenario is self-describing.
export function buildScenario(
  scenarioId: string,
  baseFiles: FileMap,
  spec: MutationSpec,
  expectedBaseChecksum?: string,
): MaterialisedScenario {
  const baseChecksum = projectChecksum(baseFiles);
  if (expectedBaseChecksum !== undefined && expectedBaseChecksum !== baseChecksum) {
    throw new Error(
      `materialise ${scenarioId}: base checksum mismatch, expected ${expectedBaseChecksum} got ${baseChecksum}`,
    );
  }
  const { files, manifest } = applyMutation(baseFiles, spec);
  const withManifest: FileMap = {
    ...files,
    [MANIFEST_FILE]: `${JSON.stringify(manifest, null, 2)}\n`,
  };
  return {
    scenarioId,
    files: withManifest,
    manifest,
    baseChecksum,
    mutatedChecksum: projectChecksum(withManifest),
  };
}
