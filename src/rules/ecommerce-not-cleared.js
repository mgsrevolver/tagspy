import { finding } from '../findings.js';

export const id = 'ecommerce-not-cleared';

export function run(events) {
  const findings = [];
  let carrying = null;
  for (const event of events) {
    if (event.platform !== 'datalayer') continue;
    const ec = event.params.ecommerce;
    if ('ecommerce' in event.params && ec === null) {
      carrying = null; // the canonical clear
      continue;
    }
    if (ec && typeof ec === 'object') {
      if (carrying) {
        findings.push(finding({
          rule: id,
          message: `${event.eventName} pushed ecommerce data without clearing after ${carrying.eventName} — stale items can leak between events`,
          evidence: ['(dataLayer)'],
          suggestion: "Push dataLayer.push({ecommerce: null}) before each ecommerce event, per Google's own guidance.",
          waiveKey: `${id}:${event.eventName}`,
        }));
      }
      carrying = event;
    }
  }
  return findings;
}
