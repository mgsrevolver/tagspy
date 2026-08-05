import { tagEvent } from '../tag-event.js';

export const id = 'datalayer';

export function decodeDataLayer(entries, ctx = {}) {
  const events = [];
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const args = asGtagCall(entry);
    if (args) {
      events.push(fromGtagCall(args, index, ctx));
      return;
    }
    if (typeof entry.event === 'string') {
      events.push(fromNamedEvent(entry, index, ctx));
      return;
    }
    if (!('event' in entry)) {
      const params = {};
      // __proto__ assignment would poison the params prototype and let a hostile capture file fabricate findings.
      for (const [key, value] of Object.entries(entry)) {
        if (key.startsWith('gtm.') || key === '__proto__') continue;
        params[key] = value;
      }
      if (Object.keys(params).length) {
        events.push(tagEvent({
          platform: 'datalayer',
          eventName: 'datalayer.push',
          params: hoistEcommerce(params),
          pageUrl: ctx.pageUrl ?? null,
          timestamp: null,
          order: index,
          raw: { source: 'dataLayer' },
        }));
      }
    }
  });
  return events;
}

// gtag() pushes its `arguments` object, which serializes to numeric keys with
// no `length` property — and real captures contain sparse ones. Collect every
// numeric key in position, so {0:'config', 2:{…}} keeps its payload at [2].
function asGtagCall(entry) {
  if (Array.isArray(entry)) return entry.length ? [...entry] : null;
  if (typeof entry[0] !== 'string') return null;
  const positions = Object.keys(entry).filter((k) => /^\d+$/.test(k)).map(Number);
  if (!positions.length) return null;
  const args = [];
  for (const p of positions) args[p] = entry[p];
  return args;
}

function fromGtagCall(args, index, ctx) {
  const [command, target, payload] = args;
  const payload2 = command === 'set' && target && typeof target === 'object' && !Array.isArray(target)
    ? target
    : payload;
  const common = {
    platform: 'datalayer',
    params: plainObject(payload2),
    pageUrl: ctx.pageUrl ?? null,
    timestamp: null,
    order: index,
    raw: { source: 'gtag', command },
  };
  if (command === 'event') {
    return tagEvent({ ...common, eventName: typeof target === 'string' ? target : null });
  }
  if (command === 'config') {
    return tagEvent({
      ...common,
      eventName: 'gtag.config',
      account: typeof target === 'string' ? target : null,
    });
  }
  if (command === 'consent') {
    return tagEvent({
      ...common,
      eventName: `gtag.consent.${target}`,
      consent: consentFromStorageParams(common.params),
    });
  }
  return tagEvent({ ...common, eventName: `gtag.${command}` });
}

function fromNamedEvent(entry, index, ctx) {
  const params = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'event' || key.startsWith('gtm.') || key === '__proto__') continue;
    params[key] = value;
  }
  return tagEvent({
    platform: 'datalayer',
    eventName: entry.event,
    params: hoistEcommerce(params),
    pageUrl: ctx.pageUrl ?? null,
    timestamp: null,
    order: index,
    raw: { source: 'dataLayer' },
  });
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

// Maps gtag consent-mode storage keys onto the unified consent vocabulary
// established by the GA4 adapter ({ads, analytics}); raw params are kept.
function consentFromStorageParams(params) {
  const mapping = { ad_storage: 'ads', analytics_storage: 'analytics' };
  const out = {};
  for (const [key, name] of Object.entries(mapping)) {
    const normalized = typeof params[key] === 'string' ? params[key].toLowerCase() : params[key];
    if (normalized === 'granted' || normalized === 'denied') out[name] = normalized;
  }
  return Object.keys(out).length ? out : null;
}

// GTM's real-world shape nests commerce fields under `ecommerce`. Hoist the
// ones rules care about to the top level; explicit top-level values win, and
// the nested object itself is preserved untouched.
function hoistEcommerce(params) {
  const ec = params.ecommerce;
  if (!ec || typeof ec !== 'object' || Array.isArray(ec)) return params;
  for (const key of ['value', 'currency', 'transaction_id', 'items']) {
    if (params[key] === undefined && ec[key] !== undefined) params[key] = ec[key];
  }
  return params;
}
