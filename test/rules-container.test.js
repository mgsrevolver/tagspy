import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagEvent } from '../src/tag-event.js';
import { runRules } from '../src/rules/index.js';
import { decodeDataLayer } from '../src/adapters/datalayer.js';

const roll20 = JSON.parse(readFileSync(new URL('./fixtures/datalayer/roll20-homepage.json', import.meta.url)));

const dl = (eventName, params = {}, order = 0) =>
  tagEvent({ platform: 'datalayer', eventName, params, timestamp: null, order });
const ids = (findings) => findings.map((f) => f.rule);

test('flags mixed naming conventions on the real roll20 container', () => {
  const found = runRules(decodeDataLayer(roll20.dataLayer)).find((f) => f.rule === 'naming-collision');
  assert.ok(found);
  assert.match(found.message, /optedIn/);
  assert.match(found.message, /start_pw/);
});

test('flags two names that collide after normalization', () => {
  const events = [dl('optedIn'), dl('opted_in', {}, 1)];
  const found = runRules(events).filter((f) => f.rule === 'naming-collision');
  assert.ok(found.some((f) => /collide/.test(f.message)));
});

test('flags a custom event shadowing a GA4 automatic name', () => {
  const events = [dl('session_start')];
  const found = runRules(events).find((f) => f.rule === 'naming-collision');
  assert.ok(found);
  assert.match(found.message, /automatically-collected/);
});

test('one clean convention produces no naming findings', () => {
  const events = [dl('add_to_cart'), dl('begin_checkout', {}, 1)];
  assert.ok(!ids(runRules(events)).includes('naming-collision'));
});

test('flags a business event pushed before container init', () => {
  const events = [dl('early_signup', {}, 0), dl('gtm.js', {}, 1)];
  const found = runRules(events).find((f) => f.rule === 'push-before-init');
  assert.ok(found);
  assert.match(found.message, /early_signup/);
});

test('roll20 pushes nothing before init', () => {
  assert.ok(!ids(runRules(decodeDataLayer(roll20.dataLayer))).includes('push-before-init'));
});

test('flags consecutive ecommerce pushes with no clear between them', () => {
  const events = [
    dl('view_item', { ecommerce: { items: [{ item_id: 'A' }] }, items: [{ item_id: 'A' }] }, 0),
    dl('add_to_cart', { ecommerce: { items: [{ item_id: 'A' }] }, items: [{ item_id: 'A' }] }, 1),
  ];
  const found = runRules(events).find((f) => f.rule === 'ecommerce-not-cleared');
  assert.ok(found);
  assert.match(found.message, /add_to_cart/);
});

test('a clear between ecommerce pushes silences the rule', () => {
  const events = [
    dl('view_item', { ecommerce: { items: [] } }, 0),
    dl('datalayer.push', { ecommerce: null }, 1),
    dl('add_to_cart', { ecommerce: { items: [] } }, 2),
  ];
  assert.ok(!ids(runRules(events)).includes('ecommerce-not-cleared'));
});
