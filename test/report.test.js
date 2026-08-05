import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/report.js';
import { finding } from '../src/findings.js';
import { tagEvent } from '../src/tag-event.js';

const events = [tagEvent({ platform: 'ga4', account: 'G-A', eventName: 'purchase', timestamp: 0 })];

test('reports a clean run', () => {
  const out = renderReport([], { events });
  assert.match(out, /no advisory findings/i);
});

test('lists each finding with its suggestion', () => {
  const out = renderReport([
    finding({ rule: 'revenue-without-currency', message: 'purchase sends value=89 with no currency', suggestion: 'Send currency.', evidence: ['https://a.test/x'] }),
  ], { events });
  assert.match(out, /revenue-without-currency/);
  assert.match(out, /value=89/);
  assert.match(out, /Send currency\./);
  assert.match(out, /https:\/\/a\.test\/x/);
});

test('labels findings as advisory and states they do not fail', () => {
  const out = renderReport([finding({ rule: 'dead-property', message: 'UA-1 is dead', suggestion: 'Remove it.' })], { events });
  assert.match(out, /advisory/i);
  assert.match(out, /do not fail/i);
});

test('summarizes the decoded events', () => {
  const out = renderReport([], { events });
  assert.match(out, /1 event/);
  assert.match(out, /ga4/);
});
