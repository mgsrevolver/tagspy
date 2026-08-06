# tagspy Heuristics (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining advisory heuristics — seven new rules plus polish to two existing ones — with the adapter hardening they depend on.

**Architecture:** Same pure-function pipeline as Plan 1. New organizing principle, resolving the final review's double-fire finding: **wire rules vs container rules.** Network hits are ground truth for what was actually sent — `revenue-without-currency`, `event-name-length`, `debug-mode-in-prod`, `placeholder-param`, `consent-suppression`, `utm-loss` run on network platforms only. The dataLayer is ground truth for implementation hygiene — `naming-collision`, `push-before-init`, `ecommerce-not-cleared` run on `platform: 'datalayer'` only. One logical defect produces one finding.

**Tech Stack:** unchanged — Node ≥22, ESM, zero dependencies, `node:test`.

**Explicitly out of scope:** `cross-platform-gap` (needs a second network adapter; moved to Plan 3). Cross-source chronological `order` (no rule here needs it; still documented in the Plan 1 table). Waivers/assertions (Plan 4).

## Global Constraints

- Zero runtime and dev dependencies; tests use `node:test` + `node:assert/strict`.
- ESM only. Everything in `src/` is a pure function: no I/O, no network, no `Date.now()`, no globals.
- Advisory findings never affect the exit code.
- Rules must never throw on hostile input; adapters construct events only via `tagEvent()`.
- Kebab-case filenames. Nothing from `.superpowers/` committed. `docs/` untouched by implementers.
- Every finding: `{rule, message, evidence, suggestion, waiveKey}`, deterministic `waiveKey`.
- The two committed fixtures are read-only. Suite currently 55/55 — each task leaves it fully green.

### Consent vocabulary (Task 1 establishes, everything downstream assumes)

`consent` on a TagEvent is `null` (nothing declared) or `{ads, analytics}` where each value is `'granted' | 'denied' | 'unset'`. `'unset'` = a consent-mode signal exists but the CMP has not resolved it (GA4 `gcs=G1--` dashes; observed live on shop.merch.google).

---

## File Structure

| Path | Change |
| --- | --- |
| `src/adapters/ga4.js` | Modify: `decodeConsent` gains `'unset'` |
| `src/adapters/datalayer.js` | Modify: consent unification, `gtag('set')`, sparse args, bare pushes, ecommerce hoist |
| `src/rules/duplicate-event.js` | Modify: pageUrl in key, burst collapse |
| `src/rules/revenue-without-currency.js` | Modify: wire-only |
| `src/rules/event-name-length.js` | Create |
| `src/rules/debug-mode-in-prod.js` | Create |
| `src/rules/placeholder-param.js` | Create |
| `src/rules/consent-suppression.js` | Create |
| `src/rules/naming-collision.js` | Create |
| `src/rules/push-before-init.js` | Create |
| `src/rules/ecommerce-not-cleared.js` | Create |
| `src/rules/utm-loss.js` | Create |
| `src/rules/index.js` | Modify: register new rules (Tasks 4, 5, 6) |
| `test/rules-wire.test.js`, `test/rules-container.test.js`, `test/rules-utm.test.js` | Create |
| `test/cli.test.js` | Modify in Task 4: storefront fixture now yields findings |
| `README.md` | Modify in Task 6: status section |

---

### Task 1: Consent decode unification

**Files:**
- Modify: `src/adapters/ga4.js` (decodeConsent), `src/adapters/datalayer.js` (consent on gtag.consent events)
- Test: `test/adapters/ga4.test.js`, `test/adapters/datalayer.test.js` (append tests)

**Interfaces:**
- Consumes: existing adapters.
- Produces: unified `consent: {ads, analytics}` with `'granted'|'denied'|'unset'` values on GA4 events (from `gcs`) and on dataLayer `gtag.consent.*` events (mapped from `ad_storage`/`analytics_storage` params, which stay in `params` unchanged).

- [ ] **Step 1: Append failing tests**

Append to `test/adapters/ga4.test.js`:

```js
test('decodes unset consent from gcs dashes', () => {
  const [e] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&gcs=G1--'));
  assert.deepEqual(e.consent, { ads: 'unset', analytics: 'unset' });
  const [mixed] = ga4.decode(req('https://a.google-analytics.com/g/collect?tid=G-A&en=x&gcs=G1-1'));
  assert.deepEqual(mixed.consent, { ads: 'unset', analytics: 'granted' });
});
```

Append to `test/adapters/datalayer.test.js`:

```js
test('unifies consent vocabulary on gtag consent events', () => {
  const [e] = decodeDataLayer([{ 0: 'consent', 1: 'default', 2: { ad_storage: 'denied', analytics_storage: 'granted', wait_for_update: 500 } }]);
  assert.deepEqual(e.consent, { ads: 'denied', analytics: 'granted' });
  assert.equal(e.params.ad_storage, 'denied'); // raw params preserved
});

test('consent stays null when a consent call carries no storage keys', () => {
  const [e] = decodeDataLayer([{ 0: 'consent', 1: 'default', 2: { wait_for_update: 500 } }]);
  assert.equal(e.consent, null);
});
```

