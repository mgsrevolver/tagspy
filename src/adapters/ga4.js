import { tagEvent } from '../tag-event.js';

export const id = 'ga4';

// Both hosts observed in the wild: region servers use *.google-analytics.com,
// but shop.merch.google (captured 2026-08-05) sends to analytics.google.com.
const GA4_HOST = /(^|\.)google-analytics\.com$|^analytics\.google\.com$/;
const GA4_PATHS = new Set(['/g/collect', '/collect', '/mp/collect']);

const ITEM_FIELDS = {
  id: 'item_id', nm: 'item_name', br: 'item_brand', ca: 'item_category',
  va: 'item_variant', pr: 'price', qt: 'quantity', cp: 'coupon',
  ds: 'discount', af: 'affiliation', ln: 'item_list_name', li: 'item_list_id',
};
const NUMERIC_ITEM_FIELDS = new Set(['price', 'quantity', 'discount']);

export function matches(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return GA4_HOST.test(parsed.hostname) && GA4_PATHS.has(parsed.pathname);
}

export function decode(req) {
  const base = new URL(req.url).searchParams;
  const events = [buildEvent(base, req)];

  if (req.body) {
    for (const line of req.body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const params = new URLSearchParams(trimmed);
      if (!params.has('en')) continue;
      events.push(buildEvent(mergeShared(base, params), req));
    }
  }

  return events.filter((e) => e.eventName !== null);
}

function mergeShared(base, params) {
  const merged = new URLSearchParams(base.toString());
  for (const [key, value] of params) merged.set(key, value);
  return merged;
}

function buildEvent(params, req) {
  const decoded = {};
  for (const [key, value] of params) {
    if (key.startsWith('epn.')) decoded[key.slice(4)] = toNumber(value);
    else if (key.startsWith('ep.')) decoded[key.slice(3)] = value;
    else if (key === 'cu') decoded.currency = value;
  }
  const items = decodeItems(params);
  if (items.length) decoded.items = items;

  return tagEvent({
    platform: 'ga4',
    account: params.get('tid'),
    eventName: params.get('en'),
    params: decoded,
    consent: decodeConsent(params.get('gcs')),
    pageUrl: params.get('dl') ?? req.pageUrl,
    timestamp: req.timestamp,
    raw: { url: req.url, method: req.method },
  });
}

function decodeItems(params) {
  const items = [];
  for (const [key, value] of params) {
    if (!/^pr\d+$/.test(key)) continue;
    const item = {};
    for (const part of value.split('~')) {
      const field = ITEM_FIELDS[part.slice(0, 2)];
      if (!field) continue;
      const raw = part.slice(2);
      item[field] = NUMERIC_ITEM_FIELDS.has(field) ? toNumber(raw) : raw;
    }
    items.push(item);
  }
  return items;
}

function decodeConsent(gcs) {
  if (!gcs || !/^G1[01-][01-]$/.test(gcs)) return null;
  const state = (c) => (c === '1' ? 'granted' : c === '0' ? 'denied' : 'unset');
  return { ads: state(gcs[2]), analytics: state(gcs[3]) };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== '' ? n : value;
}
