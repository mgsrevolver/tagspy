# tagspy Core Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an end-to-end auditor that reads a JSON capture of browser traffic, decodes GA4 hits and GTM dataLayer entries into one normalized event model, and reports advisory findings.

**Architecture:** Pure functions over recorded data. Capture is borrowed from the user's browser MCP and lands in a JSON envelope on disk; everything in this repo reads that envelope and never touches a browser. Adapters normalize per-platform wire formats into a single `TagEvent`; rules are written once against `TagEvent` and apply across every platform.

**Tech Stack:** Node.js ≥22, ESM, zero runtime dependencies, `node:test` + `node:assert/strict` for tests.

## Global Constraints

- **Zero runtime dependencies.** Test-only dev dependencies are also disallowed; use `node:test`.
- **ESM only.** `"type": "module"` in `package.json`; no CommonJS.
- **Everything in `src/` is a pure function.** No file I/O, no network, no `Date.now()`, no globals. I/O lives only in `bin/tagspy.js`.
- **Advisory findings never affect the exit code.** In this plan the exit code is always 0 on successful analysis, 2 on usage error. Assertions arrive in a later plan.
- **Unrecognized traffic is ignored, never fatal.** A malformed hit produces a finding; it never throws.
- **Fixture hygiene:** scrub `cid`, `sid`, and any user or session identifier before committing a fixture. Measurement IDs are public and may stay.
- **File naming:** kebab-case.

### Verified browser constraints (do not re-derive)

Confirmed empirically 2026-08-05; these shape Task 2 only:

1. `read_network_requests` preserves query strings verbatim.
2. `javascript_tool` returns `[BLOCKED: Cookie/query string data]` if a snippet touches cookies or query strings. Read `window.dataLayer` objects only.
3. `gtag()` calls appear in `dataLayer` as numeric-keyed objects (`{"0":"config","1":"G-…","2":{…}}`) with **no** `length` key — never assume array shape or `length`.
4. Network capture starts when `read_network_requests` is first called; arm it before navigating, or reload after arming.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `package.json` | ESM, bin entry, `npm test` |
| `bin/tagspy.js` | the only impure file: argv, file read, stdout, exit code |
| `src/capture.js` | validate and normalize the capture envelope |
| `src/scrub.js` | redact identifiers from fixture URLs |
| `src/tag-event.js` | `TagEvent` factory + `stableStringify` |
| `src/adapters/ga4.js` | GA4 `/g/collect` decoder |
| `src/adapters/datalayer.js` | dataLayer decoder, both entry shapes |
| `src/decode.js` | adapter registry; capture → `{events, errors}` |
| `src/findings.js` | `Finding` factory |
| `src/rules/index.js` | rule registry + runner |
| `src/rules/duplicate-event.js` | windowed duplicate detection |
| `src/rules/revenue-without-currency.js` | `value` present, `currency` absent |
| `src/rules/dead-property.js` | `UA-*` property still configured |
| `src/rules/malformed-hit.js` | surfaces decode errors as findings |
| `src/report.js` | render findings to text |
| `test/fixtures/ga4/*.json` | captured + synthesized GA4 hits |
| `test/fixtures/datalayer/*.json` | captured dataLayer snapshots |

### The `TagEvent` contract

Every adapter produces this shape. Every rule consumes only this shape.

```js
{
  platform: 'ga4',            // string
  account: 'G-ABC123',        // string | null  (measurement/pixel id)
  eventName: 'purchase',      // string | null
  params: { value: 89, currency: 'USD' },  // plain object, normalized names
  consent: { ads: 'granted', analytics: 'denied' },  // object | null
  pageUrl: 'https://x/confirm',  // string | null
  timestamp: 1234,            // number (ms) | null  -- null when unknowable
  order: 7,                   // number, monotonic within the capture
  raw: { url, method }        // provenance, for evidence strings
}
```

**`timestamp` vs `order`:** network hits carry real milliseconds. dataLayer entries carry only array position, so their `timestamp` is `null` and only `order` is meaningful. Windowed rules **must** skip events with `timestamp === null` rather than treat position as milliseconds.

---

