import { finding } from '../findings.js';
import { stableStringify } from '../tag-event.js';

export const id = 'duplicate-event';

const DEFAULT_WINDOW_MS = 2000;

export function run(events, ctx = {}) {
  const windowMs = ctx.duplicateWindowMs ?? DEFAULT_WINDOW_MS;
  const findings = [];
  const seen = new Map();

  for (const event of events) {
    // Events with no real timestamp cannot be windowed. Position is not time.
    if (!event.eventName || event.timestamp === null) continue;
    const key = `${event.platform}|${event.account ?? ''}|${event.eventName}|${dedupeKey(event)}`;
    const prior = seen.get(key);
    if (prior && Math.abs(event.timestamp - prior.timestamp) <= windowMs) {
      findings.push(finding({
        rule: id,
        message: `${event.eventName} fired twice on ${event.platform} within ${Math.abs(event.timestamp - prior.timestamp)}ms with identical parameters`,
        evidence: [prior.raw.url ?? '(dataLayer)', event.raw.url ?? '(dataLayer)'],
        suggestion: 'Deduplicate the trigger, or set `once_per` for this event in tracking-plan.yml if the repeat is intentional.',
        waiveKey: `${id}:${event.platform}:${event.eventName}`,
      }));
    }
    seen.set(key, event);
  }
  return findings;
}

function dedupeKey(event) {
  if (event.params.transaction_id != null) return `tx:${event.params.transaction_id}`;
  return `params:${stableStringify(event.params)}`;
}
