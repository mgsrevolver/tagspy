import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCapture } from '../src/capture.js';
import { decodeCapture } from '../src/decode.js';

test('decodes GA4 requests and ignores unknown traffic', () => {
  const capture = loadCapture({
    version: 1,
    requests: [
      { url: 'https://a.google-analytics.com/g/collect?tid=G-A&en=page_view', timestamp: 10 },
      { url: 'https://e.clarity.ms/collect', method: 'POST', timestamp: 20 },
      { url: 'https://cdn.test/app.js', timestamp: 30 },
    ],
  });
  const { events, errors } = decodeCapture(capture);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, 'page_view');
  assert.deepEqual(errors, []);
});

test('combines network and dataLayer events with monotonic order', () => {
  const capture = loadCapture({
    version: 1,
    requests: [{ url: 'https://a.google-analytics.com/g/collect?tid=G-A&en=page_view', timestamp: 10 }],
    dataLayer: [{ event: 'optedIn' }],
  });
  const { events } = decodeCapture(capture);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.order), [0, 1]);
});

test('a throwing matches() disables that adapter, not the whole decode', () => {
  const exploding = {
    id: 'exploding-matches',
    matches: () => { throw new Error('bad regex'); },
    decode: () => [],
  };
  const capture = loadCapture({
    version: 1,
    requests: [{ url: 'https://a.google-analytics.com/g/collect?tid=G-A&en=page_view', timestamp: 10 }],
  });
  const ga4 = { id: 'ga4-stub', matches: (u) => u.includes('google-analytics'), decode: () => [{ platform: 'ga4', eventName: 'page_view', params: {}, raw: {} }] };
  const { events, errors } = decodeCapture(capture, { adapters: [exploding, ga4] });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, 'page_view');
  assert.deepEqual(errors, []);
});

test('records a decode error instead of throwing', () => {
  // URL and URLSearchParams are lenient and never throw on malformed query
  // strings, so a decode failure has to be injected rather than provoked.
  const exploding = {
    id: 'exploding',
    matches: () => true,
    decode: () => { throw new Error('bad encoding'); },
  };
  const capture = loadCapture({
    version: 1,
    requests: [{ url: 'https://a.google-analytics.com/g/collect?tid=G-A&en=x', timestamp: 1 }],
  });
  const { events, errors } = decodeCapture(capture, { adapters: [exploding] });
  assert.deepEqual(events, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'bad encoding');
  assert.match(errors[0].url, /g\/collect/);
});