### Task 1: Scaffold and capture envelope

**Files:**
- Create: `package.json`, `.gitignore` (already present), `src/capture.js`
- Test: `test/capture.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `loadCapture(raw) → {version, capturedAt, requests, dataLayer}` where each request is `{url, method, body, timestamp, pageUrl}`; `CaptureError` class. `timestamp` is a number when the capture recorded one and `null` otherwise — never a synthesized array index, per the `timestamp` vs `order` rule in the TagEvent contract above.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "tagspy",
  "version": "0.1.0",
  "description": "Audit marketing tag implementations from captured browser traffic",
  "license": "MIT",
  "type": "module",
  "bin": { "tagspy": "./bin/tagspy.js" },
  "scripts": { "test": "node --test" },
  "engines": { "node": ">=22" }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/capture.test.js`:

```js
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

test('leaves timestamp null when the capture recorded none', () => {
  const out = loadCapture({
    version: 1,
    requests: [{ url: 'https://a.test/' }, { url: 'https://b.test/', timestamp: 500 }],
  });
  assert.equal(out.requests[0].timestamp, null);
  assert.equal(out.requests[1].timestamp, 500);
});

test('preserves a zero timestamp', () => {
  const out = loadCapture({ version: 1, requests: [{ url: 'https://a.test/', timestamp: 0 }] });
  assert.equal(out.requests[0].timestamp, 0);
});

test('rejects an empty url', () => {
  const out = loadCapture({ version: 1, requests: [{ url: '' }, { url: 'https://a.test/' }] });
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].url, 'https://a.test/');
});

test('rejects a non-array dataLayer', () => {
  assert.throws(() => loadCapture({ version: 1, dataLayer: 'nope' }), CaptureError);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/capture.js`

- [ ] **Step 4: Write the implementation**

Create `src/capture.js`:

```js
export class CaptureError extends Error {}

export function loadCapture(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CaptureError('capture must be a JSON object');
  }
  if (raw.version !== 1) {
    throw new CaptureError(`unsupported capture version: ${JSON.stringify(raw.version)}`);
  }
  const requests = raw.requests ?? [];
  const dataLayer = raw.dataLayer ?? [];
  if (!Array.isArray(requests)) throw new CaptureError('requests must be an array');
  if (!Array.isArray(dataLayer)) throw new CaptureError('dataLayer must be an array');

  return {
    version: 1,
    capturedAt: raw.capturedAt ?? null,
    requests: requests
      .filter((r) => r && typeof r.url === 'string' && r.url !== '')
      .map((r) => ({
        url: r.url,
        method: typeof r.method === 'string' ? r.method : 'GET',
        body: typeof r.body === 'string' ? r.body : null,
        // null, never an index: a position is not a millisecond. Windowed
        // rules must skip events whose timestamp is unknowable rather than
        // compare array offsets as if they were elapsed time.
        timestamp: Number.isFinite(r.timestamp) ? r.timestamp : null,
        pageUrl: typeof r.pageUrl === 'string' ? r.pageUrl : null,
      })),
    dataLayer,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add package.json src/capture.js test/capture.test.js
git commit -m "feat: capture envelope loader and validator"
```

---

### Task 2: Fixture acquisition and scrubbing

**Files:**
- Create: `src/scrub.js`, `test/scrub.test.js`
- Create: `test/fixtures/ga4/storefront-pageview.json`, `test/fixtures/datalayer/roll20-homepage.json`
- Test: `test/scrub.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `scrubUrl(url) → string`; fixture files consumed by Tasks 3 and 4

- [ ] **Step 1: Write the failing test**

Create `test/scrub.test.js`:

```js
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

test('redacts per-hit cache busters and join ids from legacy protocols', () => {
  const out = scrubUrl('https://a.test/j/collect?tid=UA-1&a=1382392921&z=1422968210&rnd=1786573501&random=1785955667706&t=pageview');
  assert.match(out, /(^|&)a=REDACTED/);
  assert.match(out, /z=REDACTED/);
  assert.match(out, /rnd=REDACTED/);
  assert.match(out, /random=REDACTED/);
  assert.match(out, /tid=UA-1/);
  assert.match(out, /t=pageview/);
});

