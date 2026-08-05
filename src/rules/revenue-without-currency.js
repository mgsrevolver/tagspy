import { finding } from '../findings.js';

export const id = 'revenue-without-currency';

export function run(events) {
  const findings = [];
  for (const event of events) {
    if (event.platform === 'datalayer') continue; // wire rule: the network hit is ground truth
    const { value, currency } = event.params;
    if (value === undefined || value === null) continue;
    if (currency) continue;
    findings.push(finding({
      rule: id,
      message: `${event.eventName ?? 'event'} on ${event.platform} sends value=${value} with no currency`,
      evidence: [event.raw.url ?? '(dataLayer)'],
      suggestion: 'GA4 discards revenue when currency is absent. Send currency alongside value, or set a default currency on the property.',
      waiveKey: `${id}:${event.platform}:${event.eventName ?? ''}`,
    }));
  }
  return findings;
}
