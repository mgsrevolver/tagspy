import { finding } from '../findings.js';

export const id = 'event-name-length';

const GA4_LIMIT = 40;
const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;

export function run(events) {
  const findings = [];
  // Dedupe on the 40-char prefix: a truncated wire name and its full-length
  // container source are the same defect and must yield one finding.
  const seen = new Set();
  for (const event of events) {
    const name = event.eventName;
    if (!name || INTERNAL.test(name) || seen.has(name.slice(0, GA4_LIMIT))) continue;
    const len = [...name].length; // GA4's limit is characters, not UTF-16 units
    if (event.platform !== 'datalayer' && len === GA4_LIMIT) {
      seen.add(name.slice(0, GA4_LIMIT));
      findings.push(finding({
        rule: id,
        message: `${name} is exactly ${GA4_LIMIT} characters — GA4's limit — and was likely truncated from a longer name`,
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'Rename the source event to 40 characters or fewer; the truncated form is what all reports will show.',
        waiveKey: `${id}:${name}`,
      }));
    } else if (event.platform === 'datalayer' && len > GA4_LIMIT) {
      seen.add(name.slice(0, GA4_LIMIT));
      findings.push(finding({
        rule: id,
        message: `${name} is ${len} characters; GA4 will truncate it to ${GA4_LIMIT}`,
        evidence: ['(dataLayer)'],
        suggestion: 'Rename the event to 40 characters or fewer before it reaches the tag.',
        waiveKey: `${id}:${name}`,
      }));
    }
  }
  return findings;
}
