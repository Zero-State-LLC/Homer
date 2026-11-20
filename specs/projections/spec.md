# Activity Calendar and Project Timeline

Status: implementation specification under the accepted Homer foundation intent.

## Requirements and contracts

The package accepts effective Activity Events in append order, obtained with
`replayEffectiveHistory(await ledger.readHistory())`. Never pass unverified raw
history. It returns data only. No network calls, writes, account lookup, implicit
clock, production UI, or invented Attribution.

The Activity Calendar accepts an IANA Display Time Zone, a day/week/month bucket,
and optional Project, Actor id and Actor kind filters. ISO weeks start Monday.
Storage timestamps remain byte-for-byte unchanged. Display order compares UTC
instants at nanosecond precision, with Event Key as a stable tie breaker.
Unattributed means absent Actor id, regardless of a source account's name.

The Project Timeline reads `data.milestoneId` on `milestone.planned` and
`milestone.completed`. Planned Dates are date-only `YYYY-MM-DD` or null. They are
never shifted through a time zone. Linear is the Authority for these Milestone
facts. Planning data can contain `dependencies` (Milestone ids) and `ownerActorId`;
these must come from reviewed Collector mapping, never from display names.

Completion is evidence-based. A caller supplies trusted `VerifiedCompletion`
records containing the Event Key, source URL and evidence URL. The record must
match both event Provenance and one attached evidence URL. Only then is
`occurredAt` used as the Actual Date. A completed status alone leaves Actual Date
unknown. These records attest a prior verification; this package does not fetch
or judge linked evidence.

`blocker.raised` / `blocker.cleared` use `data.blockerId` and optional
`data.milestoneId`. `ci.completed`, `deployment.completed` and
`factory.verdict_recorded` appear as Release Gate evidence, with their Source
System preserved. They do not automatically authorize a release.

Malformed timeline data and an unexpected Authority produce explicit warnings.
Corrections are applied before projection; replay rebuilds the whole result.
Milestones are returned sorted by id; updates are folded in ledger order.
Dependencies with no known Milestone and dependency cycles produce warnings.

Source Freshness takes an explicit `asOf` UTC instant and per-source checkpoints:
last successful collection and a caller-configured maximum age in seconds. Missing
budgets, missing success times, invalid times and future times are Unknown. A
failed attempt does not replace the last success. No default budgets are implied.

## Journeys and workflows

1. A trusted consumer reads and verifies a fixed Event Ledger prefix.
2. Replay applies Corrections in append order.
3. Calendar filters and buckets effective Activity Events in the Display Time Zone.
4. Timeline folds Milestones and Blockers, attaches evidence and Source Freshness.
5. A later authenticated Control Room adapter renders these data on desktop and mobile.

## Acceptance tests

- UTC storage is unchanged while Pacific day bucketing crosses UTC midnight.
- Both repeated fall-back instants remain visible; spring-forward creates no
  invented event. ISO weeks cross year boundaries correctly.
- Actor kind, Actor id and Project filters compose; source names do not assign identity.
- Late arrivals are temporally sorted without losing fractional timestamp precision.
- Missing target dates stay Unknown Date; status-only completion has no Actual Date.
- A matching trusted completion receipt yields the evidence-linked Actual Date.
- Untrusted completion receipts and wrong Authorities cannot promote completion.
- Correction replay rebuilds calendar and timeline without changing original entries.
- Unmapped dependencies and cycles are explicit; failed collection preserves stale success.

## Workflows

`npm run check` runs the existing checks plus the package's pure projection tests.
No production release is part of this package. The migration plan governs cutover.

## Projection edge semantics

- Actual Date is the full UTC completion instant, including source precision.
  Planned Date is a civil date. Render Actual Date in the viewer's Display Time
  Zone; do not convert Planned Date through UTC midnight.
- The latest Milestone Activity Event in ledger order supplies its subject.
  A completion can change the subject without proving completion; only a trusted
  completion receipt sets Actual Date. The subject is descriptive, not evidence.
- Blocker ids are scoped to the Source System. A clear from another Source System
  cannot clear a same-named Blocker. Collectors must preserve this identity.
- Each Source Freshness result includes `warnings`. Missing, duplicate, invalid,
  or future checkpoints remain Unknown with a diagnostic. Duplicate checkpoints
  never select a winner. The Project Timeline includes diagnostics for supplied
  checkpoints; an unconfigured Source System remains Unknown without a timeline
  warning. This is an additive Projection result field, not a ledger wire change.
- Replay in Projection tests uses the public Event Ledger export. Canonical hash
  helpers are used only to construct synthetic history, not as a runtime API.
