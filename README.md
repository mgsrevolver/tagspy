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
