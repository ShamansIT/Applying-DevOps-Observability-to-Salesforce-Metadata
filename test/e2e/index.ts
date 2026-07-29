// e2e smoke suite. Runs inside real VS Code instance under @vscode/test-electron (not vitest), so
// it confirms extension loads and its commands are contributed end to end. Kept to smoke:
// registration only, no interactive command runs.

import { ok } from 'node:assert';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'sfObserver.reconstruct',
  'sfObserver.exportJson',
  'sfObserver.exportMarkdown',
  'sfObserver.exportSvg',
];

export async function run(): Promise<void> {
  // activationEvents is empty, so nothing activates the extension on its own. Find it by name - no
  // publisher is set, so the id is auto-assigned - and activate it before its commands can register.
  const extension = vscode.extensions.all.find(
    (candidate) =>
      (candidate.packageJSON as { name?: string }).name === 'sf-observer-order-of-execution',
  );
  ok(extension, 'extension not found in host');
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of EXPECTED_COMMANDS) {
    ok(commands.includes(id), `command not registered: ${id}`);
  }
}
