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

Later the same day, after Danny's "Continue" at 13:01 Pacific time, his
answers to the grilling at 14:32 and his decisions at 16:43, eight more pull
requests followed: five docs-only; #107 and #113, which change configuration or
CI and so owe a Verdict like the code pull requests; and #56, a code pull
request rebased at his decision.

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#105](https://github.com/Zero-State-LLC/Homer/pull/105) | Docs-only: the docs-only CI receipt (ZER-66) | `82c30be` | `82f300a` |
| [#106](https://github.com/Zero-State-LLC/Homer/pull/106) | Docs-only: docs hygiene after the 2026-11-24 audit (ZER-89, part 1), with ADR 007 accepted as Danny ruled in chat | `d1f96bb` | `b891b71` |
| [#107](https://github.com/Zero-State-LLC/Homer/pull/107) | Config: `engines` in every package, `.nvmrc`, and `--retry-wait-time 10` on the `links` check (ZER-89, part 2) | `ef7841f` | `2380f60` |
| [#110](https://github.com/Zero-State-LLC/Homer/pull/110) | Docs-only: agent instructions for Buzz, `docs/agents/buzz.md`, linked from `AGENTS.md` in one line as the Buzz spec says (ZER-49) | `b96ee3c` | `cefc4f2` |
| [#112](https://github.com/Zero-State-LLC/Homer/pull/112) | Docs-only: Danny's six answers from the grilling (`grill-2026-11-25.md`), with the accepted `CONTEXT.md` terms | `b97b7a1` | `0124c26` |
| [#113](https://github.com/Zero-State-LLC/Homer/pull/113) | CI: the `links` check runs lychee a second time when the first run fails (ZER-89), at Danny's choice | `4c6c47e` | `a3d4ac7` |
| [#115](https://github.com/Zero-State-LLC/Homer/pull/115) | Docs-only: Danny's decisions on the open questions, with the research (`decisions-2026-11-25.md`) | `4f5d355` | `641d6f0` |
| [#56](https://github.com/Zero-State-LLC/Homer/pull/56) | Code: the Buzz channel allowlist (ZER-47), rebased onto `main` at Danny's decision (ZER-87) | `6066ee6` | `0510a4b` |

Codex reviewed #106 at `09e7706`. The merge tool then brought the branch up to
date with `main`, which added only #105's two files, so `main` after #106 equals
`09e7706` plus #105. CI passed on `d1f96bb` and on `main`. Pull request #107
passes `--retry-wait-time 10` to the `links` check and accepts and excludes
nothing new. It did not do what its description said: a `502` from github.com
failed the check on #109 within 15 s, too soon for even three 10 s waits, and
passed on re-run. #113 replaced it with a second
lychee run, proved on the branch with a throwaway dead link: both runs failed,
and so did the job. Codex reviewed #113 at `05a5753`; the merge tool then
brought it up to date with #112, and `main` equals that head plus #112 exactly.

After Danny's decisions at 16:43, #42 was closed as superseded, and #56 and #30
were rebased the way the runner stack was. Each original head was pushed first
to `backup/pre-rebase-2026-11-25/<branch>`: `6aaf4d9` for #56, and `e213860`
for #30. Each pull request's whole diff was then replayed as one commit onto `main`,
with a three-way merge against its original base, and pushed with a lease
pinned to the original head. Every file carries the lines it added and removed
before, except where `main` had moved: the build chains, the test projects and
the lockfile take `main`'s entries plus the new package; #56's three Buzz paths
join the `catalogRoutes` caller table, and its webhook line stays out because
that route moved to `homer-intake`; #30's package declares `engines`; and each
CHANGELOG entry sits under Added. Both are noted on the pull requests. CI passed
and Codex was clean on both rebased heads, and `main` after #56 equals its
reviewed head. #30 stays a draft.

Pull requests #99 and #100 build the Alert engine and the fleet's Alert rules
as pure code. Nothing posts yet: that is ZER-115, blocked by the signing
library (ZER-61) and Homer's key (ZER-48). Pull request #100 also adds a
`fleet_held_diagnostics` table to the runner fleet Durable Object, created on
start like the others, and reserves the machine id `collector` and the
sparkDash rule id `stale`.

## Still owed

None of the six code pull requests, #56 included, nor #107 or #113, has a
Verdict. ZER-63 lists them with their full head SHAs.
