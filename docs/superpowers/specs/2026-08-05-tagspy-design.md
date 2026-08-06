# tagspy — design

**Date:** 2026-08-05
**Status:** approved, pending implementation plan

## Problem

Marketing tag implementations break silently. A `purchase` event starts firing twice and revenue double-counts; a `currency` param goes missing and GA4 drops revenue entirely; UTMs get eaten by an auth redirect and a paid campaign reports as `(direct)`; a Meta pixel stops firing while GA4 keeps working, so paid-media optimization degrades against a signal nobody is watching. None of this throws an error. Nothing turns red. You find out at the end of the month when the numbers look wrong.

Verifying tracking today means opening DevTools, filtering the network tab by hand, decoding query strings by eye, and knowing from experience what should have been there. It is entirely manual, entirely tribal, and it does not happen on a schedule.

Coding agents can now read browser network traffic (Chrome DevTools MCP, Claude in Chrome, Safari MCP). What they lack is the domain knowledge to interpret it: that a GA4 hit is `google-analytics.com/g/collect` with the event name in `en=` and params in `ep.*`/`epn.*`, that a Meta fire is `facebook.com/tr/?ev=Purchase&cd[value]=`, and what the failure modes look like. Capture is solved. Interpretation is not.

## Approach

A Claude Code plugin. The agent walks a funnel on demand, decodes every tag hit into one normalized event model, and evaluates it on two independent channels.

**Non-goal: building capture.** Capture is borrowed from the browser MCP the user already has. Everything tagspy owns is a pure function over recorded data. This is a deliberate reaction to the predecessor project (ConsoleSpy, archived 2026-08-05), which spent its complexity budget on plumbing — two processes, a hardcoded port in four files, an SSE bridge — and was made redundant when vendors shipped the plumbing for free.

### Correctness model: two channels, never conflated

| Channel | Source | Output | Gates CI |
| --- | --- | --- | --- |
| **Assertions** | `tracking-plan.yml`, authored by the user | pass / fail | yes |
| **Heuristics** | built-in best-practice rules | advisory notes | never |

Three rules govern the interaction:

1. **Heuristics always run**, including with no plan present. The tool must be useful on first run against a site you have never configured.
2. **The plan wins on conflict.** If the plan says `page_view` may fire repeatedly and the duplicate-event heuristic disagrees, the assertion passes and the heuristic degrades to a note. The user's declared intent outranks the tool's opinion.
3. **Waivers are durable and reviewable.** Acknowledging a heuristic records it in `tracking-plan.yml` with a reason — not in a local cache. Overriding the tool is a reviewable act. Without this, advisory output gets ignored wholesale by the third run.

**Spec bootstrapping** resolves the usual spec-driven cold-start problem: audit a funnel you believe is working, and the agent proposes a `tracking-plan.yml` from what it observed. You edit and commit. Regression detection without authoring anything from scratch.

## Architecture

```
capture (borrowed)            normalize (owned)         evaluate (owned)          report
──────────────────            ─────────────────         ────────────────          ──────
browser MCP                   platform adapters         assertions → pass/fail    findings,
  read_network_requests  →      ga4 · meta · gads   →   heuristics → advisory     two channels
  javascript_tool               tiktok · linkedin       waivers                   exit code from
  (window.dataLayer)            datalayer                                         assertions only
                                       ↓
                                  TagEvent[]
```

### Modules

| Path | Responsibility | Purity |
| --- | --- | --- |
| `src/adapters/*.js` | one per platform: `{ id, matches(url), decode(req) → TagEvent[] }` | pure |
| `src/rules/*.js` | one per heuristic: `(events, ctx) → Finding[]` | pure |
| `src/spec.js` | load/validate plan, run assertions, apply waivers | pure |
| `src/report.js` | render two channels, derive exit code | pure |
| `skill/SKILL.md` | how to drive the browser, walk a funnel, offer a plan | prompt |

Each unit is independently testable and independently comprehensible. The impure boundary is exactly one thing — capture — and we do not own it.

### The load-bearing decision: one normalized event

```js
{
  platform: 'ga4',
  account: 'G-ABC123',
  eventName: 'purchase',
  params: { transaction_id: 'T-8891', value: 89.00, currency: undefined, items: [...] },
  consent: { analytics: 'granted', ads: 'denied' },
  pageUrl, timestamp,
  raw: { url, method }
}
```

Adapters absorb the per-platform ugliness — GA4 `epn.value` → `value`, Meta `cd[value]` → `value` — so **every rule is written once and applies to all platforms.** Adding another platform is a URL matcher plus a param mapping table, not new machinery. This is what makes six adapters in v1 affordable; without it, each platform would need its own rule set and the scope would be unshippable.

## Verified constraints

Confirmed empirically against a live production site and `example.com` on 2026-08-05, not assumed:

1. **`read_network_requests` preserves query strings intact.** Verified with `https://example.com/?en=purchase&epn.value=89.00&tid=G-TEST123` — returned verbatim. GA4/Meta/Ads decoding is viable through this path.
2. **`javascript_tool` blocks in-page cookie and query-string reads.** A snippet touching `performance.getEntriesByType('resource')` URLs returned `[BLOCKED: Cookie/query string data]`. **Consequence:** network hits must come from `read_network_requests`; `javascript_tool` is for reading `window.dataLayer` objects only, and its snippets must avoid cookie/query-string access or the privacy guard rejects them.
3. **`gtag()` calls land in `dataLayer` as `arguments` objects**, serializing with numeric keys — `{"0":"config","1":"G-AB12CD34EF","2":{...}}` — not as `{event: ...}`. The dataLayer adapter must handle both shapes. Observed live; would have been missed by assumption.
4. **Network capture begins when `read_network_requests` is first called.** Hits fired during initial page load are missed. The skill must call it before navigating, or reload after arming it.

