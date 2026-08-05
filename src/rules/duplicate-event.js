import { finding } from '../findings.js';
import { stableStringify } from '../tag-event.js';

export const id = 'duplicate-event';

const DEFAULT_WINDOW_MS = 2000;

export function run(events, ctx = {}) {
  const windowMs = ctx.duplicateWindowMs ?? DEFAULT_WINDOW_MS;
  const open = new Map();
  const findings = [];

  const close = (group) => {
    if (group.count < 2) return;
    const span = group.last.timestamp - group.first.timestamp;
    findings.push(finding({
      rule: id,
      message: `${group.first.eventName} fired ${group.count} times on ${group.first.platform} within ${span}ms with identical parameters`,
      evidence: group.evidence.slice(0, 4),
      suggestion: 'Deduplicate the trigger, or set `once_per` for this event in tracking-plan.yml if the repeat is intentional.',
      waiveKey: `${id}:${group.first.platform}:${group.first.eventName}`,
    }));
  };

  for (const event of events) {
    // Events with no real timestamp cannot be windowed. Position is not time.
    if (!event.eventName || event.timestamp === null) continue;
    const key = `${event.platform}|${event.account ?? ''}|${event.eventName}|${event.pageUrl ?? ''}|${dedupeKey(event)}`;
    const group = open.get(key);
    if (group && event.timestamp - group.last.timestamp <= windowMs) {
      group.count += 1;
      group.last = event;
      group.evidence.push(event.raw.url ?? '(dataLayer)');
    } else {
      if (group) close(group);
      open.set(key, { count: 1, first: event, last: event, evidence: [event.raw.url ?? '(dataLayer)'] });
    }
  }
  for (const group of open.values()) close(group);
  return findings;
}

function dedupeKey(event) {
  if (event.params.transaction_id != null) return `tx:${event.params.transaction_id}`;
  return `params:${stableStringify(event.params)}`;
}
