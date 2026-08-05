import { finding } from '../findings.js';

export const id = 'consent-suppression';

export function run(events) {
  const declared = events.some(
    (e) => e.platform === 'datalayer' && typeof e.eventName === 'string' && e.eventName.startsWith('gtag.consent.'),
  );
  if (!declared) return [];
  const wire = events.filter((e) => e.platform !== 'datalayer');
  if (!wire.length || !wire.every((e) => e.consent === null)) return [];
  return [finding({
    rule: id,
    message: 'consent mode is declared in the container, but no network hit carries any consent state',
    evidence: wire.slice(0, 3).map((e) => e.raw.url ?? '(dataLayer)'),
    suggestion: 'The consent signal is not reaching the tags — verify the consent-mode integration fires before the tags do.',
    waiveKey: id,
  })];
}
