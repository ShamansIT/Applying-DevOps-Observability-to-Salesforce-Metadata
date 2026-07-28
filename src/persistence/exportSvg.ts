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

// State to stripe colour. Boxes stay white with thin border and one coloured left stripe, so
// figure reads as plain ruled report rather than coloured blocks.
const STATE_STRIPE: Record<ConfidenceState, string> = {
  confirmed: '#186a3a',
  inferred: '#8a5800',
  unresolved: '#5b6673',
  excluded: '#a01b0f',
};

const BOX_STROKE = '#c4ccd4';
const RULE = '#9aa4af';
const INK = '#15181c';
const MUTED = '#5b6673';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeBox(node: ExecNode, y: number): string {
  const stripe = STATE_STRIPE[node.state];
  const bx = PAD + INDENT;
  const bw = WIDTH - PAD * 2 - INDENT;
  const label = `${node.label} [${node.type}] ${node.state}`;
  return [
    `<rect x="${String(bx)}" y="${String(y)}" width="${String(bw)}" height="${String(NODE_H)}" fill="#ffffff" stroke="${BOX_STROKE}" />`,
    `<rect x="${String(bx)}" y="${String(y)}" width="4" height="${String(NODE_H)}" fill="${stripe}" />`,
    `<text x="${String(bx + 12)}" y="${String(y + 16)}" font-size="12" fill="${INK}">${escapeXml(label)}</text>`,
  ].join('');
}

// Render phase-grouped tree. Only phases with nodes are drawn, in pinned order, each numbered by its
// position so backbone order stays visible.
export function exportSvg(result: ReconstructResult): string {
  const parts: string[] = [];
  let y = PAD;

  parts.push(
    `<text x="${String(PAD)}" y="${String(y + 14)}" font-size="15" font-weight="600" fill="${INK}">` +
      `${escapeXml(result.meta.object)} - ${escapeXml(result.meta.event)}</text>`,
    `<line x1="${String(PAD)}" y1="${String(y + 22)}" x2="${String(WIDTH - PAD)}" y2="${String(y + 22)}" stroke="${RULE}" />`,
  );
  y += PHASE_H + GAP;

  result.skeleton.phases.forEach((group, index) => {
    if (group.nodes.length === 0) {
      return;
    }
    const flags = group.legacy ? ' (legacy)' : group.sync ? '' : ' (async)';
    parts.push(
      `<text x="${String(PAD)}" y="${String(y + 16)}" font-size="11" font-weight="700" fill="${MUTED}" ` +
        `letter-spacing="0.5" style="text-transform:uppercase">` +
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