- [ ] **Step 2: Run tests, verify the three new ones fail**

Run: `npm test` — expected: exactly the new tests fail (`G1--` currently decodes to `null`; datalayer consent events currently have `consent: null`).

- [ ] **Step 3: Implement**

In `src/adapters/ga4.js` replace `decodeConsent`:

```js
function decodeConsent(gcs) {
  if (!gcs || !/^G1[01-][01-]$/.test(gcs)) return null;
  const state = (c) => (c === '1' ? 'granted' : c === '0' ? 'denied' : 'unset');
  return { ads: state(gcs[2]), analytics: state(gcs[3]) };
}
```

In `src/adapters/datalayer.js`, inside `fromGtagCall`, replace the consent branch:

```js
  if (command === 'consent') {
    return tagEvent({
      ...common,
      eventName: `gtag.consent.${target}`,
      consent: consentFromStorageParams(common.params),
    });
  }
```

and add at module bottom:

```js
// Maps gtag consent-mode storage keys onto the unified consent vocabulary
// established by the GA4 adapter ({ads, analytics}); raw params are kept.
function consentFromStorageParams(params) {
  const mapping = { ad_storage: 'ads', analytics_storage: 'analytics' };
  const out = {};
  for (const [key, name] of Object.entries(mapping)) {
    // Some CMPs emit 'GRANTED'/'Denied' — normalize before matching.
    const value = typeof params[key] === 'string' ? params[key].toLowerCase() : params[key];
    if (value === 'granted' || value === 'denied') out[name] = value;
  }
  return Object.keys(out).length ? out : null;
}
```