test('returns unparseable input unchanged', () => {
  assert.equal(scrubUrl('not a url'), 'not a url');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/scrub.js`

- [ ] **Step 3: Write the implementation**

Create `src/scrub.js`:

```js
const SENSITIVE_PARAMS = new Set([
  'cid', 'sid', 'uid', '_p', '_fid',
  'gclid', 'dclid', 'wbraid', 'gbraid',
  'fbp', 'fbc', 'external_id', 'em', 'ph',
  // observed in live Google Ads / GA4 traffic on shop.merch.google 2026-08-05
  'auid', 'ecid', '_gid', 'jid', 'gjid',
  // per-hit cache-busters / join ids in the UA and Ads wire protocols. The
  // names are generic, but scrubUrl only ever runs on fixture prep, where
  // over-redaction is safe and under-redaction leaks.
  'z', 'a', 'rnd', 'random',
]);

export function scrubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_PARAMS.has(key)) parsed.searchParams.set(key, 'REDACTED');
  }
  return parsed.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Validate the already-captured GA4 fixture**

`test/fixtures/ga4/storefront-pageview.json` already exists in the working tree — captured live from `shop.merch.google` on 2026-08-05 via Chrome DevTools MCP and scrubbed by hand. Do not modify its contents. Validate it programmatically:

```bash
node --input-type=module -e "
import { loadCapture } from './src/capture.js';
import { readFileSync } from 'node:fs';
const capture = loadCapture(JSON.parse(readFileSync('test/fixtures/ga4/storefront-pageview.json', 'utf8')));
console.log('requests:', capture.requests.length, 'dataLayer:', capture.dataLayer.length);
if (capture.requests.length !== 7) throw new Error('expected 7 requests');
"
```

Expected output: `requests: 7 dataLayer: 0`. Also confirm no unscrubbed identifiers remain: `grep -cE '(cid|sid|auid|ecid|_gid|jid|gjid)=(?!REDACTED)' test/fixtures/ga4/storefront-pageview.json || true` should print `0` (use `grep -PcE` if plain grep rejects the lookahead, or eyeball the seven `url` fields — every listed param must read `=REDACTED`).

- [ ] **Step 6: Record the roll20 dataLayer fixture**

These entries were captured live on 2026-08-05 and are the authority for Task 4's dual-shape handling. Create `test/fixtures/datalayer/roll20-homepage.json` verbatim:

```json
{
  "version": 1,
  "capturedAt": "2026-08-05T17:01:18.823Z",
  "_source": "captured from roll20.net homepage",
  "requests": [],
  "dataLayer": [
    { "gtm.start": 1785949278432, "event": "gtm.js", "gtm.uniqueEventId": 3 },
    { "0": "js", "1": "2026-08-05T17:01:18.823Z" },
    { "0": "config", "1": "UA-31040388-1", "2": { "cookieDomain": "auto", "send_page_view": false } },
    { "0": "config", "1": "G-SZLSVQPSWG", "2": { "cookieDomain": "auto", "send_page_view": false } },
    { "event": "optedIn", "gtm.uniqueEventId": 7 },
    { "event": "start_pw", "gtm.uniqueEventId": 8 },
    { "event": "gtm.dom", "gtm.uniqueEventId": 9 }
  ]
}
```

- [ ] **Step 7: Commit**

```bash
git add src/scrub.js test/scrub.test.js test/fixtures/
git commit -m "feat: fixture scrubbing and seed fixtures"
```

---

### Task 3: GA4 adapter

**Files:**
- Create: `src/tag-event.js`, `src/adapters/ga4.js`
- Test: `test/adapters/ga4.test.js`

**Interfaces:**
- Consumes: request objects from `loadCapture` (Task 1)
- Produces: `tagEvent(fields) → TagEvent`, `stableStringify(value) → string` from `src/tag-event.js`; `{ id: 'ga4', matches(url) → boolean, decode(req) → TagEvent[] }` from `src/adapters/ga4.js`

- [ ] **Step 1: Write the failing test**

