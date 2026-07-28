// Skeleton to HTML. Pure and deterministic - no vscode import, no timestamps, no nonce - so same
// skeleton always yields same markup and can be unit-tested off-screen. Extension host wraps result
// in webview panel and re-renders on each cascade emission (L1 backbone first, then L2 nodes).

import type { PhaseGroup, Skeleton } from '../../core/cascade/reconstruct.js';
import type { ConfidenceState } from '../../core/types.js';

// Short badge text per confidence state. Kept terse for dense phase-grouped list.
const STATE_BADGE: Record<ConfidenceState, string> = {
  confirmed: 'confirmed',
  inferred: 'inferred',
  unresolved: 'unresolved',
  excluded: 'excluded',
};

// Escape text for safe placement in HTML body and attributes.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderNode(node: PhaseGroup['nodes'][number]): string {
  const badge = STATE_BADGE[node.state];
  const legacy = node.legacy ? ' <span class="legacy">legacy</span>' : '';
  return [
    `<li class="node state-${node.state}">`,
    `<span class="badge">${badge}</span>`,
    `<span class="type">${escapeHtml(node.type)}</span>`,
    `<span class="name">${escapeHtml(node.label)}</span>`,
    legacy,
    `</li>`,
  ].join('');
}

function renderPhase(group: PhaseGroup): string {
  const count = group.nodes.length;
  const open = count > 0 ? ' open' : '';
  const legacy = group.legacy ? ' <span class="legacy">legacy</span>' : '';
  const async = group.sync ? '' : ' <span class="async">async</span>';
  const items = group.nodes.map(renderNode).join('');
  return [
    `<section class="phase" data-phase="${escapeHtml(group.phase)}">`,
    `<details${open}>`,
    `<summary>${escapeHtml(group.label)}${legacy}${async} <span class="count">${String(count)}</span></summary>`,
    count > 0 ? `<ul>${items}</ul>` : `<p class="empty">no participants</p>`,
    `</details>`,
    `</section>`,
  ].join('');
}

// Austere first-paint backbone: zero radius, hairline rules, square state marks - matches report.
const STYLE = [
  ':root{--ink:#15181c;--body:#2a3038;--muted:#606a76;--rule:#d3d8de;--rule-strong:#9aa4af;--ground:#ffffff;--confirmed:#186a3a;--inferred:#8a5800;--unresolved:#5b6673;--excluded:#a01b0f}',
  '*{box-sizing:border-box}',
  'body{font-family:var(--vscode-font-family,"Segoe UI",system-ui,sans-serif);font-size:13px;line-height:1.45;margin:0;padding:18px;color:var(--body);background:var(--ground)}',
  'h1{font-size:15px;font-weight:600;color:var(--ink);margin:0 0 2px}',
  '.meta{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted);margin:0 0 14px}',
  '.phase{border-left:2px solid var(--rule-strong);margin:0;padding-left:10px}',
  'summary{cursor:pointer;font-weight:600;color:var(--ink);padding:3px 0;border-bottom:1px solid var(--rule)}',
  '.count{color:var(--muted);font-weight:400;font-family:ui-monospace,Consolas,monospace}',
  'ul{list-style:none;margin:0 0 10px;padding:0}',
  '.node{display:flex;gap:10px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--rule)}',
  '.badge{position:relative;padding-left:15px;flex:none;width:84px;font-family:ui-monospace,Consolas,monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}',
  '.badge::before{content:"";position:absolute;left:0;top:2px;width:9px;height:9px;background:var(--unresolved)}',
  '.state-confirmed .badge::before{background:var(--confirmed)}.state-inferred .badge::before{background:var(--inferred)}.state-excluded .badge::before{background:var(--excluded)}',
  '.type{flex:none;width:118px;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted)}',
  '.name{color:var(--ink)}',
  '.legacy,.async{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}',
  '.empty{color:var(--muted);font-size:12px;margin:2px 0 8px}',
  '.state-excluded .name{text-decoration:line-through;color:var(--muted)}',
].join('');

// Full HTML document for one skeleton. Header restates subject and counts; phases render in pinned
// order as collapsible groups.
export function renderSkeleton(skeleton: Skeleton): string {
  const { target } = skeleton;
  const phases = skeleton.phases.map(renderPhase).join('');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
    '<title>Execution flow</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(target.object)} - ${escapeHtml(target.event)}</h1>`,
    `<p class="meta">${String(skeleton.nodeCount)} nodes across ${String(skeleton.phases.length)} phases, ` +
      `${String(skeleton.candidateCount)} candidates</p>`,
    phases,
    '</body>',
    '</html>',
  ].join('');
}
