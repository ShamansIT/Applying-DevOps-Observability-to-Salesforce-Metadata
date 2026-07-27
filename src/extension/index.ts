// VS Code extension host - activation, one analysis command, and three export commands. Only layer
// that imports vscode. Analysis stays in core; this file is thin glue: pick inputs, run reconstruct,
// render each emission (L1 skeleton first, then final report), and write exports on demand.

import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { reconstruct, validatePhaseModel, validateWeights } from '../core/index.js';
import type { DmlEvent, PhaseModel, ReconstructResult, WeightModel } from '../core/index.js';
import { loadSnapshot } from '../ingestion/index.js';
import { exportJson, exportMarkdown, exportSvg } from '../persistence/index.js';
import { renderReport } from './webview/renderReport.js';
import { renderSkeleton } from './webview/renderSkeleton.js';

const DML_EVENTS: readonly DmlEvent[] = ['create', 'update', 'delete', 'undelete'];

function isDmlEvent(value: string): value is DmlEvent {
  return (DML_EVENTS as readonly string[]).includes(value);
}

// Most recent run, held so export commands have something to write.
let lastResult: ReconstructResult | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('sfObserver.reconstruct', () => runReconstruct(context)),
    vscode.commands.registerCommand('sfObserver.exportJson', () => exportRun('json')),
    vscode.commands.registerCommand('sfObserver.exportMarkdown', () => exportRun('markdown')),
    vscode.commands.registerCommand('sfObserver.exportSvg', () => exportRun('svg')),
  );
}

export function deactivate(): void {
  lastResult = undefined;
}

// Read one bundled asset (phase model, weights) next to packaged extension.
function readAsset<T>(context: vscode.ExtensionContext, name: string): T {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'assets', name);
  return JSON.parse(readFileSync(uri.fsPath, 'utf8')) as T;
}

// Pick snapshot, object and event, run cascade, render skeleton after each layer then report.
async function runReconstruct(context: vscode.ExtensionContext): Promise<void> {
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

  let model: PhaseModel;
  let weights: WeightModel;
  try {
    model = readAsset<PhaseModel>(context, 'phases.v67.json');
    weights = readAsset<WeightModel>(context, 'weights.json');
    validatePhaseModel(model);
    validateWeights(weights);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Analysis assets missing: ${String(error)} - run build first`,
    );
    return;
  }

  let snapshot;
  try {
    snapshot = loadSnapshot(uri.fsPath);
  } catch (error) {
    void vscode.window.showErrorMessage(`Snapshot load failed: ${String(error)}`);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'sfObserverFlow',
    `Execution flow - ${object}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );

  // Render skeleton after L1 so first feedback shows immediately; later emissions upgrade it.
  const result = reconstruct(snapshot, { object, event }, model, {
    weights,
    emit: (emission) => {
      panel.webview.html = renderSkeleton(emission.skeleton);
    },
  });
  panel.webview.html = renderReport(result);
  lastResult = result;
}

// Write last run in one format via save dialog.
async function exportRun(format: 'json' | 'markdown' | 'svg'): Promise<void> {
  if (!lastResult) {
    void vscode.window.showWarningMessage('Run a reconstruction first, then export.');
    return;
  }
  const spec = {
    json: { ext: 'json', body: exportJson(lastResult) },
    markdown: { ext: 'md', body: exportMarkdown(lastResult) },
    svg: { ext: 'svg', body: exportSvg(lastResult) },
  }[format];

  const target = await vscode.window.showSaveDialog({
    filters: { [format]: [spec.ext] },
    saveLabel: `Export ${format}`,
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(spec.body, 'utf8'));
  void vscode.window.showInformationMessage(`Exported ${format} to ${target.fsPath}`);
}
