import { finding } from '../findings.js';

export const id = 'naming-collision';

const GA4_AUTO = new Set([
  'page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll',
  'click', 'file_download', 'form_start', 'form_submit', 'video_start',
  'video_progress', 'video_complete', 'view_search_results',
]);
const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;
const CAMEL = /[a-z][A-Z]/;

export function run(events) {
  const names = [...new Set(
    events
      .filter((e) => e.platform === 'datalayer' && typeof e.eventName === 'string' && !INTERNAL.test(e.eventName))
      .map((e) => e.eventName),
  )];
  const findings = [];

  for (const name of names) {
    if (GA4_AUTO.has(name)) {
      findings.push(finding({
        rule: id,
        message: `${name} shadows a GA4 automatically-collected event name`,
        evidence: ['(dataLayer)'],
        suggestion: 'Custom events reusing automatic names merge confusingly in reports. Pick a distinct name.',
        waiveKey: `${id}:shadow:${name}`,
      }));
    }
  }

  const normalized = new Map();
  for (const name of names) {
    const norm = name.toLowerCase().replace(/_/g, '');
    if (normalized.has(norm) && normalized.get(norm) !== name) {
      findings.push(finding({
        rule: id,
        message: `${normalized.get(norm)} and ${name} collide after normalization — they will read as two different events everywhere downstream`,
        evidence: ['(dataLayer)'],
        suggestion: 'Consolidate on one spelling; the split history is unrecoverable later.',
        waiveKey: `${id}:collide:${norm}`,
      }));
    } else {
      normalized.set(norm, name);
    }
  }

  const camel = names.filter((n) => CAMEL.test(n));
  const snake = names.filter((n) => n.includes('_'));
  if (camel.length && snake.length) {
    findings.push(finding({
      rule: id,
      message: `container mixes naming conventions: ${camel[0]} (camelCase) alongside ${snake[0]} (snake_case)`,
      evidence: ['(dataLayer)'],
      suggestion: 'GA4 convention is snake_case. Mixed styles breed duplicate events that differ only in spelling.',
      waiveKey: `${id}:convention-mix`,
    }));
  }

  return findings;
}
