import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../bin/tagspy.js', import.meta.url).pathname;
const fixture = (rel) => new URL(`./fixtures/${rel}`, import.meta.url).pathname;

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

test('audits the captured roll20 dataLayer fixture end to end', () => {
  const res = run('audit', fixture('datalayer/roll20-homepage.json'));
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Decoded 7 events across: datalayer/);
  assert.match(res.stdout, /\[dead-property\] UA-31040388-1/);
  assert.equal(res.stderr, '');
});

test('audits the captured GA4 storefront fixture end to end', () => {
  const res = run('audit', fixture('ga4/storefront-pageview.json'));
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Decoded 4 events across: ga4/);
  assert.match(res.stdout, /No advisory findings/);
  assert.equal(res.stderr, '');
});

test('exits 2 with usage when arguments are missing', () => {
  const res = run();
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: tagspy audit/);
  assert.equal(res.stdout, '');
});

test('exits 2 on an unreadable capture', () => {
  const res = run('audit', '/nonexistent-tagspy-capture.json');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /could not read capture/);
});

test('a report larger than one pipe buffer is not truncated', () => {
  // Regression for the exit(0) stdout-truncation blocker: 1500 purchase
  // events, each missing currency, produce a multi-hundred-KB report.
  const dir = mkdtempSync(join(tmpdir(), 'tagspy-'));
  const path = join(dir, 'big.json');
  const requests = Array.from({ length: 1500 }, (_, i) => ({
    url: `https://analytics.google.com/g/collect?v=2&tid=G-BIG&en=purchase&ep.transaction_id=T-${i}&epn.value=${i + 1}`,
    timestamp: i * 10000,
  }));
  writeFileSync(path, JSON.stringify({ version: 1, requests, dataLayer: [] }));
  const res = run('audit', path);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Decoded 1500 events across: ga4/);
  assert.ok(res.stdout.length > 100000, `expected >100KB of report, got ${res.stdout.length} bytes`);
});