## Heuristics for v1

Cross-platform (written against `TagEvent`, so free across every adapter):

- **duplicate-event** — same platform + event + dedupe key (`transaction_id`, else a hash of the normalized params) within a time window. Default window 2000ms, overridable per event in the plan.
- **revenue-without-currency** — `value` present, `currency` absent
- **cross-platform-gap** — event fired on one installed platform, absent on another
- **naming-collision** — GA4 reserved/automatic names reused as custom events; `camelCase`/`snake_case` drift within one container; two events differing only by case
- **utm-loss** — campaign params present on entry, gone after a redirect or navigation
- **consent-suppression** — events firing while consent is denied, or all events silently dropped
- **placeholder-param** — `value=0` on a purchase, `transaction_id=undefined`, literal `"null"` or `""`
- **dead-property** — a `UA-*` property still configured (Universal Analytics stopped processing in 2023, so these hits go nowhere)

dataLayer-specific:

- **push-before-init** — pushes landing before container initialization
- **ecommerce-not-cleared** — `ecommerce` object not reset between pushes, so stale `items` leak into the next event

Finding shape: `{ rule, message, evidence, suggestion, waiveKey }`.

**Depth caveat, stated rather than smuggled:** GA4 and dataLayer get their platform-specific heuristics in v1. Google Ads, TikTok, and LinkedIn get full decoders and inherit every cross-platform rule, but no platform-specific rules initially. Full decode coverage, uneven opinion coverage.

## Plan format

```yaml
version: 1
platforms:
  ga4: G-ABC123
  meta: "4471..."
events:
  purchase:
    required: [transaction_id, value, currency, items]
    once_per: session
    platforms: [ga4, meta]
waivers:
  - rule: duplicate-event
    event: page_view
    reason: SPA re-renders; verified harmless 2026-08-05
```

No plan → heuristics only, exit 0. Plan present → assertions gate the exit code, heuristics still advise.

`once_per` accepts three scopes, defined explicitly so the assertion is deterministic:

| Value | Scope |
| --- | --- |
| `page` | one document load, reset on any navigation including SPA route changes |
| `navigation` | one committed document load, ignoring SPA route changes |
| `session` | the platform's own session identifier where the hit exposes one (`sid` for GA4), otherwise the whole audit run |

## Testing

Recorded hit URLs as fixtures in `test/fixtures/`, one directory per platform. Every adapter and every rule tested against them. TDD throughout. **No browser in the test suite** — that is the payoff of the pure-core split.

Real captured material available as seed fixtures (from a production site, 2026-08-05):

- GA4 measurement ID `G-AB12CD34EF` alongside a still-configured legacy `UA-4455667-1` — a live `dead-property` finding
- `send_page_view: false` on both configs
- dataLayer events `gtm.js`, `optedIn`, `start_session`, `gtm.dom` — `optedIn` vs `start_session` is a live `naming-collision` finding
- TCF consent framework active; GA4 collect hits absent on the public homepage, consistent with consent gating
- Microsoft Clarity (`e.clarity.ms/collect`) present — a platform not in v1 scope, and a test that unknown traffic is ignored rather than fatal

**Fixture hygiene:** scrub `cid`, `sid`, and any user or session identifiers before committing. Measurement IDs are public (readable in page source) and may stay.

**Purchase fixtures are hand-authored.** Capturing a real `purchase` hit requires completing a real checkout, which is out of bounds. So `purchase` fixtures are synthesized from the GA4 Measurement Protocol and Meta Conversions API references, and every rule that depends on them — `duplicate-event` keyed on `transaction_id`, `revenue-without-currency`, `cross-platform-gap` — is verified against synthetic data only.

This is the weakest link in the test strategy and the spec says so deliberately: vendor docs do not always match what `gtag.js` and `fbevents.js` actually emit in the wild, and the the production site pass already produced one example of exactly that gap (`gtag()` arguments-objects in the dataLayer, documented nowhere obvious). Pre-purchase events (`view_item`, `add_to_cart`, `begin_checkout`) capture freely from any public storefront and should be sourced live. Treat purchase-path rules as lower-confidence until a real hit is available from a staging environment.

## Error handling

| Condition | Behavior |
| --- | --- |
| unrecognized platform traffic | ignore silently; never fail on traffic we don't model |
| malformed hit | decode what parses, emit a finding, never throw |
| no plan file | heuristics only, exit 0 |
| browser MCP unavailable | clear message naming the missing tool |
| plan references unknown platform | validation error before any capture |

## Out of scope for v1

CI runner, browser extension, server-side GTM, Conversions API / offline conversion reconciliation, any UI. The pure core is what keeps the CI runner a small later addition rather than a rewrite.

## Prior art / lineage

Successor to ConsoleSpy (2025–2026, archived). Inherits its central insight — an agent is far more useful when it can see what the browser actually did — and discards its architecture. The three mistakes named in that project's retirement notes are treated here as constraints: one config path, one process, and coupling to the protocol rather than to a single client.
