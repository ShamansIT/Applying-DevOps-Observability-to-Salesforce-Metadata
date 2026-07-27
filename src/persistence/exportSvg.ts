// SVG export of phase-grouped tree. Deterministic layout - fixed geometry, no random, no timestamp -
// so it is stable and usable directly as dissertation figure. White background, state-coloured
// node boxes, phases in pinned order. Pure.

import type { ReconstructResult } from '../core/cascade/reconstruct.js';
import type { ConfidenceState, ExecNode } from '../core/types.js';

const WIDTH = 760;
const PAD = 16;
const PHASE_H = 26;
const NODE_H = 24;
const GAP = 6;
const INDENT = 24;

// State to stroke and fill. Chosen for legibility on white, so figure prints cleanly.
const STATE_COLOR: Record<ConfidenceState, { stroke: string; fill: string }> = {
  confirmed: { stroke: '#1a7f37', fill: '#dafbe1' },
  inferred: { stroke: '#9a6700', fill: '#fff8c5' },
  unresolved: { stroke: '#656d76', fill: '#eaeef2' },
  excluded: { stroke: '#cf222e', fill: '#ffebe9' },
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeBox(node: ExecNode, y: number): string {
  const color = STATE_COLOR[node.state];
  const label = `${node.label} [${node.type}] ${node.state}`;
  return [
    `<rect x="${String(PAD + INDENT)}" y="${String(y)}" width="${String(WIDTH - PAD * 2 - INDENT)}" height="${String(NODE_H)}" rx="4" `,
    `fill="${color.fill}" stroke="${color.stroke}" />`,
    `<text x="${String(PAD + INDENT + 8)}" y="${String(y + 16)}" font-size="12" fill="#1f2328">${escapeXml(label)}</text>`,
  ].join('');
}

// Render phase-grouped tree. Only phases with nodes are drawn, in pinned order, each numbered by its
// position so backbone order stays visible.
export function exportSvg(result: ReconstructResult): string {
  const parts: string[] = [];
  let y = PAD;

  parts.push(
    `<text x="${String(PAD)}" y="${String(y + 14)}" font-size="15" font-weight="600" fill="#1f2328">` +
      `${escapeXml(result.meta.object)} - ${escapeXml(result.meta.event)}</text>`,
  );
  y += PHASE_H + GAP;

  result.skeleton.phases.forEach((group, index) => {
    if (group.nodes.length === 0) {
      return;
    }
    const flags = group.legacy ? ' (legacy)' : group.sync ? '' : ' (async)';
    parts.push(
      `<text x="${String(PAD)}" y="${String(y + 16)}" font-size="13" font-weight="600" fill="#57606a">` +
        `${String(index + 1)}. ${escapeXml(group.label)}${flags}</text>`,
    );
    y += PHASE_H;
    for (const node of group.nodes) {
      parts.push(nodeBox(node, y));
      y += NODE_H + GAP;
    }
    y += GAP;
  });

  const height = y + PAD;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(height)}" `,
    `viewBox="0 0 ${String(WIDTH)} ${String(height)}" font-family="sans-serif">`,
    `<rect width="${String(WIDTH)}" height="${String(height)}" fill="#ffffff" />`,
    parts.join(''),
    '</svg>',
    '',
  ].join('\n');
}
