// Full report to HTML. Pure and deterministic - no vscode import, no timestamp, no nonce - so it is
// unit-tested off-screen and previewed in plain browser. Shows phase-grouped tree with state
// badges and evidence popovers, state and type filters, dependency edges, seven risk indicators
// split by character, and SVG tree figure. Kept plain and legible: this is developer tooling.

import { exportSvg } from '../../persistence/exportSvg.js';
import type { ReconstructResult } from '../../core/cascade/reconstruct.js';
import type { ConfidenceState, ExecEdge, ExecNode } from '../../core/types.js';

const STATES: ConfidenceState[] = ['confirmed', 'inferred', 'unresolved', 'excluded'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function evidenceList(node: ExecNode): string {
  if (node.evidence.length === 0) {
    return '<p class="none">no evidence</p>';
  }
  const items = node.evidence
    .map((item) => {
      const detail = item.detail ? ` - ${escapeHtml(item.detail)}` : '';
      return `<li><code>${escapeHtml(item.type)}</code> ${escapeHtml(item.ref)}${detail}</li>`;
    })
    .join('');
  return `<ul class="evidence">${items}</ul>`;
}

function renderNode(node: ExecNode): string {
  const reason = node.excludeReason
    ? ` <span class="reason">${escapeHtml(node.excludeReason)}</span>`
    : '';
  const legacy = node.legacy ? ' <span class="legacy">legacy</span>' : '';
  return [
    `<li class="node state-${node.state}" data-state="${node.state}" data-type="${escapeHtml(node.type)}">`,
    `<details>`,
    `<summary>`,
    `<span class="badge badge-${node.state}">${node.state}</span>`,
    `<span class="type">${escapeHtml(node.type)}</span>`,
    `<span class="name">${escapeHtml(node.label)}</span>`,
    `<span class="score">${node.score.toFixed(2)}</span>`,
    legacy,
    reason,
    `</summary>`,
    evidenceList(node),
    `</details>`,
    `</li>`,
  ].join('');
}

function renderPhase(group: ReconstructResult['skeleton']['phases'][number]): string {
  const count = group.nodes.length;
  const legacy = group.legacy ? ' <span class="legacy">legacy</span>' : '';
  const async = group.sync ? '' : ' <span class="async">async</span>';
  const body =
    count > 0
      ? `<ul class="nodes">${group.nodes.map(renderNode).join('')}</ul>`
      : '<p class="empty">no participants</p>';
  return [
    `<section class="phase" data-phase="${escapeHtml(group.phase)}">`,
    `<details${count > 0 ? ' open' : ''}>`,
    `<summary>${escapeHtml(group.label)}${legacy}${async} <span class="count">${String(count)}</span></summary>`,
    body,
    `</details>`,
    `</section>`,
  ].join('');
}

function renderEdges(edges: ExecEdge[]): string {
  if (edges.length === 0) {
    return '<p class="none">no dependency edges reconstructed</p>';
  }
  const rows = edges
    .map(
      (edge) =>
        `<tr class="state-${edge.state}"><td>${escapeHtml(edge.from)}</td><td>${escapeHtml(edge.to)}</td>` +
        `<td><span class="badge badge-${edge.state}">${edge.state}</span></td><td>${edge.score.toFixed(2)}</td></tr>`,
    )
    .join('');
  return `<table class="edges"><thead><tr><th>from</th><th>to</th><th>state</th><th>score</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRisk(risk: ReconstructResult['risk']): string {
  const cards = risk
    .map((indicator) => {
      const detail = indicator.detail
        ? `<span class="rd">${escapeHtml(indicator.detail)}</span>`
        : '';
      return [
        `<div class="risk-item char-${indicator.character}${indicator.flagged ? ' flagged' : ''}">`,
        `<span class="rl">${escapeHtml(indicator.label)}</span>`,
        `<span class="rv">${String(indicator.value)}</span>`,
        `<span class="rc">${indicator.character}</span>`,
        detail,
        `</div>`,
      ].join('');
    })
    .join('');
  return `<div class="risk">${cards}</div>`;
}

function renderFilters(types: string[]): string {
  const boxes = STATES.map(
    (state) =>
      `<label><input type="checkbox" class="fstate" value="${state}" checked> ${state}</label>`,
  ).join('');
  const options = ['all', ...types]
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join('');
  return [
    '<div class="filters">',
    `<span class="fl">state</span> ${boxes}`,
    `<span class="fl">type</span> <select class="ftype">${options}</select>`,
    '</div>',
  ].join('');
}

const STYLE = [
  'body{font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:13px;margin:0;padding:14px;color:var(--vscode-foreground,#1f2328)}',
  'h1{font-size:15px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em;opacity:.7}',
  '.meta{opacity:.7;margin:0 0 10px}.flag{color:#cf222e;font-weight:600}',
  '.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px;border:1px solid var(--vscode-panel-border,#d0d7de);border-radius:6px;margin:0 0 12px}',
  '.filters .fl{font-weight:600;opacity:.7}.filters label{display:inline-flex;gap:3px;align-items:center}',
  '.phase{border-left:3px solid var(--vscode-panel-border,#d0d7de);margin:0 0 6px;padding-left:8px}',
  'summary{cursor:pointer}.phase>details>summary{font-weight:600}.count{opacity:.55;font-weight:400}',
  'ul.nodes{list-style:none;margin:4px 0 8px;padding:0}',
  '.node>details>summary{display:flex;gap:8px;align-items:center;padding:3px 0}',
  '.badge{font-size:11px;border-radius:10px;padding:1px 8px;color:#fff}',
  '.badge-confirmed{background:#1a7f37}.badge-inferred{background:#9a6700}.badge-unresolved{background:#656d76}.badge-excluded{background:#cf222e}',
  '.type{opacity:.65;font-family:monospace}.score{margin-left:auto;opacity:.6;font-variant-numeric:tabular-nums}',
  '.legacy,.async,.reason{font-size:11px;opacity:.7;font-style:italic}.reason{color:#cf222e}',
  '.state-excluded>details>summary .name{text-decoration:line-through;opacity:.6}',
  'ul.evidence{margin:2px 0 6px 26px;padding:0;list-style:square}ul.evidence code{font-size:11px}',
  '.empty,.none{opacity:.5;margin:4px 0}',
  'table.edges{border-collapse:collapse;font-size:12px;width:100%}table.edges th,table.edges td{text-align:left;border-bottom:1px solid var(--vscode-panel-border,#eaeef2);padding:3px 8px}',
  '.risk{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}',
  '.risk-item{border:1px solid var(--vscode-panel-border,#d0d7de);border-radius:6px;padding:8px;display:grid;gap:2px}',
  '.risk-item.flagged{border-color:#cf222e;box-shadow:inset 3px 0 0 #cf222e}',
  '.rl{font-weight:600}.rv{font-variant-numeric:tabular-nums;font-size:16px}.rc{font-size:11px;opacity:.6}.char-heuristic .rc{color:#9a6700}.rd{font-size:11px;opacity:.6}',
  '.figure{overflow-x:auto;border:1px solid var(--vscode-panel-border,#d0d7de);border-radius:6px;margin-top:6px}',
].join('');

const FILTER_SCRIPT = [
  'const nodes=[...document.querySelectorAll(".node")];',
  'function apply(){',
  'const states=new Set([...document.querySelectorAll(".fstate:checked")].map(c=>c.value));',
  'const type=document.querySelector(".ftype").value;',
  'for(const n of nodes){const ok=states.has(n.dataset.state)&&(type==="all"||n.dataset.type===type);n.style.display=ok?"":"none";}',
  '}',
  'document.querySelectorAll(".fstate,.ftype").forEach(el=>el.addEventListener("change",apply));',
  'apply();',
].join('');

// Full HTML report for one assembled run.
export function renderReport(result: ReconstructResult): string {
  const { meta } = result;
  const types = [...new Set(result.nodes.map((node) => node.type))].sort();
  const degraded =
    meta.degraded.length > 0
      ? ` <span class="flag">degraded: ${escapeHtml(meta.degraded.join(', '))}</span>`
      : '';
  const truncated = meta.truncated ? ' <span class="flag">truncated</span>' : '';

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';\">",
    '<title>Execution flow</title>',
    `<style>${STYLE}</style></head><body>`,
    `<h1>${escapeHtml(meta.object)} - ${escapeHtml(meta.event)}</h1>`,
    `<p class="meta">${String(result.nodes.length)} nodes, ${String(result.edges.length)} edges, ` +
      `depth ${String(meta.depthLimit)}${truncated}${degraded}</p>`,
    renderFilters(types),
    '<h2>Phases</h2>',
    result.skeleton.phases.map(renderPhase).join(''),
    '<h2>Dependency edges</h2>',
    renderEdges(result.edges),
    '<h2>Risk</h2>',
    renderRisk(result.risk),
    '<h2>Tree figure</h2>',
    `<div class="figure">${exportSvg(result)}</div>`,
    `<script>${FILTER_SCRIPT}</script>`,
    '</body></html>',
  ].join('');
}
