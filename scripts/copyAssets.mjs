// Copy runtime data files next to bundled extension, so packaged code resolves them without
// import.meta paths. Runs after esbuild in build:extension script.
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'dist', 'assets');
mkdirSync(dest, { recursive: true });

const assets = [
  ['src', 'core', 'phases', 'phases.v67.json'],
  ['config', 'weights.json'],
];

for (const parts of assets) {
  const from = join(root, ...parts);
  const to = join(dest, parts[parts.length - 1]);
  copyFileSync(from, to);
  process.stdout.write(`copied ${parts.join('/')} -> dist/assets/${parts[parts.length - 1]}\n`);
}
