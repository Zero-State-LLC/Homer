# Receipt — merges under Danny's admin bypass, 2026-11-25

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-25

## The decision

These merges use the same grant as
[the 2026-11-24 receipt](bypass-merges-2026-11-24.md): on 2026-11-24 at 17:48
Pacific time, Danny told Claude Code to "grant admin bypass for merge as
needed". The main ruleset was not edited, and `AGENTS.md` and the merge
contract in `CONTRIBUTING.md` are unchanged.

Danny asked for two of the changes below in chat on 2026-11-25: #94 ("Yes
extend fleet configuration and continue") and #97 (machine fleet and runner
fleet as separate sections; he chose two pages).

## What merged

Each merged after green CI on its head and a clean Codex review. `main`'s tree
equalled the reviewed head after each merge, and CI passed on `main`, the admin
browser journey included.

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#94](https://github.com/Zero-State-LLC/Homer/pull/94) | The runner fleet configuration lists monitored machines and the `spark` and `jetson` kinds; the Fleet Collector's binding names only configured machines (ZER-113) | `a35c5cc` | `41474b1` |
| [#95](https://github.com/Zero-State-LLC/Homer/pull/95) | The fleet status Projection and view (ZER-81, fleet monitoring packet 5) | `1816959` | `c89cef8` |
| [#97](https://github.com/Zero-State-LLC/Homer/pull/97) | Separate Machine fleet and Runner fleet pages (ZER-114), at Danny's request | `49ece2d` | `146f50a` |
| [#99](https://github.com/Zero-State-LLC/Homer/pull/99) | The Alert engine for Buzz (ZER-55), three Codex fixes | `b6e1f45` | `3c83327` |
| [#100](https://github.com/Zero-State-LLC/Homer/pull/100) | The fleet's Alerts (ZER-82), eight Codex fixes | `3e3fe42` | `c619eda` |

Two contract changes, both written down where they belong:

- #94 adds version 2 of the runner fleet configuration. Version 1 is still read
  and accepted. ADR 002 and the runner lifecycle and controller specs carry the
  amendment note, and the fleet monitoring spec's Machine list describes it.
- #95 adds an optional `homer-catalog` setting, `SPARKDASH_ORIGIN`, and two read
  routes, `/v1/fleet` and `/v1/workspace/fleet`.
  `docs/deployment/cloudflare-catalog.md` lists both. Nothing is deployed.

Pull request #97 adds one admin page, `/v1/admin/machines`, on the same
configuration endpoint, and renames the status view to Machine fleet. The
configuration and its API are unchanged.

**Docs-only.** [#101](https://github.com/Zero-State-LLC/Homer/pull/101)
(`3a33da8`, squash `b6ade52`) is ADR 014, which records Danny's choice in chat
on 2026-11-25: a new `homer-buzz` Worker holds Homer's Buzz key and runs the
Alerts and Buzz collection.

Later the same day, after Danny's "Continue" at 13:01 Pacific time, three more
pull requests followed: two docs-only, and #107, which changes configuration
and CI and so owes a Verdict like the code pull requests.

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#105](https://github.com/Zero-State-LLC/Homer/pull/105) | Docs-only: the docs-only CI receipt (ZER-66) | `82c30be` | `82f300a` |
| [#106](https://github.com/Zero-State-LLC/Homer/pull/106) | Docs-only: docs hygiene after the 2026-11-24 audit (ZER-89, part 1), with ADR 007 accepted as Danny ruled in chat | `d1f96bb` | `b891b71` |
| [#107](https://github.com/Zero-State-LLC/Homer/pull/107) | Config: `engines` in every package, `.nvmrc`, and `--retry-wait-time 10` on the `links` check (ZER-89, part 2) | `ef7841f` | `2380f60` |

Codex reviewed #106 at `09e7706`. The merge tool then brought the branch up to
date with `main`, which added only #105's two files, so `main` after #106 equals
`09e7706` plus #105. CI passed on `d1f96bb` and on `main`. Pull request #107
passes `--retry-wait-time 10` to the `links` check and accepts and excludes
nothing new. It did not do what its description said: a `502` from github.com
failed the check on #109 within 15 s, too soon for even three 10 s waits, and
passed on re-run. ZER-89 stays open on that item.

Pull requests #99 and #100 build the Alert engine and the fleet's Alert rules
as pure code. Nothing posts yet: that is ZER-115, blocked by the signing
library (ZER-61) and Homer's key (ZER-48). Pull request #100 also adds a
`fleet_held_diagnostics` table to the runner fleet Durable Object, created on
start like the others, and reserves the machine id `collector` and the
sparkDash rule id `stale`.

## Still owed

None of the five code pull requests, nor #107, has a Verdict. ZER-63 lists
them with their full head SHAs.