- [ ] **Step 4: Run `npm test`, expect all green (58 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/adapters/ test/adapters/
git commit -m "feat: unified consent vocabulary across ga4 and datalayer adapters"
```

---

### Task 2: dataLayer adapter hardening

**Files:**
- Modify: `src/adapters/datalayer.js`
- Test: `test/adapters/datalayer.test.js` (append + amend one existing test)

**Interfaces:**
- Produces: `gtag('set', {...})` payload preserved; sparse arguments objects decode fully; eventless object pushes become `eventName: 'datalayer.push'` events (including the canonical `{ecommerce: null}` clear, which keeps `params.ecommerce === null`); nested `ecommerce.{value,currency,transaction_id,items}` hoisted to top-level params (non-destructively) on named events and bare pushes.

- [ ] **Step 1: Append failing tests**

Append to `test/adapters/datalayer.test.js`:

```js
test("keeps the payload of gtag('set', {...})", () => {
  const [e] = decodeDataLayer([{ 0: 'set', 1: { currency: 'USD', country: 'US' } }]);
  assert.equal(e.eventName, 'gtag.set');
  assert.deepEqual(e.params, { currency: 'USD', country: 'US' });
});

test('decodes sparse arguments objects without truncating', () => {
  const [e] = decodeDataLayer([{ 0: 'config', 2: { send_page_view: false } }]);
  assert.equal(e.eventName, 'gtag.config');
  assert.equal(e.params.send_page_view, false);
});

test('emits datalayer.push for eventless object pushes', () => {
  const events = decodeDataLayer([{ ecommerce: { value: 12, items: [] } }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, 'datalayer.push');
  assert.equal(events[0].params.value, 12); // hoisted
});

test('the canonical ecommerce clear is visible', () => {
  const [e] = decodeDataLayer([{ ecommerce: null }]);
  assert.equal(e.eventName, 'datalayer.push');
  assert.equal(e.params.ecommerce, null);
});

test('hoists nested ecommerce params on named events without clobbering', () => {
  const [e] = decodeDataLayer([{ event: 'purchase', value: 99, ecommerce: { value: 89, currency: 'USD', transaction_id: 'T-1' } }]);
  assert.equal(e.params.value, 99); // explicit top-level wins
  assert.equal(e.params.currency, 'USD');
  assert.equal(e.params.transaction_id, 'T-1');
});
```

Amend the existing `ignores entries that are neither shape` test — `{ notAnEvent: 1 }` now legitimately decodes as a bare push:

```js
test('ignores entries that are neither shape', () => {
  assert.deepEqual(decodeDataLayer([null, 'string', 42, {}]), []);
});

test('a keyed object without an event is a bare push, not noise', () => {
  const [e] = decodeDataLayer([{ notAnEvent: 1 }]);
  assert.equal(e.eventName, 'datalayer.push');
  assert.deepEqual(e.params, { notAnEvent: 1 });
});

test('normalizes CMP-cased consent values', () => {
  const [e] = decodeDataLayer([{ 0: 'consent', 1: 'update', 2: { ad_storage: 'GRANTED', analytics_storage: 'Denied' } }]);
  assert.deepEqual(e.consent, { ads: 'granted', analytics: 'denied' });
});
```

- [ ] **Step 2: `npm test` — the six new/amended tests fail**

- [ ] **Step 3: Implement in `src/adapters/datalayer.js`**

Replace `asGtagCall`:

```js
// gtag() pushes its `arguments` object, which serializes to numeric keys with
// no `length` property — and real captures contain sparse ones. Collect every
// numeric key in position, so {0:'config', 2:{…}} keeps its payload at [2].
function asGtagCall(entry) {
  if (Array.isArray(entry)) return entry.length ? [...entry] : null;
  if (typeof entry[0] !== 'string') return null;
  const positions = Object.keys(entry).filter((k) => /^\d+$/.test(k)).map(Number);
  if (!positions.length) return null;
  const args = [];
  for (const p of positions) args[p] = entry[p];
  return args;
}
```

In `fromGtagCall`, before `common` is built, add a `set` special case (the payload sits at args[1]):

```js
  const payload2 = command === 'set' && target && typeof target === 'object' && !Array.isArray(target)
    ? target
    : payload;
```

and use `plainObject(payload2)` for `params`. Then in `decodeDataLayer`'s per-entry logic, after the named-event branch, add the bare-push branch:

```js
    if (!('event' in entry)) {
      const params = {};
      for (const [key, value] of Object.entries(entry)) {
        // __proto__ assignment would poison the params prototype and let a
        // hostile capture file fabricate findings.
        if (key.startsWith('gtm.') || key === '__proto__') continue;
        params[key] = value;
      }
      if (Object.keys(params).length) {
        events.push(tagEvent({
          platform: 'datalayer',
          eventName: 'datalayer.push',
          params: hoistEcommerce(params),
          pageUrl: ctx.pageUrl ?? null,
          timestamp: null,
          order: index,
          raw: { source: 'dataLayer' },
        }));
      }
    }
```

Wrap `fromNamedEvent`'s params in the same hoist (`params: hoistEcommerce(params)`), and add at module bottom:

```js
// GTM's real-world shape nests commerce fields under `ecommerce`. Hoist the
// ones rules care about to the top level; explicit top-level values win, and
// the nested object itself is preserved untouched.
function hoistEcommerce(params) {
  const ec = params.ecommerce;
  if (!ec || typeof ec !== 'object' || Array.isArray(ec)) return params;
  for (const key of ['value', 'currency', 'transaction_id', 'items']) {
    if (params[key] === undefined && ec[key] !== undefined) params[key] = ec[key];
  }
  return params;
}
```

- [ ] **Step 4: `npm test` — all green (64 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/adapters/datalayer.js test/adapters/datalayer.test.js
git commit -m "feat: harden dataLayer adapter — gtag set, sparse args, bare pushes, ecommerce hoist"
```

---

### Task 3: Existing-rule polish

**Files:**
- Modify: `src/rules/duplicate-event.js`, `src/rules/revenue-without-currency.js`
- Test: `test/rules.test.js` (amend + append)

**Interfaces:**
- `duplicate-event`: dedupe key gains `pageUrl`; a burst of N identical events yields ONE finding saying "fired N times", not N−1 pairwise findings. `waiveKey` unchanged (`duplicate-event:platform:event`).
- `revenue-without-currency`: skips `platform === 'datalayer'` (wire rule).

- [ ] **Step 1: Append/amend failing tests in `test/rules.test.js`**

```js
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
```

Note: the existing duplicate tests construct events with no `pageUrl` (both `null`) — they keep passing since equal pageUrls share a key.

- [ ] **Step 2: `npm test` — three new tests fail** (burst currently yields 3 pairwise findings; different-page events currently flag; datalayer revenue currently flags)

- [ ] **Step 3: Implement**

Replace `src/rules/duplicate-event.js`'s `run` (keep `id`, `DEFAULT_WINDOW_MS`, `dedupeKey`, imports):

```js
export function run(events, ctx = {}) {
  const windowMs = ctx.duplicateWindowMs ?? DEFAULT_WINDOW_MS;
  const open = new Map();
  const findings = [];

  const close = (group) => {
    if (group.count < 2) return;
    const span = group.last.timestamp - group.first.timestamp;
    findings.push(finding({
      rule: id,
      message: `${group.first.eventName} fired ${group.count} times on ${group.first.platform} within ${span}ms with identical parameters`,
      evidence: group.evidence.slice(0, 4),
      suggestion: 'Deduplicate the trigger, or set `once_per` for this event in tracking-plan.yml if the repeat is intentional.',
      waiveKey: `${id}:${group.first.platform}:${group.first.eventName}`,
    }));
  };

  // Nothing upstream guarantees chronological order — the capture file's
  // array order is whatever the recorder wrote. Sort a copy so window
  // deltas are always non-negative; unsorted input must not create groups.
  const ordered = events
    .filter((event) => event.eventName && event.timestamp !== null)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const event of ordered) {
    const key = `${event.platform}|${event.account ?? ''}|${event.eventName}|${event.pageUrl ?? ''}|${dedupeKey(event)}`;
    const group = open.get(key);
    if (group && event.timestamp - group.last.timestamp <= windowMs) {
      group.count += 1;
      group.last = event;
      group.evidence.push(event.raw.url ?? '(dataLayer)');
    } else {
      if (group) close(group);
      open.set(key, { count: 1, first: event, last: event, evidence: [event.raw.url ?? '(dataLayer)'] });
    }
  }
  for (const group of open.values()) close(group);
  return findings;
}
```

In `src/rules/revenue-without-currency.js`, first line inside the loop:

```js
    if (event.platform === 'datalayer') continue; // wire rule: the network hit is ground truth
```

- [ ] **Step 4: `npm test` — all green (67 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/rules/ test/rules.test.js
git commit -m "feat: burst-collapsed page-scoped duplicates; revenue rule is wire-only"
```

---

### Task 4: Wire rules

**Files:**
- Create: `src/rules/event-name-length.js`, `src/rules/debug-mode-in-prod.js`, `src/rules/placeholder-param.js`, `src/rules/consent-suppression.js`
- Modify: `src/rules/index.js`, `test/cli.test.js` (storefront expectations change)
- Test: `test/rules-wire.test.js`

**Interfaces:**
- Each module exports `{id, run(events, ctx)}`; registered in `src/rules/index.js`'s `RULES` array.
- After this task the storefront GA4 fixture legitimately produces findings — `test/cli.test.js`'s "No advisory findings" assertion for it MUST be replaced as specified below.

- [ ] **Step 1: Write failing tests — `test/rules-wire.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagEvent } from '../src/tag-event.js';
import { runRules } from '../src/rules/index.js';
import { loadCapture } from '../src/capture.js';
import { decodeCapture } from '../src/decode.js';

const storefront = JSON.parse(readFileSync(new URL('./fixtures/ga4/storefront-pageview.json', import.meta.url)));
const storefrontEvents = decodeCapture(loadCapture(storefront)).events;

const ga4Event = (fields) => tagEvent({ platform: 'ga4', account: 'G-A', timestamp: 0, ...fields });
const ids = (findings) => findings.map((f) => f.rule);

test('flags a 40-char event name as likely truncated — real capture', () => {
  const found = runRules(storefrontEvents).find((f) => f.rule === 'event-name-length');
  assert.ok(found);
  assert.match(found.message, /custom_event_with_a_name_over_40_charact/);
});

test('flags an over-limit dataLayer event name as will-be-truncated', () => {
  const long = 'a'.repeat(45);
  const events = [tagEvent({ platform: 'datalayer', eventName: long, timestamp: null, order: 0 })];
  const found = runRules(events).find((f) => f.rule === 'event-name-length');
  assert.ok(found);
  assert.match(found.message, /45 characters/);
});

test('does not flag normal names or gtm internals', () => {
  const events = [
    ga4Event({ eventName: 'purchase' }),
    tagEvent({ platform: 'datalayer', eventName: 'gtm.js', timestamp: null, order: 0 }),
  ];
  assert.ok(!ids(runRules(events)).includes('event-name-length'));
});

test('flags debug_mode reaching production hits — real capture, once per account', () => {
  const found = runRules(storefrontEvents).filter((f) => f.rule === 'debug-mode-in-prod');
  assert.equal(found.length, 2); // G-XR6MYBBELZ and G-MH4QR9F4ZK carry ep.debug_mode=True
});

test('debug-mode is a wire rule', () => {
  const events = [tagEvent({ platform: 'datalayer', eventName: 'x', params: { debug_mode: true }, timestamp: null, order: 0 })];
  assert.ok(!ids(runRules(events)).includes('debug-mode-in-prod'));
});

test('flags placeholder param values once per event+param', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined', currency: 'USD', value: 5 } }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined', currency: 'USD', value: 5 }, timestamp: 99999 }),
  ];
  const found = runRules(events).filter((f) => f.rule === 'placeholder-param');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /transaction_id/);
});

