import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagEvent } from '../src/tag-event.js';
import { runRules } from '../src/rules/index.js';

const ga4 = (fields) => tagEvent({ platform: 'ga4', account: 'G-A', timestamp: 0, ...fields });
const ids = (findings) => findings.map((f) => f.rule);

test('flags campaign params that never reach a page_view', () => {
  const events = [
    ga4({ eventName: 'user_engagement', pageUrl: 'https://a.test/?utm_source=newsletter&utm_campaign=q3' }),
    ga4({ eventName: 'page_view', pageUrl: 'https://a.test/welcome', timestamp: 500 }),
  ];
  const found = runRules(events).find((f) => f.rule === 'utm-loss');
  assert.ok(found);
  assert.match(found.message, /campaign parameters/);
});

test('silent when the page_view carries the campaign params', () => {
  const events = [
    ga4({ eventName: 'page_view', pageUrl: 'https://a.test/?utm_source=newsletter' }),
    ga4({ eventName: 'page_view', pageUrl: 'https://a.test/next', timestamp: 500 }),
  ];
  assert.ok(!ids(runRules(events)).includes('utm-loss'));
});

test('silent when no campaign params exist anywhere', () => {
  const events = [ga4({ eventName: 'page_view', pageUrl: 'https://a.test/' })];
  assert.ok(!ids(runRules(events)).includes('utm-loss'));
});
