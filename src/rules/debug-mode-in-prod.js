import { finding } from '../findings.js';

export const id = 'debug-mode-in-prod';

export function run(events) {
  const findings = [];
  const seen = new Set();
  for (const event of events) {
    if (event.platform === 'datalayer') continue; // wire rule
    const dm = event.params.debug_mode;
    if (dm === undefined || dm === false || dm === 'false' || dm === '0') continue;
    const account = event.account ?? '(unknown)';
    if (seen.has(account)) continue;
    seen.add(account);
    findings.push(finding({
      rule: id,
      message: `${account} is receiving hits with debug_mode enabled`,
      evidence: [event.raw.url ?? '(dataLayer)'],
      suggestion: 'debug_mode routes traffic into DebugView and can skew BigQuery exports; strip it outside development.',
      waiveKey: `${id}:${account}`,
    }));
  }
  return findings;
}
