// VS Code extension host - activation and one command that runs cascade over snapshot and shows
// phase-grouped skeleton in webview. Only layer that imports vscode. Analysis stays in core;
// this file is thin glue: pick inputs, call reconstruct, render each emission.

import * as vscode from 'vscode';
import { loadPhaseModel, reconstruct } from '../core/index.js';
import type { DmlEvent } from '../core/index.js';
import { loadSnapshot } from '../ingestion/index.js';
import { renderSkeleton } from './webview/renderSkeleton.js';

const DML_EVENTS: readonly DmlEvent[] = ['create', 'update', 'delete', 'undelete'];

function isDmlEvent(value: string): value is DmlEvent {
  return (DML_EVENTS as readonly string[]).includes(value);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('sfObserver.reconstruct', () => runReconstruct()),
  );
}

export function deactivate(): void {
  // nothing to tear down; webview panels dispose with their editor
}

// Pick snapshot, object and event, run cascade, render skeleton after each layer. Render on every
// emission wires progressive display: L1 backbone shows first, L2 fills phases.
async function runReconstruct(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Select org snapshot',
    filters: { 'Snapshot JSON': ['json'] },
  });
  const uri = picked?.[0];
  if (!uri) {
    return;
  }

  const object = await vscode.window.showInputBox({
    prompt: 'Object API name',
    placeHolder: 'Account',
  });
  if (!object) {
    return;
  }

  const event = await vscode.window.showQuickPick([...DML_EVENTS], { placeHolder: 'DML event' });
  if (!event || !isDmlEvent(event)) {
    return;
  }

  let snapshot;
  try {
    snapshot = loadSnapshot(uri.fsPath);
  } catch (error) {
    void vscode.window.showErrorMessage(`Snapshot load failed: ${String(error)}`);
    return;
  }

  const model = loadPhaseModel();
  const panel = vscode.window.createWebviewPanel(
    'sfObserverFlow',
    `Execution flow - ${object}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  reconstruct(snapshot, { object, event }, model, {
    emit: (emission) => {
      panel.webview.html = renderSkeleton(emission.skeleton);
    },
  });
}