Create `test/adapters/ga4.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../../src/adapters/ga4.js`

- [ ] **Step 3: Write the TagEvent helper**

Create `src/tag-event.js`:

```js
export function tagEvent(fields) {
  return {
    platform: fields.platform,
    account: fields.account ?? null,
    eventName: fields.eventName ?? null,
    params: fields.params ?? {},
    consent: fields.consent ?? null,
    pageUrl: fields.pageUrl ?? null,
    timestamp: fields.timestamp ?? null,
    order: fields.order ?? 0,
    raw: fields.raw ?? {},
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
```

- [ ] **Step 4: Write the GA4 adapter**

Create `src/adapters/ga4.js`:

```js
import { tagEvent } from '../tag-event.js';

export const id = 'ga4';

// Both hosts observed in the wild: region servers use *.google-analytics.com,
// but shop.merch.google (captured 2026-08-05) sends to analytics.google.com.
const GA4_HOST = /(^|\.)google-analytics\.com$|^analytics\.google\.com$/;
const GA4_PATHS = new Set(['/g/collect', '/collect', '/mp/collect']);

const ITEM_FIELDS = {
  id: 'item_id', nm: 'item_name', br: 'item_brand', ca: 'item_category',
  va: 'item_variant', pr: 'price', qt: 'quantity', cp: 'coupon',
  ds: 'discount', af: 'affiliation', ln: 'item_list_name', li: 'item_list_id',
};
const NUMERIC_ITEM_FIELDS = new Set(['price', 'quantity', 'discount']);

export function matches(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return GA4_HOST.test(parsed.hostname) && GA4_PATHS.has(parsed.pathname);
}

export function decode(req) {
  const base = new URL(req.url).searchParams;
  const events = [buildEvent(base, req)];

  if (req.body) {
    for (const line of req.body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const params = new URLSearchParams(trimmed);
      if (!params.has('en')) continue;
      events.push(buildEvent(mergeShared(base, params), req));
    }
  }

  return events.filter((e) => e.eventName !== null);
}

function mergeShared(base, params) {
  const merged = new URLSearchParams(base.toString());
  for (const [key, value] of params) merged.set(key, value);
  return merged;
}

function buildEvent(params, req) {
  const decoded = {};
  for (const [key, value] of params) {
    if (key.startsWith('epn.')) decoded[key.slice(4)] = toNumber(value);
    else if (key.startsWith('ep.')) decoded[key.slice(3)] = value;
    else if (key === 'cu') decoded.currency = value;
  }
  const items = decodeItems(params);
  if (items.length) decoded.items = items;

  return tagEvent({
    platform: 'ga4',
    account: params.get('tid'),
    eventName: params.get('en'),
    params: decoded,
    consent: decodeConsent(params.get('gcs')),
    pageUrl: params.get('dl') ?? req.pageUrl,
    timestamp: req.timestamp,
    raw: { url: req.url, method: req.method },
  });
}

function decodeItems(params) {
  const items = [];
  for (const [key, value] of params) {
    if (!/^pr\d+$/.test(key)) continue;
    const item = {};
    for (const part of value.split('~')) {
      const field = ITEM_FIELDS[part.slice(0, 2)];
      if (!field) continue;
      const raw = part.slice(2);
      item[field] = NUMERIC_ITEM_FIELDS.has(field) ? toNumber(raw) : raw;
    }
    items.push(item);
  }
  return items;
}

function decodeConsent(gcs) {
  if (!gcs || !/^G1[01][01]$/.test(gcs)) return null;
  return {
    ads: gcs[2] === '1' ? 'granted' : 'denied',
    analytics: gcs[3] === '1' ? 'granted' : 'denied',
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== '' ? n : value;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tag-event.js src/adapters/ga4.js test/adapters/ga4.test.js
git commit -m "feat: GA4 collect adapter"
```

---

### Task 4: dataLayer adapter

**Files:**
- Create: `src/adapters/datalayer.js`
- Test: `test/adapters/datalayer.test.js`

**Interfaces:**
- Consumes: `tagEvent` (Task 3); the `dataLayer` array from `loadCapture` (Task 1)
- Produces: `{ id: 'datalayer', decodeDataLayer(entries, ctx?) → TagEvent[] }`