test('flags a zero-value purchase separately', () => {
  const events = [ga4Event({ eventName: 'purchase', params: { value: 0, currency: 'USD', transaction_id: 'T-1' } })];
  const found = runRules(events).find((f) => f.rule === 'placeholder-param');
  assert.ok(found);
  assert.match(found.message, /value=0/);
});

test('flags consent mode declared in the container but absent from every hit', () => {
  const events = [
    tagEvent({ platform: 'datalayer', eventName: 'gtag.consent.default', params: { ad_storage: 'denied' }, consent: { ads: 'denied' }, timestamp: null, order: 0 }),
    ga4Event({ eventName: 'page_view', consent: null }),
  ];
  const found = runRules(events).find((f) => f.rule === 'consent-suppression');
  assert.ok(found);
  assert.match(found.message, /consent/i);
});

test('debug-mode ignores explicit falsy encodings', () => {
  const events = [
    ga4Event({ eventName: 'x', params: { debug_mode: 0 } }),
    ga4Event({ eventName: 'x', params: { debug_mode: '' }, account: 'G-B' }),
    ga4Event({ eventName: 'x', params: { debug_mode: 'False' }, account: 'G-C' }),
  ];
  assert.ok(!ids(runRules(events)).includes('debug-mode-in-prod'));
});

