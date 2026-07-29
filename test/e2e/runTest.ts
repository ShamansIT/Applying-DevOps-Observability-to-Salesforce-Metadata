// e2e launcher. Downloads pinned VS Code, loads this repository as extension under
// development, and runs smoke suite inside it. Needs display (or xvfb on CI) and network for
// VS Code download, so it runs on human machine and CI, not in offline unit run.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const extensionDevelopmentPath = resolve(here, '..', '..'); // repository root
  const extensionTestsPath = resolve(here, 'suite.cjs'); // compiled smoke suite
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

void main().catch((error: unknown) => {
  process.stderr.write(`e2e failed: ${String(error)}\n`);
  process.exit(1);
});
