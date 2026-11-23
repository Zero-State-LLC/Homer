# Work Request emission (v0.1.0)

Status: draft. Written after Danny accepted the
[Work Request intent](../../docs/intent/work-requests.md) on 2026-11-23 (#59).
No emitter, endpoint or packet exists on `main`; nothing here is enabled.
Decision: [ADR 006](../adr/006-work-request-transport.md).
Contract: `../integration-contracts/work-request.v1.schema.json`, mapped to a
Work Packet by `toWorkPacket` in `packages/shared-contracts/src/factory.ts`.

## Scope and boundaries

Homer builds a Work Request from one Source System object, validates it with
`validateWorkRequest`, and makes it available to software-factory. Homer never
advances a Work Packet past `intake` and never writes a Verdict.

In scope: a pure builder, a CLI, a receipt, and refusal of bad sources.
Out of scope: judging, packet stages after intake, Linear or GitHub write-back,
and any Change to an Activity Event contract.

## Domain vocabulary

Defined in [`CONTEXT.md`](../../CONTEXT.md); restated only where this spec narrows
them:

- **Emitter**: the component that builds one Work Request from a source object.
- **Source**: `linear:ZER-<n>`, `github:<owner>/<repo>#<n>` or `manual:<slug>`.
  The pattern is fixed by the contract; a fourth form needs a contract revision.
- **Requester**: the Agent that emits the request, recorded as
  `requestedBy.sourceAccount` = `agent:<name>`, with `actorId` only from its
  Identity Binding. The human with the pain is `who`.

## Contract

### `requestId`

```text
WR-<source date>-<slug>
```

- `<source date>` is the source object's own immutable date in UTC:
  a Linear Task's `createdAt`, a GitHub issue's `created_at`, or the date fixed in
  a manual request's reviewed definition. It is **never** the emission date.
- `<slug>` is the source object's identifier, lowercased and encoded into at most
  48 characters: `zer-62`, `github-zero-state-llc-homer-issue-59`,
  `manual-nightly-flags`. When the lowercased identifier is longer than 48
  characters it is **not** truncated. The first 39 characters are kept, `-`
  follows, and 8 hexadecimal characters of `sha256(canonical source)` are
  appended, so two long identifiers that share a prefix cannot collapse into one
  id. Two distinct sources that still produce the same `requestId` are a
  collision: the emitter refuses both with `id_collision` rather than picking one.
- The pair is total: the same source emitted twice yields the same `requestId`.
  A second emission with identical content is a **Duplicate** and is not
  re-delivered; different content at the same id is a **Conflict** and is
  refused with both payloads named, never overwritten.

The JSON Schema cannot express uniqueness. This section is the normative rule;
the tests are its proof.

### Duplicate and Conflict

Content is compared over the derived request **excluding `requestedAt`** and
`contract`. `requestedAt` is the one field whose value depends on the caller's
clock, so including it would turn every retry into a Conflict and defeat the
retry guarantee. Every other field participates, including `requestId`,
`source`, `pain`, `who`, `doneWhen`, `repository`, `riskTier`, `budgetUsd`,
`requestedBy` and `testCommand`.

A retry that finds an existing receipt reuses the recorded envelope verbatim,
`requestedAt` included, so the delivered body is byte-identical to the first
delivery. A retry with a changed field is a Conflict even when only `requestedAt`
differs from the recorded envelope, because reuse — not re-derivation — is what a
retry does.

### Fields the emitter must derive, not accept

| Field | Derived from | Rule |
| --- | --- | --- |
| `contract` | constant | `home.work-request/v1` |
| `requestId` | source | rule above |
| `source` | source | the three admitted forms |
| `pain` | source title plus body | at least 10 characters; Markdown stripped of control characters |
| `who` | source assignee or reporter | the human's source account label; never an email |
| `doneWhen` | source acceptance criteria | at least one item; if the source has none, refuse rather than invent |
| `repository` | reviewed Project mapping | must match `^Zero-State-LLC/[A-Za-z0-9._-]+$` |
| `riskTier` | reviewed policy | never guessed from text |
| `budgetUsd` | reviewed policy | positive, at most 500 |
| `requestedBy.sourceAccount` | emitting Agent | `agent:<name>` |
| `requestedAt` | caller clock | UTC, ISO-8601 `Z`; excluded from Duplicate/Conflict comparison, and reused from the recorded envelope on a retry |
| `testCommand` | reviewed repository policy | shell-wrapped: `bash -c '...'` |

An impossible derivation is a refusal with a reason code, never a default.

## Workflows

### Emit for a Linear Task

1. Resolve `linear:ZER-<n>` through the reviewed Linear mapping.
2. Refuse if the Task is cancelled, in a non-Homer Project, or has no acceptance
   criteria.
3. Build, validate, and print or write the request.

### Emit for a GitHub issue

Same shape against a GitHub issue, using `created_at` for the date and
`repository` from the issue's own repo.

A closed issue is **refused**, whether it was closed as completed, not planned, or
stale. The accepted intent requires a closed source to be refused, and starting an
intake Work Packet for work already finished is the failure that rule prevents. If
completed issues ever need their own path, that is an accepted intent change
first, not a spec exception.

### Emit manually

A manual request is a reviewed file under `docs/work-requests/`, one per slug, so
it has a fixed date and cannot be fabricated at emission time.

### Deliver

1. Print the validated JSON when no endpoint is configured.
2. When `GAP_WORK_REQUEST_URL` is set, POST the same body.
3. On a non-2xx response, exit non-zero and write **no** receipt.
4. On success, write a receipt naming the request id, the endpoint, the response
   status and the instant. The receipt is Homer's own record.

`toWorkPacket(request, now)` applied to the emitted body is the acceptance test: a
packet `factory judge run --reproduce` accepts proves the chain without GAP.

## Security and abuse cases

| Case | Behaviour |
| --- | --- |
| Source names a repository outside the reviewed mapping | refuse, reason `source_not_mapped` |
| Issue text contains a secret-shaped string | strip and warn; never echo the value |
| Source date missing or unparseable | refuse, reason `source_date_unknown`; never substitute the current date |
| `doneWhen` absent | refuse, reason `acceptance_missing`; never invent criteria |
| Endpoint returns 4xx | non-zero exit, no receipt, body echoed without credentials |
| Endpoint returns 2xx with a different id | refuse, reason `delivery_id_mismatch` |
| Two distinct sources encode to one `requestId` | refuse both, reason `id_collision`; never pick a winner |
| Issue is closed, including closed as completed | refuse, reason `source_closed` |

No credential, account id or token enters a request, a receipt, a log or a pull
request.

## Test and acceptance matrix

| Test | Proves |
| --- | --- |
| Linear fixture emits a valid request | the happy path for the most common source |
| GitHub issue fixture emits a valid request | second source form |
| Manual fixture emits a valid request | third source form |
| Same fixture emitted twice | identical `requestId`, Duplicate acknowledged once |
| Same fixture emitted twice with different caller clocks | Duplicate, not Conflict: `requestedAt` is outside the comparison |
| Two long source identifiers sharing a 39-character prefix | different `requestId`s, via the hash suffix |
| Same id, changed body | Conflict refused |
| Emission across a simulated midnight | `requestId` unchanged, proving the date is the source's |
| Unknown, cancelled, unmapped source | refusal with the named reason code |
| Issue closed as completed | refused with `source_closed`, not admitted as intake |
| `toWorkPacket` on every fixture | packet validates against the pinned upstream schema |
| Endpoint failure | non-zero exit, no receipt file written |

## Execution plan and dependencies

1. Builder and refusal codes in `packages/shared-contracts` beside `toWorkPacket`.
2. Fixtures for the three sources, then the matrix above.
3. The CLI, then delivery behind `GAP_WORK_REQUEST_URL`.
4. A runbook for a human pasting the JSON into `factory judge run`.

Blocked on nothing in Homer. Unblocks the after-the-fact Verdicts for #51 to #55
and the merge of #56.

## Primary references

- [Intent](../../docs/intent/work-requests.md), accepted 2026-11-23.
- [ADR 006](../adr/006-work-request-transport.md).
- `specs/integration-contracts/README.md` and the Work Request schema.
- `docs/receipts/implementation-2026-11-23.md`, decisions 5 and 7.
