# Handoff — Homer on 2026-11-25

Author: Claude (Claude Code) for Danny (scrimshawlife-ctrl)
Date: 2026-11-25 Pacific Time. It replaces
[the 2026-11-23 handoff](implementation-2026-11-23.md) as the latest.

What merged, and under which grant, is in the bypass receipts for
[2026-11-24](bypass-merges-2026-11-24.md) and
[2026-11-25](bypass-merges-2026-11-25.md). Linear (team ZER, project Homer) is
the Authority for each Task's state; this page only points.

## Streams

| Stream | Where it stands | Next |
| --- | --- | --- |
| Fleet monitoring (ZER-76) | Packets 1 to 6 are on `main` (ZER-77 to ZER-82), with monitored machines (ZER-113) and separate Machine fleet and Runner fleet pages (ZER-114). Nothing is deployed. | ZER-83, the runbook, read-only accounts and live receipt, is a human's. Posting Alerts is ZER-115. |
| Buzz | The contract (ZER-45), the mapper (ZER-46) and the Alert engine (ZER-55) are on `main`. ADR 014 places the key and schedule in a `homer-buzz` Worker. | ZER-115 and ZER-54 need ZER-61 (`@noble/curves`) and ZER-48 (Homer's key). Agent sessions have package installs off, so ZER-61 needs a session with them on. ZER-47 is #56, from before the restart (ZER-87). ZER-49 is agent docs. |
| Knowledge loop and Curator | Accepted intent and spec. Not built. | ZER-50 and ZER-51 are a human's. ZER-52 to ZER-60 follow. |
| Work Requests (ZER-62) | Builder, policy, Jev client, emitter and runbook are on `main`. | The first end-to-end Verdict run (ZER-74) is Danny's. Delivery to GAP is ZER-75. |
| Versioning (ZER-90) | All five packets are on `main`. | The staging deploy receipts for `v0.1.0-rc.1` (ZER-95) are Danny's. |
| CI feedback | Both packets are on `main`, and the first docs-only runs are measured. | Requiring `check`, `audit` and `admin-browser` on `main` is Danny's (ZER-67). |
| Runner stream | On `main` since 2026-11-24. | Live enrollment and drain or resume (ZER-34). Job provenance views (ZER-36). The Performance tab (ZER-42). |
| Credential administration | Operator forms and read views are on `main`. Its spec is still a draft. | Accept or revise the spec (ZER-86). |
| Work Assignment Router | Intent and ADR 007 accepted. | No spec yet. |

## Waiting on Danny

- Verdicts for 36 code pull requests (ZER-63).
- The ruleset decisions (ZER-67, ZER-85) and the public-repository settings
  (ZER-84).
- The pull requests from before the restart, #30, #42 and #56 (ZER-87).
- Two Dependabot pull requests, #102 and #103. Neither was merged under the
  bypass: a dependency change needs a human's yes.
- The status lines normalized on 2026-11-25 (ZER-89): each marked "inferred" in
  that pull request's table is his to confirm.

## Open questions with defaults

- Fleet Alerts announce a rule's recovery only when sparkDash is `ok`. A
  recovery seen with metrics off is posted when metrics return. Adding an
  alerts-enabled flag to the Fleet Report would post it sooner. That is a
  contract change, not made.