test('placeholder findings are account-scoped', () => {
  const events = [
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined' } }),
    ga4Event({ eventName: 'purchase', params: { transaction_id: 'undefined' }, account: 'G-B', timestamp: 50000 }),
  ];
  assert.equal(runRules(events).filter((f) => f.rule === 'placeholder-param').length, 2);
});

test('wire truncation and its container source collapse to one finding', () => {
  const full = 'custom_event_with_a_name_over_40_characters';
  const events = [
    tagEvent({ platform: 'datalayer', eventName: full, timestamp: null, order: 0 }),
    ga4Event({ eventName: full.slice(0, 40) }),
  ];
  assert.equal(runRules(events).filter((f) => f.rule === 'event-name-length').length, 1);
});

test('stays silent when hits do carry consent state', () => {
  const events = [
    tagEvent({ platform: 'datalayer', eventName: 'gtag.consent.default', params: {}, timestamp: null, order: 0 }),
    ga4Event({ eventName: 'page_view', consent: { ads: 'denied', analytics: 'denied' } }),
  ];
  assert.ok(!ids(runRules(events)).includes('consent-suppression'));
});
```

- [ ] **Step 2: `npm test` — new file fails to import the missing rules** (registry unchanged so far — the failures come from the missing modules once registered; transcribe Step 3 fully, then re-run)

- [ ] **Step 3: Implement the four rules**

`src/rules/event-name-length.js`:

```js
import { finding } from '../findings.js';

export const id = 'event-name-length';

const GA4_LIMIT = 40;
const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;

export function run(events) {
  const findings = [];
  // Dedupe on the 40-char prefix: a truncated wire name and its full-length
  // container source are the same defect and must yield one finding.
  const seen = new Set();
  for (const event of events) {
    const name = event.eventName;
    if (!name || INTERNAL.test(name) || seen.has(name.slice(0, GA4_LIMIT))) continue;
    // GA4's limit is characters, not UTF-16 units — spread to count codepoints.
    const len = [...name].length;
    if (event.platform !== 'datalayer' && len === GA4_LIMIT) {
      seen.add(name.slice(0, GA4_LIMIT));
      findings.push(finding({
        rule: id,
        message: `${name} is exactly ${GA4_LIMIT} characters — GA4's limit — and was likely truncated from a longer name`,
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'Rename the source event to 40 characters or fewer; the truncated form is what all reports will show.',
        waiveKey: `${id}:${name}`,
      }));
    } else if (event.platform === 'datalayer' && len > GA4_LIMIT) {
      seen.add(name.slice(0, GA4_LIMIT));
      findings.push(finding({
        rule: id,
        message: `${name} is ${len} characters; GA4 will truncate it to ${GA4_LIMIT}`,
        evidence: ['(dataLayer)'],
        suggestion: 'Rename the event to 40 characters or fewer before it reaches the tag.',
        waiveKey: `${id}:${name}`,
      }));
    }
  }
  return findings;
}
```

`src/rules/debug-mode-in-prod.js`:

```js
import { finding } from '../findings.js';

export const id = 'debug-mode-in-prod';

export function run(events) {
  const findings = [];
  const seen = new Set();
  for (const event of events) {
    if (event.platform === 'datalayer') continue; // wire rule
    const dm = event.params.debug_mode;
    if (dm === undefined || dm === null) continue;
    // The wire sends strings ('True', 'False', '0') — normalize before judging.
    if (['', '0', 'false'].includes(String(dm).trim().toLowerCase())) continue;
    const account = event.account ?? '(unknown)';
    if (seen.has(account)) continue;
    seen.add(account);
    findings.push(finding({
      rule: id,
      message: `${account} is receiving hits with debug_mode enabled`,
      evidence: [event.raw.url ?? '(dataLayer)'],
      suggestion: 'debug_mode routes traffic into DebugView and can skew BigQuery exports; strip it outside development.',
      waiveKey: `${id}:${account}`,
    }));
  }
  return findings;
}
```

`src/rules/placeholder-param.js`:

```js
import { finding } from '../findings.js';

export const id = 'placeholder-param';

const PLACEHOLDERS = new Set(['undefined', 'null', 'nan', '[object object]', '']);

