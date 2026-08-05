import { finding } from '../findings.js';

export const id = 'event-name-length';

const GA4_LIMIT = 40;
const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;

export function run(events) {
  const findings = [];
  const seen = new Set();
  for (const event of events) {
    const name = event.eventName;
    if (!name || INTERNAL.test(name) || seen.has(`${event.platform}:${name}`)) continue;
    if (event.platform !== 'datalayer' && name.length === GA4_LIMIT) {
      seen.add(`${event.platform}:${name}`);
      findings.push(finding({
        rule: id,
        message: `${name} is exactly ${GA4_LIMIT} characters — GA4's limit — and was likely truncated from a longer name`,
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'Rename the source event to 40 characters or fewer; the truncated form is what all reports will show.',
        waiveKey: `${id}:${name}`,
      }));
    } else if (event.platform === 'datalayer' && name.length > GA4_LIMIT) {
      seen.add(`${event.platform}:${name}`);
      findings.push(finding({
        rule: id,
        message: `${name} is ${name.length} characters; GA4 will truncate it to ${GA4_LIMIT}`,
        evidence: ['(dataLayer)'],
        suggestion: 'Rename the event to 40 characters or fewer before it reaches the tag.',
        waiveKey: `${id}:${name}`,
      }));
    }
  }
  return findings;
}
