# Receipt — merges under Danny's admin bypass, 2026-11-25

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-25

## The decision

These merges use the same grant as
[the 2026-11-24 receipt](bypass-merges-2026-11-24.md): on 2026-11-24 at 17:48
Pacific time, Danny told Claude Code to "grant admin bypass for merge as
needed". The main ruleset was not edited, and `AGENTS.md` and the merge
contract in `CONTRIBUTING.md` are unchanged.

Danny asked for the first change below in chat on 2026-11-25: "Yes extend
fleet configuration and continue".

## What merged

Each merged after green CI on its head and a clean Codex review. `main`'s tree
equalled the reviewed head after each merge, and CI passed on `main`, the admin
browser journey included.

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#94](https://github.com/Zero-State-LLC/Homer/pull/94) | The runner fleet configuration lists monitored machines and the `spark` and `jetson` kinds; the Fleet Collector's binding names only configured machines (ZER-113) | `a35c5cc` | `41474b1` |
| [#95](https://github.com/Zero-State-LLC/Homer/pull/95) | The fleet status Projection and view (ZER-81, fleet monitoring packet 5) | `1816959` | `c89cef8` |

Two contract changes, both written down where they belong:

- #94 adds version 2 of the runner fleet configuration. Version 1 is still read
  and accepted. ADR 002 and the runner lifecycle and controller specs carry the
  amendment note, and the fleet monitoring spec's Machine list describes it.
- #95 adds an optional `homer-catalog` setting, `SPARKDASH_ORIGIN`, and two read
  routes, `/v1/fleet` and `/v1/workspace/fleet`.
  `docs/deployment/cloudflare-catalog.md` lists both. Nothing is deployed.

## Still owed

Neither has a Verdict. ZER-63 lists them with their full head SHAs.
