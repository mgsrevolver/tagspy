import { finding } from '../findings.js';

export const id = 'push-before-init';

const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;

export function run(events) {
  const container = events.filter((e) => e.platform === 'datalayer');
  const init = container.find((e) => e.eventName === 'gtm.js');
  if (!init) return [];
  return container
    .filter((e) => typeof e.eventName === 'string' && !INTERNAL.test(e.eventName) && e.order < init.order)
    .map((e) => finding({
      rule: id,
      message: `${e.eventName} was pushed before the GTM container initialized`,
      evidence: ['(dataLayer)'],
      suggestion: 'Tags with page-load triggers can miss pre-init pushes. Move the push after the container snippet, or trigger on the event itself.',
      waiveKey: `${id}:${e.eventName}`,
    }));
}
