# ADR 006: a Work Request is built locally and delivered by a CLI

Status: accepted by Danny on 2026-11-24 (#61), with the Work Request spec.
Intent: [Homer emits Work Requests](../../docs/intent/work-requests.md), accepted
2026-11-23 (#59), amended 2026-11-24 (#61).
Amended 2026-11-24 (Danny): a Done Linear Task is admitted, and a recorded
request stands when its source changes. Both amendments are marked below.
Contract: `work-request.v1.schema.json`; mapping `toWorkPacket` in
`packages/shared-contracts/src/factory.ts`.
Related, not yet on `main`: ADR 002, ADR 003 and ADR 005 exist only on PR #44.
Nothing here depends on them.

## Context

Homer can build a Work Request and validate it, and `toWorkPacket` already maps
one to a software-factory Work Packet at stage `intake`. Nothing sends a Work
Request anywhere: no GAP endpoint appears in the tree, no client exists, and no
delivery transport is specified. Until one is, no code pull request in Homer can
obtain a Verdict and therefore none can merge.

Three transports were considered.

## Decision

A **local emitter with a CLI** is the delivery mechanism, in this order of
certainty:

1. It builds the Work Request from a source, validates it, and prints it, or
   writes it where asked.
2. When a GAP intake endpoint is configured, it also POSTs the same body.
3. `toWorkPacket` applied to the emitted request is the acceptance test. A packet
   that `factory judge run --reproduce` accepts proves the whole chain without
   GAP having to exist yet.

The emitter refuses an unknown, closed or malformed source, naming the source and
the field. A Linear Task counts as closed only when it is canceled or a
duplicate: a Done Task is admitted, so merged work can get an after-the-fact
Verdict (amended 2026-11-24). It sets `testCommand` on every request, shell-wrapped
(`bash -c '...'`), because software-factory executes it without a shell. It
exits non-zero and writes no receipt when a configured POST fails.

`requestId` is deterministic: `WR-<source date>-<slug>`, where the date is the
source object's own immutable date — a Linear Task's creation date, a GitHub
issue's `created_at`, a manual request's fixed slug date. It is never the
emission date. The same source emitted twice therefore yields the same
`requestId`: a retry is a Duplicate. Changed source content at the same id never
replaces the first request: the recorded request stands, the emitter returns it
and warns that the source changed, and a changed requirement needs a new source
(amended 2026-11-24; this replaces "changed content is a Conflict").

Homer never advances a packet past `intake` and never writes a Verdict.

## Consequences

- The chain works before GAP exists, which is what unblocks the after-the-fact
  Verdicts for #51 to #55 and the merge of #56.
- No Activity Event contract change. Ledger delivery would have needed a new
  Kind and therefore version 3; that is deferred until dispatch is real.
- The idempotency guarantee lives in contract wording and tests, not in the JSON
  Schema, which cannot express uniqueness. `specs/integration-contracts/README.md`
  must say so, or the next implementer will regenerate ids per attempt.
- Transport is manual whenever no endpoint is configured. That is a deliberate
  stopgap, not a target state.
- A committed artifact per request was rejected as the primary transport: it is
  durable and diffable but stale by nature and invites editing a delivered
  request in place.

## Alternatives considered

- **Committed artifact under `docs/receipts/` per request.** Reviewable, no code.
  Rejected as primary because a request's lifecycle outlives the commit that
  introduced it, and amending a delivered request would be an edit where the
  contract wants a new request.
- **GAP polls the Event Ledger for a `work-request` Kind.** Cleanest long term,
  and it matches how Factory Events already flow back. Rejected for now because
  it adds an Activity Event major version before the event shape is known.
- **Homer POSTs directly from a Worker on a schedule.** Rejected: it makes
  delivery a side effect of a cron with no human in the loop, and gives the
  emitter privileges it does not need.