- [ ] **Step 1: Write the failing test**

Create `test/adapters/datalayer.test.js`. The first test uses the real roll20 capture — this is the authority for dual-shape handling:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../../src/adapters/datalayer.js`

- [ ] **Step 3: Write the implementation**

Create `src/adapters/datalayer.js`:

```js
import { tagEvent } from '../tag-event.js';

export const id = 'datalayer';

export function decodeDataLayer(entries, ctx = {}) {
  const events = [];
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const args = asGtagCall(entry);
    if (args) {
      events.push(fromGtagCall(args, index, ctx));
      return;
    }
    if (typeof entry.event === 'string') {
      events.push(fromNamedEvent(entry, index, ctx));
    }
  });
  return events;
}

// gtag() pushes its `arguments` object, which serializes to numeric keys with
// no `length` property. Verified live on roll20.net 2026-08-05.
function asGtagCall(entry) {
  if (Array.isArray(entry)) return entry.length ? [...entry] : null;
  if (typeof entry[0] !== 'string') return null;
  const args = [];
  for (let i = 0; Object.prototype.hasOwnProperty.call(entry, i); i += 1) args.push(entry[i]);
  return args.length ? args : null;
}

function fromGtagCall(args, index, ctx) {
  const [command, target, payload] = args;
  const common = {
    platform: 'datalayer',
    params: plainObject(payload),
    pageUrl: ctx.pageUrl ?? null,
    timestamp: null,
    order: index,
    raw: { source: 'gtag', command },
  };
  if (command === 'event') {
    return tagEvent({ ...common, eventName: typeof target === 'string' ? target : null });
  }
  if (command === 'config') {
    return tagEvent({
      ...common,
      eventName: 'gtag.config',
      account: typeof target === 'string' ? target : null,
    });
  }
  if (command === 'consent') {
    return tagEvent({ ...common, eventName: `gtag.consent.${target}` });
  }
  return tagEvent({ ...common, eventName: `gtag.${command}` });
}

function fromNamedEvent(entry, index, ctx) {
  const params = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'event' || key.startsWith('gtm.')) continue;
    params[key] = value;
  }
  return tagEvent({
    platform: 'datalayer',
    eventName: entry.event,
    params,
    pageUrl: ctx.pageUrl ?? null,
    timestamp: null,
    order: index,
    raw: { source: 'dataLayer' },
  });
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The first test proves the numeric-keyed `gtag()` shape decodes correctly — the assumption that would have broken the adapter.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/datalayer.js test/adapters/datalayer.test.js
git commit -m "feat: dataLayer adapter handling both entry shapes"
```

---

### Task 5: Decode registry

**Files:**
- Create: `src/decode.js`
- Test: `test/decode.test.js`

**Interfaces:**
- Consumes: `loadCapture` (Task 1), `ga4` adapter (Task 3), `decodeDataLayer` (Task 4)
- Produces: `decodeCapture(capture, { adapters } = {}) → { events: TagEvent[], errors: {url, message}[] }`. The `adapters` option defaults to the built-in registry and exists so the error path is testable — `URL` and `URLSearchParams` are lenient and will not throw on malformed query strings, so a real decode failure cannot be provoked by input alone.

- [ ] **Step 1: Write the failing test**

Create `test/decode.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/decode.js`

- [ ] **Step 3: Write the implementation**

Create `src/decode.js`:

```js
import * as ga4 from './adapters/ga4.js';
import { decodeDataLayer } from './adapters/datalayer.js';

const NETWORK_ADAPTERS = [ga4];

