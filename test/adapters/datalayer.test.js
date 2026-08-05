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
  assert.deepEqual(decodeDataLayer([null, 'string', 42, {}, { notAnEvent: 1 }]), []);
});
