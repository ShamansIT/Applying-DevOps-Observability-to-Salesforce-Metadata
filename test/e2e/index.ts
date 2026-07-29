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
  const commands = await vscode.commands.getCommands(true);
  for (const id of EXPECTED_COMMANDS) {
    ok(commands.includes(id), `command not registered: ${id}`);
  }
}
