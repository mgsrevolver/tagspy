import { finding } from '../findings.js';

export const id = 'naming-collision';

// page_view and click are deliberately absent: pushing {event:'page_view'}
// for SPA virtual pageviews and click-trigger events is mainstream GTM
// practice, not a defect — flagging them would cry wolf on most containers.
const GA4_AUTO = new Set([
  'session_start', 'first_visit', 'user_engagement', 'scroll',
  'file_download', 'form_start', 'form_submit', 'video_start',
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
    // Underscores AND hyphens: GA4 names don't allow hyphens, so add-to-cart
    // vs add_to_cart is a real collision, not a style choice.
    const norm = name.toLowerCase().replace(/[_-]/g, '');
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

  // A name that is BOTH camel and snake (myEvent_v2) belongs to neither pure
  // convention — counting it in both manufactured a self-collision mix
  // finding on otherwise-uniform containers.
  const camel = names.filter((n) => CAMEL.test(n) && !n.includes('_'));
  const snake = names.filter((n) => n.includes('_') && !CAMEL.test(n));
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
