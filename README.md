# tagspy

**Your tracking is broken and nothing is telling you.** A `purchase` event starts
firing twice and revenue double-counts. A `currency` param goes missing and GA4
silently discards the revenue. An auth redirect eats your UTM parameters and a
paid campaign reports as `(direct)`. None of this throws an error. Nothing turns
red. You find out at the end of the month, when the numbers look wrong and the
damage is unrecoverable.

tagspy audits marketing tag implementations from a capture of real browser
traffic. It decodes GA4 hits and GTM dataLayer entries into one normalized event
stream, then runs **twelve opinionated rules** over it — and tells you what it
found, with evidence, without ever failing your build.

```
$ node bin/tagspy.js audit examples/demo-capture.json

Decoded 12 events across: datalayer, ga4

9 advisory findings — these do not fail the run:

  [duplicate-event] purchase fired 2 times on ga4 within 350ms with identical parameters
      https://www.google-analytics.com/g/collect?...&en=purchase&ep.transaction_id=T-1001&epn.value=59.99...
      -> Deduplicate the trigger, or set `once_per` for this event in tracking-plan.yml if the repeat is intentional.
      waive with: duplicate-event:ga4:purchase

  [revenue-without-currency] purchase on ga4 sends value=89 with no currency
      -> GA4 discards revenue when currency is absent. Send currency alongside value,
         or set a default currency on the property.

  [dead-property] UA-1234567-1 is a Universal Analytics property and is still configured
      -> Universal Analytics stopped processing hits in 2023. Remove the configuration
         so the dead tag stops loading.

  [placeholder-param] purchase sends transaction_id="undefined" — a serialization placeholder, not data
      -> A literal "undefined"/"null"/empty value usually means the source variable
         was never populated. Fix the mapping.

  [utm-loss] campaign parameters were present during the session but never on a page_view hit
      -> A redirect (auth, consent, locale) is probably stripping the query string
         before the first page_view.

  ... plus debug-mode-in-prod, naming-collision, push-before-init, ecommerce-not-cleared
```

That's real output, trimmed for width — run the command yourself for the full
report. The demo capture plants nine deliberate defects; tagspy finds all nine.

## Found in the wild

The test fixtures include traffic captured from a live production storefront
(a large, well-resourced one). On the first page load, tagspy found:

- **`custom_event_with_a_name_over_40_charact`** — an event name truncated at
  GA4's 40-character limit, shipping to production. Every report downstream
  shows the mangled name.
- **`debug_mode` enabled on two production properties** — routing live traffic
  into DebugView and skewing BigQuery exports.
- **A Universal Analytics property still configured** — UA stopped processing
  hits in 2023; the tag loads on every page and sends data to nowhere.

If it happens there, it's happening on your site.

## Quick start

Requires Node ≥ 22. Zero dependencies — clone and run.

```bash
git clone https://github.com/mgsrevolver/tagspy.git
cd tagspy
npm test                                        # 100 tests, no browser needed
node bin/tagspy.js audit examples/demo-capture.json
```

To audit your own site, record a capture — any tooling that can read network
requests and `window.dataLayer` works (Chrome DevTools MCP, a HAR export you
transform, or a coding agent driving your browser) — and write it as:

```json
{
  "version": 1,
  "requests": [
    { "url": "https://www.google-analytics.com/g/collect?v=2&tid=G-XXXX&en=purchase&epn.value=89&cu=USD", "timestamp": 61000, "pageUrl": "https://shop.example.com/thanks" }
  ],
  "dataLayer": [
    { "event": "add_to_cart", "ecommerce": { "items": [] } }
  ]
}
```

Then `node bin/tagspy.js audit your-capture.json`. Advisory findings never
affect the exit code: `0` on any successful analysis, `2` only for usage errors.

## The twelve rules

Rules are split across two channels, on one principle: **the network is ground
truth for what was sent; the dataLayer is ground truth for how it was
implemented.** One logical defect produces one finding, not one per channel.

| Rule | Channel | Catches |
| --- | --- | --- |
| `duplicate-event` | wire | the same event firing N times within a window — double-counted revenue |
| `revenue-without-currency` | wire | `value` without `currency`; GA4 drops the revenue entirely |
| `event-name-length` | wire + container | names at GA4's 40-char limit (truncated) or over it (will be) |
| `debug-mode-in-prod` | wire | `debug_mode` shipping on production hits |
| `placeholder-param` | wire | literal `"undefined"`, `"null"`, empty strings, zero-value purchases |
| `consent-suppression` | wire | consent mode declared but no hit carries a resolved consent state |
| `utm-loss` | wire | campaign params visible in the session but never on a `page_view` |
| `malformed-hit` | wire | hits that matched a platform but wouldn't decode |
| `naming-collision` | container | `optedIn` vs `opted_in`, camelCase/snake_case mixes, GA4 auto-event shadowing |
| `push-before-init` | container | events pushed before the GTM container loads — tags can miss them |
| `ecommerce-not-cleared` | container | consecutive ecommerce pushes without `{ecommerce: null}` — stale items leak |
| `dead-property` | either | `UA-*` properties still configured, years after UA stopped processing |

Every finding carries evidence (the actual hit), a suggestion, and a stable
`waiveKey` — so when the assertions layer lands, "I know, it's intentional" is a
one-line, code-reviewable waiver rather than a silenced rule.

## Design

**Advisory now, assertions later.** tagspy has opinions, but you have the final
say. Heuristics never gate CI. Hard pass/fail comes later, from a
`tracking-plan.yml` *you* author — and the plan wins every conflict with the
heuristics.

| Channel | Source | Gates CI |
| --- | --- | --- |
| Assertions | `tracking-plan.yml` you author | yes (planned) |
| Heuristics | the twelve rules above | never |

**Capture is not this tool's job.** Browsers, agents, and proxies already do it
well. Everything in `src/` is a pure function over recorded data — no I/O, no
network, no clock — which is why the 100-test suite runs in under a second and
never opens a browser.

**False positives are treated as the worst defect.** An advisory tool that cries
wolf gets ignored, then uninstalled. Rules here are deliberately conservative:
SPA virtual pageviews aren't flagged as name shadowing, multi-property setups
aren't flagged as duplicates, a name that mixes cases isn't a "convention mix"
with itself. The test suite pins the silences as firmly as the findings.

## Roadmap

- **More platforms:** Meta Pixel, Google Ads, TikTok, LinkedIn adapters — the
  normalized event model means each is a URL matcher plus a param mapping, and
  every rule applies automatically. Then `cross-platform-gap`: GA4 saw the
  purchase, Meta didn't.
- **Assertions:** `tracking-plan.yml` with required params, `once_per` scopes,
  and durable waivers. tagspy will bootstrap the plan from a capture of a funnel
  you believe is working.
- **Agent skill:** a Claude Code skill that walks your funnel in a real browser,
  records the capture, and audits it in one command.

Full design docs live in [`docs/superpowers/specs/`](docs/superpowers/specs/).

## Lineage

Successor to [ConsoleSpy](https://github.com/mgsrevolver/consolespy) (2025,
archived) — same instinct, that agents are more useful when they can see what
the browser actually did; entirely new aim.

## License

MIT
