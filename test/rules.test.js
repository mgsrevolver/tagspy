import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagEvent } from '../src/tag-event.js';
import { runRules } from '../src/rules/index.js';
import { decodeDataLayer } from '../src/adapters/datalayer.js';

const roll20 = JSON.parse(readFileSync(new URL('./fixtures/datalayer/roll20-homepage.json', import.meta.url)));

const ga4Event = (fields) => tagEvent({ platform: 'ga4', account: 'G-A', timestamp: 0, ...fields });
const ids = (findings) => findings.map((f) => f.rule);

test('flags a duplicate purchase inside the window', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1', value: 89, currency: 'USD' }, timestamp: 1000 }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1', value: 89, currency: 'USD' }, timestamp: 1340 }),
  ];
  assert.ok(ids(runRules(events)).includes('duplicate-event'));
});

test('does not flag the same event outside the window', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: 1000 }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: 9000 }),
  ];
  assert.ok(!ids(runRules(events)).includes('duplicate-event'));
});

test('does not flag distinct transactions', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: 1000 }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-2' }, timestamp: 1100 }),
  ];
  assert.ok(!ids(runRules(events)).includes('duplicate-event'));
});

test('never windows events with a null timestamp', () => {
  const events = [
    tagEvent({ platform: 'datalayer', eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: null, order: 0 }),
    tagEvent({ platform: 'datalayer', eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: null, order: 1 }),
  ];
  assert.ok(!ids(runRules(events)).includes('duplicate-event'));
});

test('flags revenue with no currency', () => {
  const events = [ga4Event({ eventName: 'purchase', params: { value: 89 } })];
  const found = runRules(events).find((f) => f.rule === 'revenue-without-currency');
  assert.ok(found);
  assert.match(found.message, /currency/);
});

test('accepts revenue with currency', () => {
  const events = [ga4Event({ eventName: 'purchase', params: { value: 89, currency: 'USD' } })];
  assert.ok(!ids(runRules(events)).includes('revenue-without-currency'));
});

test('flags a dead Universal Analytics property on the real roll20 capture', () => {
  const found = runRules(decodeDataLayer(roll20.dataLayer)).find((f) => f.rule === 'dead-property');
  assert.ok(found);
  assert.match(found.message, /UA-31040388-1/);
});

test('does not flag the GA4 property as dead', () => {
  const findings = runRules(decodeDataLayer(roll20.dataLayer)).filter((f) => f.rule === 'dead-property');
  assert.equal(findings.length, 1);
});

test('surfaces decode errors as findings', () => {
  const findings = runRules([], { errors: [{ url: 'https://a.test/g/collect?%', message: 'bad escape' }] });
  assert.ok(ids(findings).includes('malformed-hit'));
});

test('every finding carries a waive key and a suggestion', () => {
  const events = [ga4Event({ eventName: 'purchase', params: { value: 89 } })];
  for (const f of runRules(events)) {
    assert.equal(typeof f.waiveKey, 'string');
    assert.ok(f.waiveKey.length > 0);
    assert.equal(typeof f.suggestion, 'string');
  }
});

test('does not flag the same event on different pages', () => {
  const events = [
    ga4Event({ eventName: 'page_view', params: {}, timestamp: 1000, pageUrl: 'https://a.test/one' }),
    ga4Event({ eventName: 'page_view', params: {}, timestamp: 1300, pageUrl: 'https://a.test/two' }),
  ];
  assert.ok(!ids(runRules(events)).includes('duplicate-event'));
});

test('collapses a burst into a single counted finding', () => {
  const events = [0, 400, 800, 1200].map((t) =>
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: t }));
  const found = runRules(events).filter((f) => f.rule === 'duplicate-event');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /fired 4 times/);
});

test('unsorted input cannot manufacture duplicates', () => {
  // t=9000 arriving before t=0 must not group: a negative delta is not "within the window".
  const events = [9000, 0].map((t) =>
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: t }));
  assert.ok(!ids(runRules(events)).includes('duplicate-event'));
});

test('unsorted input still finds true duplicates, with a non-negative span', () => {
  const events = [1300, 1000].map((t) =>
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'T-1' }, timestamp: t }));
  const found = runRules(events).filter((f) => f.rule === 'duplicate-event');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /within 300ms/);
});

test('revenue-without-currency is a wire rule and skips the dataLayer shadow', () => {
  const events = [
    tagEvent({ platform: 'datalayer', eventName: 'purchase', params: { value: 89 }, timestamp: null, order: 0 }),
  ];
  assert.ok(!ids(runRules(events)).includes('revenue-without-currency'));
});
