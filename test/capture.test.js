import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCapture, CaptureError } from '../src/capture.js';

test('accepts a minimal version 1 envelope', () => {
  const out = loadCapture({ version: 1 });
  assert.deepEqual(out.requests, []);
  assert.deepEqual(out.dataLayer, []);
});

test('rejects an unsupported version', () => {
  assert.throws(() => loadCapture({ version: 2 }), CaptureError);
});

test('rejects a non-object capture', () => {
  assert.throws(() => loadCapture([]), CaptureError);
  assert.throws(() => loadCapture(null), CaptureError);
});

test('rejects non-array requests', () => {
  assert.throws(() => loadCapture({ version: 1, requests: {} }), CaptureError);
});

test('drops requests with no url and defaults method to GET', () => {
  const out = loadCapture({
    version: 1,
    requests: [{ url: 'https://a.test/?x=1' }, { method: 'POST' }],
  });
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].method, 'GET');
});

test('falls back to array index when timestamp is missing', () => {
  const out = loadCapture({
    version: 1,
    requests: [{ url: 'https://a.test/' }, { url: 'https://b.test/', timestamp: 500 }],
  });
  assert.equal(out.requests[0].timestamp, 0);
  assert.equal(out.requests[1].timestamp, 500);
});
