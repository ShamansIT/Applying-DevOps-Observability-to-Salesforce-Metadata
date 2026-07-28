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

// Austere, ruled report: zero radius, hairline rules, monospace data columns, square state marks.
const STYLE = [
  ':root{--ink:#15181c;--body:#2a3038;--muted:#606a76;--rule:#d3d8de;--rule-strong:#9aa4af;--head:#eef1f4;--ground:#ffffff;--confirmed:#186a3a;--inferred:#8a5800;--unresolved:#5b6673;--excluded:#a01b0f}',
  '*{box-sizing:border-box}',
  'body{font-family:var(--vscode-font-family,"Segoe UI",system-ui,sans-serif);font-size:13px;line-height:1.45;margin:0;padding:18px;color:var(--body);background:var(--ground)}',
  'h1{font-size:15px;font-weight:600;color:var(--ink);margin:0 0 2px}',
  'h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--rule-strong)}',
  '.meta{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted);margin:0 0 14px}',
  '.flag{color:var(--excluded);font-weight:700;text-transform:uppercase;letter-spacing:.04em}',
  '.filters{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--rule);margin:0 0 14px}',
  '.filters .fl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}',
  '.filters label{display:inline-flex;gap:5px;align-items:center;font-size:12px}',
  '.filters select{font:12px/1 inherit;border:1px solid var(--rule-strong);padding:2px 4px;background:var(--ground);color:var(--body)}',
  '.phase{border-left:2px solid var(--rule-strong);margin:0;padding-left:10px}',
  'summary{cursor:pointer}.phase>details>summary{font-weight:600;color:var(--ink);padding:3px 0;border-bottom:1px solid var(--rule)}',
  '.count{color:var(--muted);font-weight:400;font-family:ui-monospace,Consolas,monospace}',
  'ul.nodes{list-style:none;margin:0 0 10px;padding:0}',
  '.node>details>summary{display:flex;gap:10px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--rule)}',
  '.badge{position:relative;padding-left:15px;flex:none;width:84px;font-family:ui-monospace,Consolas,monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}',
  '.badge::before{content:"";position:absolute;left:0;top:2px;width:9px;height:9px}',
  '.badge-confirmed::before{background:var(--confirmed)}.badge-inferred::before{background:var(--inferred)}.badge-unresolved::before{background:var(--unresolved)}.badge-excluded::before{background:var(--excluded)}',
  '.type{flex:none;width:118px;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted)}',
  '.name{color:var(--ink)}',
  '.score{margin-left:auto;font-family:ui-monospace,Consolas,monospace;color:var(--muted);font-variant-numeric:tabular-nums}',
  '.legacy,.async,.reason{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.reason{color:var(--excluded)}',
  '.state-excluded>details>summary .name{text-decoration:line-through;color:var(--muted)}',
  'ul.evidence{margin:3px 0 8px 99px;padding:0 0 0 10px;list-style:none;border-left:1px solid var(--rule)}',
  'ul.evidence li{padding:1px 0;font-size:12px;color:var(--body)}',
  'ul.evidence code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted)}',
  '.empty,.none{color:var(--muted);font-size:12px;margin:2px 0 8px}',
  'table.edges{border-collapse:collapse;font-size:12px;width:100%;border:1px solid var(--rule)}',
  'table.edges th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);background:var(--head);border-bottom:1px solid var(--rule-strong);padding:5px 8px}',
  'table.edges td{border-bottom:1px solid var(--rule);padding:4px 8px;font-family:ui-monospace,Consolas,monospace}',
  'table.edges tr:last-child td{border-bottom:0}',
  'table.edges .badge{width:auto}',
  '.risk{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));border-top:1px solid var(--rule);border-left:1px solid var(--rule)}',
  '.risk-item{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);border-left:3px solid transparent;padding:8px 10px}',
  '.risk-item.flagged{border-left-color:var(--excluded)}',
  '.rl{display:block;font-weight:600;color:var(--ink);font-size:12px;margin-bottom:2px}',
  '.rv{font-family:ui-monospace,Consolas,monospace;font-size:19px;font-variant-numeric:tabular-nums;color:var(--ink)}',
  '.rc{margin-left:8px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.char-heuristic .rc{color:var(--inferred)}',
  '.rd{display:block;font-size:11px;color:var(--muted);margin-top:2px}',
  '.figure{overflow-x:auto;border:1px solid var(--rule);margin-top:6px}',
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
