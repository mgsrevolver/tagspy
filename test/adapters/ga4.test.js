import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ga4 from '../../src/adapters/ga4.js';

const req = (url, extra = {}) => ({ url, method: 'POST', body: null, timestamp: 100, pageUrl: null, ...extra });

test('matches GA4 collect endpoints only', () => {
  assert.equal(ga4.matches('https://region1.google-analytics.com/g/collect?v=2'), true);
  assert.equal(ga4.matches('https://www.google-analytics.com/collect?v=1'), true);
  // Observed live on shop.merch.google 2026-08-05 — not a region host.
  assert.equal(ga4.matches('https://analytics.google.com/g/collect?v=2'), true);
  assert.equal(ga4.matches('https://www.facebook.com/tr/?id=1'), false);
  // GA4-shaped transport pings on doubleclick hosts are cookie-matching, not events.
  assert.equal(ga4.matches('https://stats.g.doubleclick.net/g/collect?v=2'), false);
  assert.equal(ga4.matches('not a url'), false);
});

test('decodes event name, account, and string params', () => {
  const [e] = ga4.decode(req('https://a.google-analytics.com/g/collect?v=2&tid=G-ABC&en=purchase&ep.transaction_id=T-1'));
  assert.equal(e.platform, 'ga4');
  assert.equal(e.account, 'G-ABC');
  assert.equal(e.eventName, 'purchase');
  assert.equal(e.params.transaction_id, 'T-1');
  assert.equal(e.timestamp, 100);
});

test('decodes numeric params and currency', () => {
  const [e] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-ABC&en=purchase&epn.value=89.00&cu=USD'));
  assert.equal(e.params.value, 89);
  assert.equal(e.params.currency, 'USD');
});

test('decodes prefix-encoded items', () => {
  const url = 'https://a.google-analytics.com/g/collect?tid=G-ABC&en=purchase&pr1=idSKU1~nmShirt~pr9.99~qt2&pr2=idSKU2~nmMug';
  const [e] = ga4.decode(req(url));
  assert.deepEqual(e.params.items, [
    { item_id: 'SKU1', item_name: 'Shirt', price: 9.99, quantity: 2 },
    { item_id: 'SKU2', item_name: 'Mug' },
  ]);
});

test('decodes consent state from gcs', () => {
  const [granted] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&gcs=G111'));
  assert.deepEqual(granted.consent, { ads: 'granted', analytics: 'granted' });
  const [denied] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&gcs=G100'));
  assert.deepEqual(denied.consent, { ads: 'denied', analytics: 'denied' });
  const [absent] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x'));
  assert.equal(absent.consent, null);
});

test('decodes batched events from the POST body, inheriting shared params', () => {
  const events = ga4.decode(req(
    'https://a.google-analytics.com/g/collect?v=2&tid=G-ABC&en=page_view',
    { body: 'en=view_item&epn.value=5\nen=add_to_cart&epn.value=5' },
  ));
  assert.deepEqual(events.map((e) => e.eventName), ['page_view', 'view_item', 'add_to_cart']);
  assert.equal(events[2].account, 'G-ABC');
});

test('prefers the dl param for pageUrl', () => {
  const [e] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&dl=https%3A%2F%2Fshop.test%2Fcart'));
  assert.equal(e.pageUrl, 'https://shop.test/cart');
});

test('skips hits with no event name', () => {
  assert.deepEqual(ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&v=2')), []);
});

test('decodes unset consent from gcs dashes', () => {
  const [e] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&gcs=G1--'));
  assert.deepEqual(e.consent, { ads: 'unset', analytics: 'unset' });
  const [mixed] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&gcs=G1-1'));
  assert.deepEqual(mixed.consent, { ads: 'unset', analytics: 'granted' });
});
