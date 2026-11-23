# Intent — Homer emits Work Requests

Author: Hermes (Yes And) for Danny (scrimshawlife-ctrl)
Date: 2026-11-23
Status: accepted
Product: Homer (`Zero-State-LLC/Homer`)

Danny accepted this intent on 2026-11-23 (#59). The next stage is the spec in
`specs/work-requests/`.

This file is a proto-spec. It comes **before** specify.
Next stage is `spec.md` (spec-kit specify). Do not skip to code.

One committed intent per change stream. Live under `docs/intent/`.

## Problem / why now

No code pull request in Homer can merge. The merge contract in `AGENTS.md`
requires an online passing software-factory Verdict with a reproduce check for
the head SHA, and a Verdict needs a Work Packet. A Work Packet is built from a
Homer Work Request. Homer does not emit Work Requests, so the chain stops at its
first link.

This is Danny's decision 5 and 7 in
[the 2026-11-23 receipt](../receipts/implementation-2026-11-23.md): Work
Requests come from the sources the repository already defines, never written by
hand per pull request.

Blocked today: the after-the-fact Verdicts for #51 to #55, and
[#56](https://github.com/Zero-State-LLC/Homer/pull/56) (ZER-47). Every code Task
from ZER-53 onward inherits the same block.

[verified: `docs/receipts/implementation-2026-11-23.md` lines 67-69 and 113-120;
Linear ZER-62; the open pull requests #51 to #56 have green CI and no Verdict]

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

- A Linear Task (`linear:ZER-N`), a GitHub issue (`github:<owner>/<repo>#N`) and
  a manual request (`manual:<slug>`) each produce a Work Request that
  `validateWorkRequest` accepts.
- A source that does not exist, is closed, or does not match the schema's
  `source` pattern is refused, with a reason naming the source and the field.
- Every emitted Work Request carries `testCommand`, so the reproduce check can
  run without a second author step.
- `toWorkPacket` applied to an emitted Work Request produces a packet that
  `factory judge run --reproduce` accepts at intake.
- The path from a merged Task to a Verdict on a pull request is written down as
  one runbook a human can follow end to end.

## Affected users / systems

- Users: Danny (accepts Verdicts and merges), and any agent opening a code pull
  request in Homer, which today has no legal merge path.
- Systems: Homer (`packages/shared-contracts` builders and validators),
  software-factory GAP intake, the software-factory judge.

## Constraints

Product-true locks (do not reopen in implement):

- Homer builds and validates the Work Request. Homer never advances a packet
  past intake, and never writes a Verdict
  ([contract README](../../specs/integration-contracts/README.md)).
- Sources are the three the `source` pattern already admits. No free-form Work
  Request authoring per pull request.
- `toWorkPacket` in `packages/shared-contracts/src/factory.ts` is the only
  mapping to a Work Packet. Do not fork it.
- software-factory runs `test_command` without a shell, so `testCommand` must be
  shell-wrapped: `bash -c 'npm ci --no-audit --no-fund && npm run check'`.
- No secret, token, account id or live credential in the tree, logs, or a Work
  Request. `requestedBy.sourceAccount` is an account identifier, not a secret.
- An Activity Event stays append-only. A Work Request that changes is a new
  request, not an edit of an old one.

Non-goals:

- Judging inside Homer, or ranking Verdicts.
- A Control Room or Linear write-back of Work Request state.
- Deciding the long-term delivery transport for every Source System.

## Resolved questions (2026-11-23, Danny)

Settled in review before acceptance; recorded here so implement does not reopen
them.

- **Delivery to GAP: a local emitter with a CLI**, POSTing only when an endpoint
  is configured, with `toWorkPacket` as the acceptance test. Ledger delivery is
  deferred. See [ADR 006](../../specs/adr/006-work-request-transport.md).
- **`requestId` is deterministic**: the date in it is the source object's own
  immutable date, never the emission date, so a retry cannot create a second
  packet.
- **`requestedBy.sourceAccount` names the emitting Agent** (`agent:<name>`), with
  `actorId` filled from its Identity Binding. The human stays in `who`.
- **A failed delivery exits non-zero and writes no receipt.** A receipt that
  claims delivery it did not achieve would repeat the silent-success defect in
  issue #43.

Still open, and only a human can answer them: whether the schema's inability to
express `requestId` uniqueness is fixed in the contract README now or in a later
revision.

## Claims

| Claim | Label |
|---|---|
| Homer cannot emit Work Requests today | `[verified: no emitter in packages/, ZER-62 is Backlog]` |
| `validateWorkRequest` and `toWorkPacket` already exist and are exported | `[verified: packages/shared-contracts/src/factory.ts, validators.ts]` |
| A Verdict requires a Work Packet from a Work Request | `[verified: specs/integration-contracts/README.md, AGENTS.md merge section]` |
| The GAP transport is undecided | `[verified: ZER-62 agent notes, "How Homer delivers to GAP is not decided yet"]` |
| software-factory runs `test_command` without a shell | `[verified: ZER-62 agent notes]` |

## Next

Accepted. Next is `specs/work-requests/spec.md` with a `## Workflows` section,
landed by pull request, then implementation. Do not implement from this file
alone.
