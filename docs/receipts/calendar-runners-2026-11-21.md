# Calendar and runner implementation receipt

Date: November 21, 2026 PT.
Tasks: ZER-32 and ZER-33. Review: PR #35, stacked on PR #32.
Intent: docs/intent/calendar-runners.md; ADRs 001 and 002 under specs/adr.

## Implementation and evidence

- Calendar serves verified Event Ledger history with Corrections, display-zone
  day/week/month grouping, Actor/Project/day filters and source evidence.
- A fixed prefix above 2,000 entries returns an explicit size error, not an
  incomplete success. Larger deployments need an indexed Projection checkpoint.
- Runner fleet stores strict dynamic PC/Mac metadata and desired mode through
  separate durable CAS and append-only audit rows. Observed status stays Unknown.
- HTTP red/green tests passed: eight calendar tests and six runner tests.
- Combined npm run check passed 204 tests, 10 runtime checks, build, formatting,
  lint, types and real Worker smoke. Context Pin positive/negative checks passed.
- Separate Standards/Spec reviews found stale edit recovery and missing browser
  edit/keyboard coverage. Repair discards stale drafts on readback, loads current
  fields and requires fresh manual review. Added real Worker browser assertions
  for concurrent updates, no automatic retry, persisted edits and keyboard use.
- Fixture imports use current-checkout paths. Initial absolute paths and bare
  Markdown research URLs were corrected; no check or assertion was weakened.

## Limits and release

Browser qualification runs in CI because local Wrangler browser startup is blocked
by network-interface restrictions. Current-head CI and screenshots are linked in
PR #35 after execution; this receipt alone is not browser success evidence.

No live calendar readback, host installation or maintenance execution was performed.
Machine OS/architecture, runner IDs and authenticated controller enrollment remain
required. No provider secrets, production deployment or CI routing changes.
The runner additive migration must preserve existing objects and exports on rollback.

Uses CONTEXT Activity Calendar, Actor, Identity Binding, Scope and Authority.
The unchanged Context Pin is verified. Local team HANDOFF/STATUS supplied no
machine identities. Author-side reviews are not a software-factory Verdict.
Exact-head independent Verdict and reproduce checks remain merge requirements.
