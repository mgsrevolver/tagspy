# Resume notes — Plans 1 and 2 shipped 2026-08-05

## Where things stand

| | |
| --- | --- |
| Repo | `/Users/clay/Documents/projects/tagspy` (standalone; unrelated to the archived consolespy repo) |
| Branch | `main` — `feat/core-pipeline` and `feat/heuristics` both merged and deleted |
| Remote | none yet — local only |
| Tests | 100/100 (`npm test`), including CLI end-to-end tests over both real fixtures |
| Works | `node bin/tagspy.js audit <capture.json>` |

The core pipeline is complete: capture envelope → GA4 + dataLayer adapters →
decode registry → 4 advisory rules → report/CLI. Advisory findings never affect
the exit code. Run it against `test/fixtures/datalayer/production-homepage.json` for
a real finding (dead UA property) from real captured production data.

## What's next — follow-on plans, in order

The plan document's **"Deferred to follow-on plans"** table
(`docs/superpowers/plans/2026-08-05-tagspy-core.md`) is the authoritative
backlog. Every review deferral from the build is routed there with context.
Summary:

1. **Plan 2 — remaining heuristics.** naming-collision, placeholder-param,
   cross-platform-gap, utm-loss, consent-suppression, push-before-init,
   ecommerce-not-cleared, plus two earned from live capture: event-name-length
   (GA4's 40-char truncation, observed) and debug-mode-in-prod (observed).
   **Read the table's carried deferrals first** — several adapter gaps
   (consent divergence, `ecommerce:null` clears invisible, nested
   `ecommerce.value`) must be fixed before their rules can work.
2. **Plan 3 — Meta, Google Ads, TikTok, LinkedIn adapters.** The table carries
   an adapter checklist (must use `tagEvent()`, must not mutate params). Real
   `/ccm/collect` URLs are already in the GA4 fixture as starting material.
3. **Plan 4 — tracking-plan.yml, assertions, waivers, exit codes.** Table
   carries waiver-granularity notes and the unplumbed `duplicateWindowMs` knob.
4. **Plan 5 — the Claude Code skill** (browser-driving funnel walker).
   **Critical constraint discovered live:** claude-in-chrome's
   `read_network_requests` missed every collect beacon on shop.merch.google
   while CDP (chrome-devtools-mcp) captured all of them — the skill must use
   chrome-devtools-mcp or cross-check against the performance API.

## Facts worth not re-deriving

- GA4 hits appear on BOTH `*.google-analytics.com` and `analytics.google.com`
  (the latter observed live; adapter matches both).
- Consent-denied Google traffic goes to `/ccm/collect` — not decoded yet.
- `gtag()` pushes numeric-keyed `arguments` objects (no `length`) into
  dataLayer; the adapter handles both shapes.
- `process.exitCode`, never `process.exit()`, after writing the report —
  exit() truncates piped stdout at ~64KB (there is a regression test).
- Purchase fixtures are hand-authored from vendor docs (real checkout capture
  is out of bounds); purchase-path rules are lower-confidence until a staging
  capture exists (see spec).

## Job-search framing (why this project exists)

"Growth marketer who built his own tracking-audit agent." When writing the
README for public release, lead with the marketer's problem (silent tracking
breakage) not the architecture. The real-capture findings make good
demo material: real dead UA properties and a 40-char-truncated event name
found on production sites on day one.