export function decodeCapture(capture, { adapters = NETWORK_ADAPTERS } = {}) {
  const events = [];
  const errors = [];

  for (const req of capture.requests) {
    const adapter = adapters.find((a) => a.matches(req.url));
    if (!adapter) continue; // unrecognized traffic is never fatal
    try {
      events.push(...adapter.decode(req));
    } catch (error) {
      errors.push({ url: req.url, message: error.message });
    }
  }

  events.push(...decodeDataLayer(capture.dataLayer));

  return {
    events: events.map((event, order) => ({ ...event, order })),
    errors,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/decode.js test/decode.test.js
git commit -m "feat: adapter registry with non-fatal decode errors"
```

---

### Task 6: Rule engine and three rules

**Files:**
- Create: `src/findings.js`, `src/rules/index.js`, `src/rules/duplicate-event.js`, `src/rules/revenue-without-currency.js`, `src/rules/dead-property.js`, `src/rules/malformed-hit.js`
- Test: `test/rules.test.js`

**Interfaces:**
- Consumes: `TagEvent` (Task 3), `stableStringify` (Task 3), `decodeCapture` output (Task 5)
- Produces: `finding(fields) → Finding`; `runRules(events, ctx?) → Finding[]`; each rule module exports `{ id, run(events, ctx) → Finding[] }`

- [ ] **Step 1: Write the failing test**

Create `test/rules.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/rules/index.js`

- [ ] **Step 3: Write the finding factory**

Create `src/findings.js`:

```js
export function finding({ rule, message, evidence = [], suggestion = '', waiveKey }) {
  return { rule, message, evidence, suggestion, waiveKey: waiveKey ?? rule };
}
```

- [ ] **Step 4: Write the three rules and the error surfacer**

Create `src/rules/duplicate-event.js`:

```js
import { finding } from '../findings.js';
import { stableStringify } from '../tag-event.js';

export const id = 'duplicate-event';

const DEFAULT_WINDOW_MS = 2000;

export function run(events, ctx = {}) {
  const windowMs = ctx.duplicateWindowMs ?? DEFAULT_WINDOW_MS;
  const findings = [];
  const seen = new Map();

  for (const event of events) {
    // Events with no real timestamp cannot be windowed. Position is not time.
    if (!event.eventName || event.timestamp === null) continue;
    const key = `${event.platform}|${event.account ?? ''}|${event.eventName}|${dedupeKey(event)}`;
    const prior = seen.get(key);
    if (prior && Math.abs(event.timestamp - prior.timestamp) <= windowMs) {
      findings.push(finding({
        rule: id,
        message: `${event.eventName} fired twice on ${event.platform} within ${Math.abs(event.timestamp - prior.timestamp)}ms with identical parameters`,
        evidence: [prior.raw.url ?? '(dataLayer)', event.raw.url ?? '(dataLayer)'],
        suggestion: 'Deduplicate the trigger, or set `once_per` for this event in tracking-plan.yml if the repeat is intentional.',
        waiveKey: `${id}:${event.platform}:${event.eventName}`,
      }));
    }
    seen.set(key, event);
  }
  return findings;
}

function dedupeKey(event) {
  if (event.params.transaction_id != null) return `tx:${event.params.transaction_id}`;
  return `params:${stableStringify(event.params)}`;
}
```

Create `src/rules/revenue-without-currency.js`:

```js
import { finding } from '../findings.js';

export const id = 'revenue-without-currency';

export function run(events) {
  const findings = [];
  for (const event of events) {
    const { value, currency } = event.params;
    if (value === undefined || value === null) continue;
    if (currency) continue;
    findings.push(finding({
      rule: id,
      message: `${event.eventName ?? 'event'} on ${event.platform} sends value=${value} with no currency`,
      evidence: [event.raw.url ?? '(dataLayer)'],
      suggestion: 'GA4 discards revenue when currency is absent. Send currency alongside value, or set a default currency on the property.',
      waiveKey: `${id}:${event.platform}:${event.eventName ?? ''}`,
    }));
  }
  return findings;
}
```

Create `src/rules/dead-property.js`:

```js
import { finding } from '../findings.js';

export const id = 'dead-property';

export function run(events) {
  const findings = [];
  const reported = new Set();
  for (const event of events) {
    const account = event.account;
    if (!account || !account.startsWith('UA-') || reported.has(account)) continue;
    reported.add(account);
    findings.push(finding({
      rule: id,
      message: `${account} is a Universal Analytics property and is still configured`,
      evidence: [event.raw.url ?? '(dataLayer)'],
      suggestion: 'Universal Analytics stopped processing hits in 2023. Remove the configuration so the dead tag stops loading.',
      waiveKey: `${id}:${account}`,
    }));
  }
  return findings;
}
```

Create `src/rules/malformed-hit.js`:

```js
import { finding } from '../findings.js';

export const id = 'malformed-hit';

export function run(_events, ctx = {}) {
  return (ctx.errors ?? []).map((error) => finding({
    rule: id,
    message: `could not decode a matched hit: ${error.message}`,
    evidence: [error.url],
    suggestion: 'Usually a truncated capture. Re-capture the hit; if it persists the adapter needs to handle this encoding.',
    waiveKey: id,
  }));
}
```

Create `src/rules/index.js`:

```js
import * as duplicateEvent from './duplicate-event.js';
import * as revenueWithoutCurrency from './revenue-without-currency.js';
import * as deadProperty from './dead-property.js';
import * as malformedHit from './malformed-hit.js';

export const RULES = [duplicateEvent, revenueWithoutCurrency, deadProperty, malformedHit];

export function runRules(events, ctx = {}) {
  return RULES.flatMap((rule) => rule.run(events, ctx));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The `dead-property` test proves the rule fires on real captured production data.

- [ ] **Step 6: Commit**

```bash
git add src/findings.js src/rules/ test/rules.test.js
git commit -m "feat: rule engine with duplicate, currency, dead-property, malformed rules"
```

---

### Task 7: Report renderer and CLI

**Files:**
- Create: `src/report.js`, `bin/tagspy.js`, `README.md`
- Test: `test/report.test.js`

**Interfaces:**
- Consumes: `Finding` (Task 6), `decodeCapture` (Task 5), `runRules` (Task 6)
- Produces: `renderReport(findings, {events}) → string`; the `tagspy audit <file>` command

- [ ] **Step 1: Write the failing test**

Create `test/report.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/report.js`

- [ ] **Step 3: Write the report renderer**

Create `src/report.js`:

```js
export function renderReport(findings, { events = [] } = {}) {
  const lines = [];
  const platforms = [...new Set(events.map((e) => e.platform))].sort();

  lines.push(`Decoded ${events.length} event${events.length === 1 ? '' : 's'} across: ${platforms.join(', ') || '(none)'}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No advisory findings.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`${findings.length} advisory finding${findings.length === 1 ? '' : 's'} — these do not fail the run:`);
  lines.push('');

  for (const item of findings) {
    lines.push(`  [${item.rule}] ${item.message}`);
    for (const evidence of item.evidence) lines.push(`      ${evidence}`);
    if (item.suggestion) lines.push(`      -> ${item.suggestion}`);
    lines.push(`      waive with: ${item.waiveKey}`);
    lines.push('');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Write the CLI**

Create `bin/tagspy.js`:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadCapture, CaptureError } from '../src/capture.js';
import { decodeCapture } from '../src/decode.js';
import { runRules } from '../src/rules/index.js';
import { renderReport } from '../src/report.js';

const [command, path] = process.argv.slice(2);

if (command !== 'audit' || !path) {
  process.stderr.write('usage: tagspy audit <capture.json>\n');
  process.exit(2);
}

let capture;
try {
  capture = loadCapture(JSON.parse(readFileSync(path, 'utf8')));
} catch (error) {
  const label = error instanceof CaptureError ? 'invalid capture' : 'could not read capture';
  process.stderr.write(`tagspy: ${label}: ${error.message}\n`);
  process.exit(2);
}

const { events, errors } = decodeCapture(capture);
const findings = runRules(events, { errors });
process.stdout.write(renderReport(findings, { events }));

// Advisory findings never affect the exit code.
process.exit(0);
```

- [ ] **Step 5: Make the CLI executable and verify end to end**

```bash
chmod +x bin/tagspy.js
node bin/tagspy.js audit test/fixtures/datalayer/roll20-homepage.json
```

Expected: the report decodes 7 dataLayer events and reports the `dead-property` finding for `UA-31040388-1`.

```bash
node bin/tagspy.js audit /nonexistent.json; echo "exit=$?"
```

Expected: `tagspy: could not read capture: …` and `exit=2`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, all tests

- [ ] **Step 7: Write the README**

Create `README.md`:

```markdown
# tagspy

Audits marketing tag implementations from captured browser traffic. Decodes GA4
hits and GTM dataLayer entries into one normalized event model, then reports
best-practice findings.

Successor to [ConsoleSpy](https://github.com/mgsrevolver/consolespy).

## Status

Early. GA4 and GTM dataLayer are supported. Meta, Google Ads, TikTok, and
LinkedIn adapters, plus assertions against a tracking plan, are planned.

## Usage

    node bin/tagspy.js audit capture.json

`capture.json` is an envelope holding network requests and a dataLayer snapshot:

    {
      "version": 1,
      "requests": [{ "url": "https://…/g/collect?tid=G-A&en=purchase", "timestamp": 120 }],
      "dataLayer": [{ "event": "purchase", "value": 89 }]
    }

## Design

Capture is not this tool's job — it comes from whatever browser tooling you
already have. Everything here is a pure function over recorded data, so the test
suite never opens a browser.

Findings are **advisory** and never affect the exit code. Hard pass/fail
assertions against a tracking plan you own are a separate, later channel.

## Two channels

| Channel | Source | Gates CI |
| --- | --- | --- |
| Assertions | `tracking-plan.yml` you author | yes (not yet implemented) |
| Heuristics | built-in rules | never |

See `docs/superpowers/specs/` for the full design.

## License

MIT
```

- [ ] **Step 8: Commit**

```bash
git add src/report.js bin/tagspy.js README.md test/report.test.js
git commit -m "feat: report renderer and audit CLI"
```

---

## Self-Review

**Spec coverage.** Covered by this plan: capture boundary, `TagEvent` model, GA4 adapter, dataLayer adapter (both shapes), adapter registry with non-fatal unknown traffic, `duplicate-event`, `revenue-without-currency`, `dead-property`, `malformed-hit`, report with advisory framing, fixture hygiene via `scrubUrl`, all four verified browser constraints, and the error-handling table rows for unrecognized traffic / malformed hit / no plan.

**Deferred to follow-on plans** — each ships working software on its own:

| Plan | Scope |
| --- | --- |
| 2 | `naming-collision`, `placeholder-param`, `cross-platform-gap`, `utm-loss`, `consent-suppression`, `push-before-init`, `ecommerce-not-cleared`. Also from live capture: `event-name-length` (GA4 truncates at 40 chars — observed on shop.merch.google) and `debug-mode-in-prod` (`ep.debug_mode=True` observed in production). **Carried review deferrals:** (a) `decodeConsent` collapses `gcs=G1--` (CMP unset) into `null`, indistinguishable from "no consent signaling" — the consent-suppression rule needs the adapter to decode dashes as `'unset'` first. (b) dataLayer adapter drops the payload of `gtag('set', {...})` (object at args[1], not args[2]) and of sparse arguments objects (`{0:'config', 2:{...}}`) — harden before Plan 2's dataLayer rules rely on gtag-call params. |
| 3 | Meta, Google Ads, TikTok, LinkedIn adapters (registry and rules already accept them unchanged) |
| 4 | `tracking-plan.yml` loader, assertions, `once_per` scopes, waivers, exit codes, spec bootstrapping |
| 5 | The Claude Code skill: driving the browser, walking a funnel, writing the capture envelope |

**Type consistency.** `tagEvent`/`stableStringify` from `src/tag-event.js` used identically in Tasks 3, 4, 6. `finding` signature fixed in Task 6 and consumed unchanged in Task 7. `decodeCapture` returns `{events, errors}` in Task 5; `bin/tagspy.js` destructures exactly that and forwards `errors` as `ctx.errors`, which is what `malformed-hit.run` reads. Every rule module exports `id` and `run(events, ctx)`.

**Known limitation, deliberate:** `duplicate-event` cannot evaluate dataLayer events, because dataLayer entries have no real timestamp. Duplicate detection there needs position-based heuristics and belongs with the dataLayer-specific rules in Plan 2. Tested explicitly rather than left implicit.
