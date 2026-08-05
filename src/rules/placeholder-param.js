import { finding } from '../findings.js';

export const id = 'placeholder-param';

const PLACEHOLDERS = new Set(['undefined', 'null', 'nan', '[object object]', '']);

export function run(events) {
  const findings = [];
  const seen = new Set();
  for (const event of events) {
    if (event.platform === 'datalayer') continue; // wire rule
    for (const [key, value] of Object.entries(event.params)) {
      if (typeof value !== 'string' || !PLACEHOLDERS.has(value.trim().toLowerCase())) continue;
      // Account-scoped: the same broken mapping on two properties is two defects.
      const dedupe = `${event.account ?? ''}:${event.platform}:${event.eventName}:${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      findings.push(finding({
        rule: id,
        message: `${event.eventName ?? 'event'} sends ${key}=${JSON.stringify(value)} — a serialization placeholder, not data`,
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'A literal "undefined"/"null"/empty value usually means the source variable was never populated. Fix the mapping.',
        waiveKey: `${id}:${event.eventName ?? ''}:${key}`,
      }));
    }
    if (event.eventName === 'purchase' && event.params.value === 0 && !seen.has(`purchase:zero:${event.account ?? ''}`)) {
      seen.add(`purchase:zero:${event.account ?? ''}`);
      findings.push(finding({
        rule: id,
        message: 'purchase fired with value=0 — revenue is being reported as zero',
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'If genuinely free, waive this; otherwise the value mapping is broken at the source.',
        waiveKey: `${id}:purchase:zero-value`,
      }));
    }
  }
  return findings;
}
