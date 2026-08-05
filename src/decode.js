import * as ga4 from './adapters/ga4.js';
import { decodeDataLayer } from './adapters/datalayer.js';

const NETWORK_ADAPTERS = [ga4];

export function decodeCapture(capture, { adapters = NETWORK_ADAPTERS } = {}) {
  const events = [];
  const errors = [];

  for (const req of capture.requests) {
    const adapter = adapters.find((a) => a.matches(req.url));
    if (!adapter) continue; // unrecognized traffic is never fatal
    try {
      events.push(...adapter.decode(req));
    } catch (error) {
      errors.push({ url: req.url, message: error.message });
    }
  }

  events.push(...decodeDataLayer(capture.dataLayer));

  return {
    events: events.map((event, order) => ({ ...event, order })),
    errors,
  };
}
