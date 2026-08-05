export function renderReport(findings, { events = [] } = {}) {
  const lines = [];
  const platforms = [...new Set(events.map((e) => e.platform))].sort();

  lines.push(`Decoded ${events.length} event${events.length === 1 ? '' : 's'} across: ${platforms.join(', ') || '(none)'}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No advisory findings.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`${findings.length} advisory finding${findings.length === 1 ? '' : 's'} — these do not fail the run:`);
  lines.push('');

  for (const item of findings) {
    lines.push(`  [${item.rule}] ${item.message}`);
    for (const evidence of item.evidence) lines.push(`      ${evidence}`);
    if (item.suggestion) lines.push(`      -> ${item.suggestion}`);
    lines.push(`      waive with: ${item.waiveKey}`);
    lines.push('');
  }

  return lines.join('\n');
}
