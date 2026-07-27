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

const STYLE = [
  'body{font-family:var(--vscode-font-family,sans-serif);font-size:13px;margin:0;padding:12px}',
  'h1{font-size:14px;margin:0 0 4px}',
  '.meta{opacity:.7;margin:0 0 12px}',
  '.phase{border-left:3px solid var(--vscode-panel-border,#8884);margin:0 0 6px;padding-left:8px}',
  'summary{cursor:pointer;font-weight:600}',
  '.count{opacity:.6;font-weight:400}',
  'ul{list-style:none;margin:4px 0 8px;padding:0}',
  '.node{display:flex;gap:8px;align-items:center;padding:2px 0}',
  '.badge{font-size:11px;border-radius:3px;padding:0 6px;background:var(--vscode-badge-background,#8884)}',
  '.type{opacity:.7;font-family:monospace}',
  '.legacy,.async{font-size:11px;opacity:.6;font-style:italic}',
  '.empty{opacity:.5;margin:4px 0 8px}',
  '.state-excluded{opacity:.55;text-decoration:line-through}',
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
