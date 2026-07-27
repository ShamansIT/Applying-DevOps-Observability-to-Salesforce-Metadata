// Markdown export for human review. Phase-grouped node list with states and evidence, plus risk
// table split by character. No timestamps, so output is stable. Pure.

import type { ReconstructResult } from '../core/cascade/reconstruct.js';
import type { ExecNode } from '../core/types.js';

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function nodeLine(node: ExecNode): string {
  const reason = node.excludeReason ? ` (${node.excludeReason})` : '';
  const legacy = node.legacy ? ' _legacy_' : '';
  const evidence = node.evidence.map((item) => item.type).join(', ');
  return `- \`${node.state}\` **${escapePipes(node.label)}** [${node.type}]${legacy}${reason} - score ${node.score.toFixed(2)} - ${evidence || 'no evidence'}`;
}

// Full Markdown report for one run.
export function exportMarkdown(result: ReconstructResult): string {
  const { meta } = result;
  const lines: string[] = [];

  lines.push(`# Execution flow - ${meta.object} ${meta.event}`, '');
  lines.push(
    `Snapshot API ${meta.snapshotApiVersion ?? 'n/a'}, phase model ${meta.phaseModelApiVersion ?? 'n/a'}, ` +
      `depth ${String(meta.depthLimit)}${meta.truncated ? ', truncated' : ''}.`,
    '',
  );
  if (meta.degraded.length > 0) {
    lines.push(`Degraded: ${meta.degraded.join(', ')}.`, '');
  }

  lines.push('## Phases', '');
  for (const group of result.skeleton.phases) {
    if (group.nodes.length === 0) {
      continue;
    }
    const flags = [group.legacy ? 'legacy' : '', group.sync ? '' : 'async']
      .filter(Boolean)
      .join(', ');
    lines.push(`### ${group.label}${flags ? ` (${flags})` : ''}`);
    for (const node of group.nodes) {
      lines.push(nodeLine(node));
    }
    lines.push('');
  }

  lines.push('## Dependency edges', '');
  if (result.edges.length === 0) {
    lines.push('None reconstructed.', '');
  } else {
    lines.push('| From | To | State | Score | Evidence |', '| --- | --- | --- | --- | --- |');
    for (const edge of result.edges) {
      const evidence = edge.evidence.map((item) => item.type).join(', ');
      lines.push(
        `| ${escapePipes(edge.from)} | ${escapePipes(edge.to)} | ${edge.state} | ${edge.score.toFixed(2)} | ${evidence} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Risk indicators', '');
  lines.push('| Indicator | Character | Value | Flagged |', '| --- | --- | --- | --- |');
  for (const indicator of result.risk) {
    lines.push(
      `| ${indicator.label} | ${indicator.character} | ${String(indicator.value)} | ${indicator.flagged ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
