import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagEvent } from '../src/tag-event.js';
import { runRules } from '../src/rules/index.js';
import { loadCapture } from '../src/capture.js';
import { decodeCapture } from '../src/decode.js';

const storefront = JSON.parse(readFileSync(new URL('./fixtures/ga4/storefront-pageview.json', import.meta.url)));
const storefrontEvents = decodeCapture(loadCapture(storefront)).events;

const ga4Event = (fields) => tagEvent({ platform: 'ga4', account: 'G-A', timestamp: 0, ...fields });
const ids = (findings) => findings.map((f) => f.rule);

test('flags a 40-char event name as likely truncated — real capture', () => {
  const found = runRules(storefrontEvents).find((f) => f.rule === 'event-name-length');
  assert.ok(found);
  assert.match(found.message, /custom_event_with_a_name_over_40_charact/);
});

test('flags an over-limit dataLayer event name as will-be-truncated', () => {
  const long = 'a'.repeat(45);
  const events = [tagEvent({ platform: 'datalayer', eventName: long, timestamp: null, order: 0 })];
  const found = runRules(events).find((f) => f.rule === 'event-name-length');
  assert.ok(found);
  assert.match(found.message, /45 characters/);
});

test('does not flag normal names or gtm internals', () => {
  const events = [
    ga4Event({ eventName: 'purchase' }),
    tagEvent({ platform: 'datalayer', eventName: 'gtm.js', timestamp: null, order: 0 }),
  ];
  assert.ok(!ids(runRules(events)).includes('event-name-length'));
});

test('flags debug_mode reaching production hits — real capture, once per account', () => {
  const found = runRules(storefrontEvents).filter((f) => f.rule === 'debug-mode-in-prod');
  assert.equal(found.length, 2); // G-XR6MYBBELZ and G-MH4QR9F4ZK carry ep.debug_mode=True
});

test('debug-mode is a wire rule', () => {
  const events = [tagEvent({ platform: 'datalayer', eventName: 'x', params: { debug_mode: true }, timestamp: null, order: 0 })];
  assert.ok(!ids(runRules(events)).includes('debug-mode-in-prod'));
});

test('flags placeholder param values once per event+param', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined', currency: 'USD', value: 5 } }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined', currency: 'USD', value: 5 }, timestamp: 99999 }),
  ];
  const found = runRules(events).filter((f) => f.rule === 'placeholder-param');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /transaction_id/);
});

test('flags a zero-value purchase separately', () => {
  const events = [ga4Event({ eventName: 'purchase', params: { value: 0, currency: 'USD', transaction_id: 'T-1' } })];
  const found = runRules(events).find((f) => f.rule === 'placeholder-param');
  assert.ok(found);
  assert.match(found.message, /value=0/);
});

test('flags consent mode declared in the container but absent from every hit', () => {
  const events = [
    tagEvent({ platform: 'datalayer', eventName: 'gtag.consent.default', params: { ad_storage: 'denied' }, consent: { ads: 'denied' }, timestamp: null, order: 0 }),
    ga4Event({ eventName: 'page_view', consent: null }),
  ];
  const found = runRules(events).find((f) => f.rule === 'consent-suppression');
  assert.ok(found);
  assert.match(found.message, /consent/i);
});

test('debug-mode ignores explicit falsy encodings', () => {
  const events = [
    ga4Event({ eventName: 'x', params: { debug_mode: 0 } }),
    ga4Event({ eventName: 'x', params: { debug_mode: '' }, account: 'G-B' }),
    ga4Event({ eventName: 'x', params: { debug_mode: 'False' }, account: 'G-C' }),
  ];
  assert.ok(!ids(runRules(events)).includes('debug-mode-in-prod'));
});

test('placeholder findings are account-scoped', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined' } }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined' }, account: 'G-B', timestamp: 50000 }),
  ];
  assert.equal(runRules(events).filter((f) => f.rule === 'placeholder-param').length, 2);
});

test('wire truncation and its container source collapse to one finding', () => {
  const full = 'custom_event_with_a_name_over_40_characters';
  const events = [
    tagEvent({ platform: 'datalayer', eventName: full, timestamp: null, order: 0 }),
    ga4Event({ eventName: full.slice(0, 40) }),
  ];
  assert.equal(runRules(events).filter((f) => f.rule === 'event-name-length').length, 1);
});

test('stays silent when hits do carry consent state', () => {
  const events = [
    tagEvent({ platform: 'datalayer', eventName: 'gtag.consent.default', params: {}, timestamp: null, order: 0 }),
    ga4Event({ eventName: 'page_view', consent: { ads: 'denied', analytics: 'denied' } }),
  ];
  assert.ok(!ids(runRules(events)).includes('consent-suppression'));
});
