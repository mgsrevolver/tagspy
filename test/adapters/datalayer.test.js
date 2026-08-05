import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDataLayer } from '../../src/adapters/datalayer.js';

const roll20 = JSON.parse(readFileSync(new URL('../fixtures/datalayer/roll20-homepage.json', import.meta.url)));

test('decodes the real roll20 dataLayer', () => {
  const events = decodeDataLayer(roll20.dataLayer);
  assert.deepEqual(events.map((e) => e.eventName), [
    'gtm.js', 'gtag.js', 'gtag.config', 'gtag.config', 'optedIn', 'start_pw', 'gtm.dom',
  ]);
});

test('extracts accounts from numeric-keyed gtag config calls', () => {
  const events = decodeDataLayer(roll20.dataLayer);
  const accounts = events.filter((e) => e.eventName === 'gtag.config').map((e) => e.account);
  assert.deepEqual(accounts, ['UA-31040388-1', 'G-SZLSVQPSWG']);
});

test('carries the config payload into params', () => {
  const events = decodeDataLayer(roll20.dataLayer);
  const config = events.find((e) => e.account === 'G-SZLSVQPSWG');
  assert.equal(config.params.send_page_view, false);
});

test('strips gtm internal keys from named events', () => {
  const [event] = decodeDataLayer([{ event: 'gtm.js', 'gtm.start': 123, 'gtm.uniqueEventId': 3 }]);
  assert.deepEqual(event.params, {});
});

test('keeps business params on named events', () => {
  const [event] = decodeDataLayer([{ event: 'add_to_cart', value: 12.5, currency: 'USD' }]);
  assert.equal(event.eventName, 'add_to_cart');
  assert.deepEqual(event.params, { value: 12.5, currency: 'USD' });
});

test('decodes gtag event calls', () => {
  const [event] = decodeDataLayer([{ 0: 'event', 1: 'purchase', 2: { value: 89, currency: 'USD' } }]);
  assert.equal(event.eventName, 'purchase');
  assert.equal(event.params.value, 89);
});

test('decodes gtag consent calls', () => {
  const [event] = decodeDataLayer([{ 0: 'consent', 1: 'default', 2: { ad_storage: 'denied' } }]);
  assert.equal(event.eventName, 'gtag.consent.default');
  assert.equal(event.params.ad_storage, 'denied');
});

test('leaves timestamp null and order sequential', () => {
  const events = decodeDataLayer([{ event: 'a' }, { event: 'b' }]);
  assert.equal(events[0].timestamp, null);
  assert.deepEqual(events.map((e) => e.order), [0, 1]);
});

test('ignores entries that are neither shape', () => {
  assert.deepEqual(decodeDataLayer([null, 'string', 42, {}]), []);
});

test('unifies consent vocabulary on gtag consent events', () => {
  const [e] = decodeDataLayer([{ 0: 'consent', 1: 'default', 2: { ad_storage: 'denied', analytics_storage: 'granted', wait_for_update: 500 } }]);
  assert.deepEqual(e.consent, { ads: 'denied', analytics: 'granted' });
  assert.equal(e.params.ad_storage, 'denied'); // raw params preserved
});

test('consent stays null when a consent call carries no storage keys', () => {
  const [e] = decodeDataLayer([{ 0: 'consent', 1: 'default', 2: { wait_for_update: 500 } }]);
  assert.equal(e.consent, null);
});

test("keeps the payload of gtag('set', {...})", () => {
  const [e] = decodeDataLayer([{ 0: 'set', 1: { currency: 'USD', country: 'US' } }]);
  assert.equal(e.eventName, 'gtag.set');
  assert.deepEqual(e.params, { currency: 'USD', country: 'US' });
});

test('decodes sparse arguments objects without truncating', () => {
  const [e] = decodeDataLayer([{ 0: 'config', 2: { send_page_view: false } }]);
  assert.equal(e.eventName, 'gtag.config');
  assert.equal(e.params.send_page_view, false);
});

test('emits datalayer.push for eventless object pushes', () => {
  const events = decodeDataLayer([{ ecommerce: { value: 12, items: [] } }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, 'datalayer.push');
  assert.equal(events[0].params.value, 12); // hoisted
});

test('the canonical ecommerce clear is visible', () => {
  const [e] = decodeDataLayer([{ ecommerce: null }]);
  assert.equal(e.eventName, 'datalayer.push');
  assert.equal(e.params.ecommerce, null);
});

test('hoists nested ecommerce params on named events without clobbering', () => {
  const [e] = decodeDataLayer([{ event: 'purchase', value: 99, ecommerce: { value: 89, currency: 'USD', transaction_id: 'T-1' } }]);
  assert.equal(e.params.value, 99); // explicit top-level wins
  assert.equal(e.params.currency, 'USD');
  assert.equal(e.params.transaction_id, 'T-1');
});

test('a keyed object without an event is a bare push, not noise', () => {
  const [e] = decodeDataLayer([{ notAnEvent: 1 }]);
  assert.equal(e.eventName, 'datalayer.push');
  assert.deepEqual(e.params, { notAnEvent: 1 });
});

test('normalizes CMP-cased consent values', () => {
  const [e] = decodeDataLayer([{ 0: 'consent', 1: 'update', 2: { ad_storage: 'GRANTED', analytics_storage: 'Denied' } }]);
  assert.deepEqual(e.consent, { ads: 'granted', analytics: 'denied' });
});
