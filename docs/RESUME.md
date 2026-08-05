# Resume notes — paused 2026-08-05

## Where things stand

| | |
| --- | --- |
| Repo | `/Users/clay/Documents/projects/tagspy` |
| Branch | `feat/core-pipeline` (branched from `main`, nothing merged yet) |
| Working tree | clean |
| Tests | 9/9 passing (`npm test`) |
| Tasks | 1 of 7 complete |

Predecessor project ConsoleSpy is fully wrapped: README rewritten as a retirement
notice, GitHub description updated, repo archived. Nothing left to do there.

## Documents

| Path | What it is |
| --- | --- |
| `docs/superpowers/specs/2026-08-05-tagspy-design.md` | approved design |
| `docs/superpowers/plans/2026-08-05-tagspy-core.md` | 7-task implementation plan (amended 3×, see below) |
| `.superpowers/sdd/2026-08-05-tagspy-core/progress.md` | SDD ledger — **git-ignored scratch, may vanish** |
| `.superpowers/sdd/2026-08-05-tagspy-core/task-N-brief.md` | per-task briefs, all 7 pre-generated |

The ledger is not durable. This file is the durable record; git history is the
other one.

## Completed

**Task 1 — capture envelope.** `package.json`, `src/capture.js`, `test/capture.test.js`.
Commits `8b65807..dab48e1`. Reviewed, one fix round, re-review clean.

## Next action

**Task 2 — fixture acquisition and scrubbing.** Brief at
`.superpowers/sdd/2026-08-05-tagspy-core/task-2-brief.md`. It has three parts:

1. `src/scrub.js` + tests — pure code, delegate to an implementer subagent.
2. `test/fixtures/datalayer/roll20-homepage.json` — the brief contains the exact
   JSON verbatim; no browser needed.
3. `test/fixtures/ga4/storefront-pageview.json` — **needs live browser capture,
   and this is the wrinkle.**

### The Task 2 wrinkle

Part 3 cannot be delegated. Browser tooling belongs to the main session, not to
subagents. Two options:

- **Main session captures, subagent implements.** Arm `read_network_requests`
  *before* navigating (see constraint 4 below), hit a public storefront such as
  `shop.merch.google`, filter on `/g/collect`, scrub every URL through
  `scrubUrl`, and hand the result to the implementer as data.
- **Skip live capture.** The brief authorises hand-authoring the fixture from the
  GA4 Measurement Protocol reference with `"_source": "synthesized"` so the
  confidence gap stays visible. Do not stall on a consent wall.

Do **not** use `roll20.net` for GA4 hits — consent-gated, Cloudflare in the path,
no Meta pixel. It is only good for the dataLayer fixture already captured.

## Verified browser constraints — do not re-derive

Confirmed empirically 2026-08-05:

1. `read_network_requests` preserves query strings verbatim. GA4 decoding through
   it is viable.
2. `javascript_tool` returns `[BLOCKED: Cookie/query string data]` if a snippet
   touches cookies or query strings. Use it for `window.dataLayer` objects only.
3. `gtag()` calls land in `dataLayer` as numeric-keyed objects
   (`{"0":"config","1":"G-…","2":{…}}`) with **no** `length` key. Never assume
   array shape.
4. Network capture starts when `read_network_requests` is first called. Hits from
   the initial page load are missed unless you arm it first or reload after.

## Plan amendments so far

Each was a defect in the plan as authored, found before or during execution:

1. `21d1946` — Task 5's decode-error test could never pass. `URL` and
   `URLSearchParams` are lenient and never throw on malformed query strings, so
   `decodeCapture` now takes an injectable `adapters` option.
2. `b856b9c` — `npm test` was `node --test test/`, which on Node 26 resolves
   `test/` as a module and fails. Corrected to bare `node --test`.
3. `834ef99` — Task 1 fell back to an array index when a request had no
   timestamp, manufacturing fake milliseconds. `duplicate-event` compares against
   a 2000ms window, so two identical events 50 requests apart would have read as
   50ms apart and been flagged as duplicate purchases — the exact bug class
   tagspy exists to catch. This contradicted the plan's own TagEvent contract
   ("position is not time"). `timestamp` is now `null` when unrecorded.

Amendment 3 came from an independent reviewer, not from my own spec or plan
self-review. Both self-reviews missed it.

## How to resume the SDD loop

Scripts live at
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/skills/subagent-driven-development/scripts/`.

Per task: record `BASE=$(git rev-parse HEAD)` → dispatch implementer with the
brief path → on DONE run `review-package PLAN BASE HEAD` → dispatch task reviewer
→ fix loop if needed → append completion to the ledger.

If a brief needs regenerating after a plan amendment:
`task-brief docs/superpowers/plans/2026-08-05-tagspy-core.md N`

Note: implementer transcripts did not survive a session-directory rotation, so
fix rounds may need a fresh implementer carrying the brief and report paths
rather than a resume.

## Two live findings held as fixtures

Both from `roll20.net`, both real:

- `UA-31040388-1` still configured alongside GA4 `G-SZLSVQPSWG`. Universal
  Analytics stopped processing hits in 2023, so that tag loads and goes nowhere.
  Task 6's `dead-property` test asserts against this captured data.
- `optedIn` sitting next to `start_pw` in the same container — camelCase beside
  snake_case, which is the `naming-collision` rule's target. That rule is Plan 2.

## Remaining scope

Tasks 3–7 of this plan: GA4 adapter, dataLayer adapter, decode registry, rule
engine with four rules, report renderer and CLI. Then four follow-on plans —
remaining heuristics, the other four platform adapters, the tracking-plan and
assertions layer, and the Claude Code skill.
