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
    }
  });
  return events;
}

// gtag() pushes its `arguments` object, which serializes to numeric keys with
// no `length` property. Verified live on roll20.net 2026-08-05.
function asGtagCall(entry) {
  if (Array.isArray(entry)) return entry.length ? [...entry] : null;
  if (typeof entry[0] !== 'string') return null;
  const args = [];
  for (let i = 0; Object.prototype.hasOwnProperty.call(entry, i); i += 1) args.push(entry[i]);
  return args.length ? args : null;
}

function fromGtagCall(args, index, ctx) {
  const [command, target, payload] = args;
  const common = {
    platform: 'datalayer',
    params: plainObject(payload),
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
    if (key === 'event' || key.startsWith('gtm.')) continue;
    params[key] = value;
  }
  return tagEvent({
    platform: 'datalayer',
    eventName: entry.event,
    params,
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
    if (params[key] === 'granted' || params[key] === 'denied') out[name] = params[key];
  }
  return Object.keys(out).length ? out : null;
}