export function run(events) {
  const findings = [];
  const seen = new Set();
  for (const event of events) {
    if (event.platform === 'datalayer') continue; // wire rule
    for (const [key, value] of Object.entries(event.params)) {
      if (typeof value !== 'string' || !PLACEHOLDERS.has(value.trim().toLowerCase())) continue;
      // Account-scoped: the same broken mapping on two properties is two defects.
      const dedupe = `${event.account ?? ''}:${event.platform}:${event.eventName}:${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      findings.push(finding({
        rule: id,
        message: `${event.eventName ?? 'event'} sends ${key}=${JSON.stringify(value)} — a serialization placeholder, not data`,
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'A literal "undefined"/"null"/empty value usually means the source variable was never populated. Fix the mapping.',
        waiveKey: `${id}:${event.eventName ?? ''}:${key}`,
      }));
    }
    if (event.eventName === 'purchase' && event.params.value === 0 && !seen.has(`purchase:zero:${event.account ?? ''}`)) {
      seen.add(`purchase:zero:${event.account ?? ''}`);
      findings.push(finding({
        rule: id,
        message: 'purchase fired with value=0 — revenue is being reported as zero',
        evidence: [event.raw.url ?? '(dataLayer)'],
        suggestion: 'If genuinely free, waive this; otherwise the value mapping is broken at the source.',
        waiveKey: `${id}:purchase:zero-value`,
      }));
    }
  }
  return findings;
}
```

`src/rules/consent-suppression.js`:

```js
import { finding } from '../findings.js';

export const id = 'consent-suppression';

export function run(events) {
  const declared = events.some(
    (e) => e.platform === 'datalayer' && typeof e.eventName === 'string' && e.eventName.startsWith('gtag.consent.'),
  );
  if (!declared) return [];
  const wire = events.filter((e) => e.platform !== 'datalayer');
  if (!wire.length) return [];
  // 'unset' means the CMP never resolved before the hit fired — consent
  // state failing to reach the tags, exactly like null. Only a resolved
  // granted/denied value proves the integration works.
  const resolved = (c) => c !== null && Object.values(c).some((v) => v === 'granted' || v === 'denied');
  if (wire.some((e) => resolved(e.consent))) return [];
  return [finding({
    rule: id,
    message: 'consent mode is declared in the container, but no network hit carries a resolved consent state',
    evidence: wire.slice(0, 3).map((e) => e.raw.url ?? '(dataLayer)'),
    suggestion: 'The consent signal is not reaching the tags — verify the consent-mode integration fires before the tags do.',
    waiveKey: id,
  })];
}
```

Update `src/rules/index.js`:

```js
import * as duplicateEvent from './duplicate-event.js';
import * as revenueWithoutCurrency from './revenue-without-currency.js';
import * as deadProperty from './dead-property.js';
import * as malformedHit from './malformed-hit.js';
import * as eventNameLength from './event-name-length.js';
import * as debugModeInProd from './debug-mode-in-prod.js';
import * as placeholderParam from './placeholder-param.js';
import * as consentSuppression from './consent-suppression.js';

export const RULES = [
  duplicateEvent, revenueWithoutCurrency, deadProperty, malformedHit,
  eventNameLength, debugModeInProd, placeholderParam, consentSuppression,
];

export function runRules(events, ctx = {}) {
  return RULES.flatMap((rule) => rule.run(events, ctx));
}
```

- [ ] **Step 4: Amend `test/cli.test.js`** — the storefront fixture now legitimately produces findings. Replace the GA4 e2e test body:

```js
test('audits the captured GA4 storefront fixture end to end', () => {
  const res = run('audit', fixture('ga4/storefront-pageview.json'));
  assert.equal(res.status, 0); // advisory findings never affect the exit code
  assert.match(res.stdout, /Decoded 4 events across: ga4/);
  assert.match(res.stdout, /\[event-name-length\] custom_event_with_a_name_over_40_charact/);
  assert.match(res.stdout, /\[debug-mode-in-prod\]/);
  assert.equal(res.stderr, '');
});
```

- [ ] **Step 5: `npm test` — all green (76 tests)**

- [ ] **Step 6: Commit**

```bash
git add src/rules/ test/rules-wire.test.js test/cli.test.js
git commit -m "feat: wire rules — event-name-length, debug-mode-in-prod, placeholder-param, consent-suppression"
```

---

### Task 5: Container rules

**Files:**
- Create: `src/rules/naming-collision.js`, `src/rules/push-before-init.js`, `src/rules/ecommerce-not-cleared.js`
- Modify: `src/rules/index.js`
- Test: `test/rules-container.test.js`

**Interfaces:** three more `{id, run}` modules, registered after the wire rules.

- [ ] **Step 1: Write failing tests — `test/rules-container.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagEvent } from '../src/tag-event.js';
import { runRules } from '../src/rules/index.js';
import { decodeDataLayer } from '../src/adapters/datalayer.js';

const production = JSON.parse(readFileSync(new URL('./fixtures/datalayer/production-homepage.json', import.meta.url)));

const dl = (eventName, params = {}, order = 0) =>
  tagEvent({ platform: 'datalayer', eventName, params, timestamp: null, order });
const ids = (findings) => findings.map((f) => f.rule);

test('flags mixed naming conventions on the real production container', () => {
  const found = runRules(decodeDataLayer(production.dataLayer)).find((f) => f.rule === 'naming-collision');
  assert.ok(found);
  assert.match(found.message, /optedIn/);
  assert.match(found.message, /start_session/);
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

test('a single mixed-style name is not a convention mix with itself', () => {
  const events = [dl('myEvent_v2')];
  assert.ok(!ids(runRules(events)).includes('naming-collision'));
});

test('hyphen and underscore variants collide', () => {
  const events = [dl('add-to-cart'), dl('add_to_cart', {}, 1)];
  const found = runRules(events).filter((f) => f.rule === 'naming-collision');
  assert.ok(found.some((f) => /collide/.test(f.message)));
});

test('flags a business event pushed before container init', () => {
  const events = [dl('early_signup', {}, 0), dl('gtm.js', {}, 1)];
  const found = runRules(events).find((f) => f.rule === 'push-before-init');
  assert.ok(found);
  assert.match(found.message, /early_signup/);
});

test('the production container pushes nothing before init', () => {
  assert.ok(!ids(runRules(decodeDataLayer(production.dataLayer))).includes('push-before-init'));
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
```

- [ ] **Step 2: transcribe implementations, then `npm test`**

`src/rules/naming-collision.js`:

```js
import { finding } from '../findings.js';

export const id = 'naming-collision';

// page_view and click are deliberately absent: pushing {event:'page_view'}
// for SPA virtual pageviews and click-trigger events is mainstream GTM
// practice, not a defect — flagging them would cry wolf on most containers.
const GA4_AUTO = new Set([
  'session_start', 'first_visit', 'user_engagement', 'scroll',
  'file_download', 'form_start', 'form_submit', 'video_start',
  'video_progress', 'video_complete', 'view_search_results',
]);
const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;
const CAMEL = /[a-z][A-Z]/;

export function run(events) {
  const names = [...new Set(
    events
      .filter((e) => e.platform === 'datalayer' && typeof e.eventName === 'string' && !INTERNAL.test(e.eventName))
      .map((e) => e.eventName),
  )];
  const findings = [];

  for (const name of names) {
    if (GA4_AUTO.has(name)) {
      findings.push(finding({
        rule: id,
        message: `${name} shadows a GA4 automatically-collected event name`,
        evidence: ['(dataLayer)'],
        suggestion: 'Custom events reusing automatic names merge confusingly in reports. Pick a distinct name.',
        waiveKey: `${id}:shadow:${name}`,
      }));
    }
  }

  const normalized = new Map();
  for (const name of names) {
    // Underscores AND hyphens: GA4 names don't allow hyphens, so add-to-cart
    // vs add_to_cart is a real collision, not a style choice.
    const norm = name.toLowerCase().replace(/[_-]/g, '');
    if (normalized.has(norm) && normalized.get(norm) !== name) {
      findings.push(finding({
        rule: id,
        message: `${normalized.get(norm)} and ${name} collide after normalization — they will read as two different events everywhere downstream`,
        evidence: ['(dataLayer)'],
        suggestion: 'Consolidate on one spelling; the split history is unrecoverable later.',
        waiveKey: `${id}:collide:${norm}`,
      }));
    } else {
      normalized.set(norm, name);
    }
  }

  // A name that is BOTH camel and snake (myEvent_v2) belongs to neither pure
  // convention — counting it in both manufactured a self-collision mix
  // finding on otherwise-uniform containers.
  const camel = names.filter((n) => CAMEL.test(n) && !n.includes('_'));
  const snake = names.filter((n) => n.includes('_') && !CAMEL.test(n));
  if (camel.length && snake.length) {
    findings.push(finding({
      rule: id,
      message: `container mixes naming conventions: ${camel[0]} (camelCase) alongside ${snake[0]} (snake_case)`,
      evidence: ['(dataLayer)'],
      suggestion: 'GA4 convention is snake_case. Mixed styles breed duplicate events that differ only in spelling.',
      waiveKey: `${id}:convention-mix`,
    }));
  }

  return findings;
}
```

`src/rules/push-before-init.js`:

```js
import { finding } from '../findings.js';

export const id = 'push-before-init';

const INTERNAL = /^(gtm\.|gtag\.)|^datalayer\.push$/;

export function run(events) {
  const container = events.filter((e) => e.platform === 'datalayer');
  const init = container.find((e) => e.eventName === 'gtm.js');
  if (!init) return [];
  return container
    .filter((e) => typeof e.eventName === 'string' && !INTERNAL.test(e.eventName) && e.order < init.order)
    .map((e) => finding({
      rule: id,
      message: `${e.eventName} was pushed before the GTM container initialized`,
      evidence: ['(dataLayer)'],
      suggestion: 'Tags with page-load triggers can miss pre-init pushes. Move the push after the container snippet, or trigger on the event itself.',
      waiveKey: `${id}:${e.eventName}`,
    }));
}
```

`src/rules/ecommerce-not-cleared.js`:

```js
import { finding } from '../findings.js';

export const id = 'ecommerce-not-cleared';

export function run(events) {
  const findings = [];
  let carrying = null;
  for (const event of events) {
    if (event.platform !== 'datalayer') continue;
    const ec = event.params.ecommerce;
    if ('ecommerce' in event.params && ec === null) {
      carrying = null; // the canonical clear
      continue;
    }
    if (ec && typeof ec === 'object') {
      if (carrying) {
        findings.push(finding({
          rule: id,
          message: `${event.eventName} pushed ecommerce data without clearing after ${carrying.eventName} — stale items can leak between events`,
          evidence: ['(dataLayer)'],
          suggestion: "Push dataLayer.push({ecommerce: null}) before each ecommerce event, per Google's own guidance.",
          waiveKey: `${id}:${event.eventName}`,
        }));
      }
      carrying = event;
    }
  }
  return findings;
}
```

Register all three in `src/rules/index.js` (append imports and `namingCollision, pushBeforeInit, ecommerceNotCleared` to `RULES`).

- [ ] **Step 3: `npm test` — all green (84 tests).** Note the dataLayer CLI e2e test in `test/cli.test.js` asserts `1 advisory finding` — the convention-mix finding now makes it 2. Amend that assertion to:

```js
  assert.match(res.stdout, /\[dead-property\] UA-4455667-1/);
  assert.match(res.stdout, /\[naming-collision\] container mixes naming conventions/);
```

(replacing any single-finding-count assertion if present; keep the dead-property match).

- [ ] **Step 4: Commit**

```bash
git add src/rules/ test/rules-container.test.js test/cli.test.js
git commit -m "feat: container rules — naming-collision, push-before-init, ecommerce-not-cleared"
```

---

### Task 6: utm-loss + README

**Files:**
- Create: `src/rules/utm-loss.js`
- Modify: `src/rules/index.js`, `README.md`
- Test: `test/rules-utm.test.js`

- [ ] **Step 1: Write failing tests — `test/rules-utm.test.js`**

```js
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
```

- [ ] **Step 2: Implement `src/rules/utm-loss.js`**

```js
import { finding } from '../findings.js';

export const id = 'utm-loss';

const CAMPAIGN = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

function hasCampaign(url) {
  if (!url) return false;
  try {
    const params = new URL(url).searchParams;
    return CAMPAIGN.some((key) => params.has(key));
  } catch {
    return false;
  }
}

export function run(events) {
  const tagged = events.filter((e) => hasCampaign(e.pageUrl));
  if (!tagged.length) return [];
  const pageViews = events.filter((e) => e.platform !== 'datalayer' && e.eventName === 'page_view');
  if (!pageViews.length || pageViews.some((e) => hasCampaign(e.pageUrl))) return [];
  return [finding({
    rule: id,
    message: 'campaign parameters were present during the session but never on a page_view hit — attribution is lost before the tag fires',
    evidence: [tagged[0].pageUrl, pageViews[0].pageUrl ?? '(no url)'],
    suggestion: 'A redirect (auth, consent, locale) is probably stripping the query string before the first page_view. Fire the tag before the redirect or carry the params through it.',
    waiveKey: id,
  })];
}
```

Register in `src/rules/index.js` (12 rules total).

- [ ] **Step 3: Update `README.md`** — replace the Status section body with:

```markdown
Twelve advisory rules across two channels. **Wire rules** read the network hits
(ground truth for what was sent): duplicate-event, revenue-without-currency,
malformed-hit, event-name-length, debug-mode-in-prod, placeholder-param,
consent-suppression, utm-loss. **Container rules** read the GTM dataLayer
(ground truth for implementation hygiene): naming-collision, push-before-init,
ecommerce-not-cleared. **dead-property** is channel-agnostic: it reads account
configuration from whichever channel declares it. One logical defect produces
one finding, not one per channel.

Meta, Google Ads, TikTok, and LinkedIn adapters, cross-platform-gap, and
assertions against a tracking plan are planned.
```

- [ ] **Step 4: `npm test` — all green (87 tests). Run the CLI over both fixtures and eyeball the reports.**

- [ ] **Step 5: Commit**

```bash
git add src/rules/ test/rules-utm.test.js README.md
git commit -m "feat: utm-loss rule; document wire vs container rule channels"
```

---

## Self-Review

**Spec coverage.** Plan 2's committed scope, all present: 7 new rules + 2 earned from live capture (event-name-length, debug-mode-in-prod) = 9 new modules… counted: event-name-length, debug-mode-in-prod, placeholder-param, consent-suppression, naming-collision, push-before-init, ecommerce-not-cleared, utm-loss = 8 new + 2 polished. Carried deferrals resolved: consent unset (Task 1a), consent divergence (Task 1b), gtag('set')/sparse args (Task 2), ecommerce:null visibility (Task 2 — unblocks Task 5's rule), nested ecommerce hoist (Task 2), pageUrl dedupe + burst collapse (Task 3), double-fire (wire/container principle, Tasks 3–5). Explicitly deferred: cross-platform-gap → Plan 3; cross-source order → unowned, documented.

**Fixture honesty.** Both real fixtures gain load-bearing assertions: storefront drives event-name-length + debug-mode-in-prod (Task 4, unit + CLI e2e), the production site drives naming-collision convention-mix + push-before-init negative (Task 5). CLI e2e expectations amended in the same task that changes the behavior, never later.

**Type consistency.** All rules `{id, run(events, ctx)}`; `finding()` unchanged; consent vocabulary defined once (Global Constraints) and used identically in Tasks 1 and 4. Test counts per task assume 55 at start: 58/64/67/76/84/87 — approximate (implementers report actuals; the invariant is "fully green").
