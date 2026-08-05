import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubUrl } from '../src/scrub.js';

test('redacts client and session identifiers', () => {
  const out = scrubUrl('https://a.test/g/collect?tid=G-ABC&cid=12345.678&sid=999&en=page_view');
  assert.match(out, /cid=REDACTED/);
  assert.match(out, /sid=REDACTED/);
});

test('preserves measurement id and event name', () => {
  const out = scrubUrl('https://a.test/g/collect?tid=G-ABC&cid=1&en=purchase');
  assert.match(out, /tid=G-ABC/);
  assert.match(out, /en=purchase/);
});

test('redacts click and pixel identifiers', () => {
  const out = scrubUrl('https://a.test/tr?id=1&fbp=fb.1.99&gclid=xyz&ev=Purchase');
  assert.match(out, /fbp=REDACTED/);
  assert.match(out, /gclid=REDACTED/);
  assert.match(out, /ev=Purchase/);
});

test('redacts identifiers observed in live Google Ads traffic', () => {
  const out = scrubUrl('https://a.test/ccm/collect?auid=195.178&ecid=1225&_gid=165.178&en=page_view');
  assert.match(out, /auid=REDACTED/);
  assert.match(out, /ecid=REDACTED/);
  assert.match(out, /_gid=REDACTED/);
  assert.match(out, /en=page_view/);
});

test('returns unparseable input unchanged', () => {
  assert.equal(scrubUrl('not a url'), 'not a url');
});
