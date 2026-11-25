# Work Request emission (v0.1.0)

Status: accepted by Danny on 2026-11-24 (#61), with the open-choice defaults.
Intent: [Homer emits Work Requests](../../docs/intent/work-requests.md), accepted
by Danny on 2026-11-23 (#59) and amended on 2026-11-24 (#61): Done Linear Tasks
are admitted, a recorded request stands when its source is edited, and Jev picks
the risk tier.
Decision: [ADR 006](../adr/006-work-request-transport.md).
Contract: `../integration-contracts/work-request.v1.schema.json`, mapped to a
Work Packet by `toWorkPacket` in `packages/shared-contracts/src/factory.ts`.
Linear Task: ZER-62. No emitter, store or endpoint exists on `main`; nothing here
is enabled.

## Scope and boundaries

Homer builds a Work Request from one Source System object, validates it with
`validateWorkRequest`, records it, and makes it available to software-factory.
Homer never advances a Work Packet past `intake` and never writes a Verdict.

In scope: a pure builder, a request store, a CLI, a delivery receipt, a reviewed
policy file, the risk-tier decision, and refusal of bad sources.
Out of scope: judging, choosing the judge model, packet stages after intake,
Linear or GitHub write-back, and any change to an Activity Event contract.

## Domain vocabulary

Defined in [`CONTEXT.md`](../../CONTEXT.md); restated only where this spec narrows
them:

- **Emitter**: the component that builds one Work Request from a source object.
- **Source**: `linear:ZER-<n>`, `github:<owner>/<repo>#<n>` or `manual:<slug>`.
  The pattern is fixed by the contract; a fourth form needs a contract revision.
- **Requester**: the Agent that emits the request, recorded as
  `requestedBy.sourceAccount` = `agent:<name>`, with `actorId` only from its
  Identity Binding. The human with the pain is `who`.
- **Recorded request**: the first Work Request emitted for a `requestId`, kept in
  the request store. It never changes. A retry returns it.
- **Receipt**: the record that a recorded request reached a configured endpoint.
  Emission and delivery are separate records: printing a request records it but
  writes no receipt.

## Contract

### `requestId`

```text
WR-<source date>-<slug>
```

`<source date>` is the source object's own immutable date in UTC: a Linear Task's
`createdAt`, a GitHub issue's `created_at`, or the `date` in a manual request's
reviewed file. It is **never** the emission date.

`<slug>` is computed from the canonical source, the `source` string with a GitHub
owner and repository lowercased (GitHub treats both case-insensitively):

| Source | Encoded form before bounding |
| --- | --- |
| `linear:ZER-62` | `zer-62` |
| `github:Zero-State-LLC/Homer#59` | `github-zero-state-llc-homer-issue-59` |
| `manual:nightly-flags` | `manual-nightly-flags` |

The GitHub form is `github-<owner>-<repo>-issue-<n>`. In it, every character
outside `[a-z0-9-]` becomes `-`. A GitHub repository name may hold `.` or `_`,
so that replacement can map two repositories to one form (`homer.v2`,
`homer_v2` and `homer-v2`). The encoding is therefore **exact** only when no
character was replaced and the form has at most 48 characters. Otherwise the
slug is the form's first 39 characters, then `-`, then the first 8 hexadecimal
characters of `sha256` over the canonical source in UTF-8. The Linear and manual
forms cannot lose a character, so only their length can trigger the hash.

The forms start with different prefixes (`zer-`, `github-`, `manual-`), so two
source forms cannot meet. A collision that remains is caught by the request
store: a recorded request at the same `requestId` with a different `source` is
refused as `id_collision`.

The JSON Schema cannot express uniqueness. This section is the normative rule;
the tests are its proof.

### The request store

The emitter keeps one file per `requestId`: `<store>/<requestId>.json`, holding
the recorded request exactly as first emitted. It creates that file atomically
and never overwrites, renames or deletes it. Beside it sit the risk-tier
decision (`<requestId>.risk.json`) and, after a delivery, the receipt
(`<requestId>.receipt.json`). The request file is written last, so a decision
file without its request is not a record, and the next emission replaces it. A
missing or unreadable store stops the emitter before it derives anything; it
never falls back to emitting without a record.

Version 1 keeps the store on the machine where the software-factory judge runs
(Danny's machine, as in ZER-63), at `$HOMER_WORK_REQUEST_STORE`, by default
`~/.local/state/homer/work-requests/`. A request emitted on another machine has
no record there, so emitting anywhere else is not supported in version 1. A
shared store is an open choice below.

### Retries and changed sources

Danny decided on 2026-11-24 that a recorded request stands.

1. The emitter reads the source and derives the `requestId`. A source it cannot
   read, or whose date it cannot parse, is refused here (`source_not_found`,
   `source_date_unknown`).
2. It checks admission: a canceled or duplicate Linear Task and a closed GitHub
   issue are refused (`source_canceled`, `source_closed`), with or without a
   record. A recorded request stands when its source is edited, not when its
   work is canceled. The record is kept either way.
3. **No recorded request:** it derives the full request, validates it, records
   it, and outputs it. Any refusal in the derivation refuses the emission.
4. **A recorded request with the same `source`:** this is a **Duplicate**. The
   emitter outputs the recorded request byte for byte, `requestedAt` and
   `requestedBy` included, and exits 0. It also derives the request again:
   - If that derivation refuses, for example `acceptance_missing` because the
     `Done when` section was removed, it warns `source_changed` with that reason
     code. The refusal does not reach the exit status.
   - If it succeeds and the packet that `toWorkPacket` makes from it differs from
     the packet made from the recorded request, it warns `source_changed` and
     names the changed packet fields.

   It never replaces the record. A changed requirement needs a new source: a new
   Task, issue or manual file.
5. **A recorded request with a different `source`:** refused as `id_collision`,
   naming both sources.

Comparing packets, not requests, keeps `contract`, `requestedAt` and
`requestedBy` out of the comparison: none of them reaches the packet. A retry by
a different Agent, at a different time, is still a Duplicate.

### Fields the emitter must derive, not accept

| Field | Derived from | Rule |
| --- | --- | --- |
| `contract` | constant | `home.work-request/v1` |
| `requestId` | source | the rule above |
| `source` | source | one of the three admitted forms |
| `pain` | source title and summary | Linear and GitHub: `<title>: <first paragraph>`, where the first paragraph is the body's text before its first heading or list; control characters removed, whitespace collapsed, at most 600 characters, cut at a word boundary. Manual: the file's `pain`. At least 10 characters |
| `who` | source creator | the Actor named by the creator's Identity Binding; with no binding, the raw stable account (`linear:<user id>`, `github:<login>`, or the manual file's `who`). Never the assignee, a display name or an email |
| `doneWhen` | source acceptance criteria | Linear and GitHub: the list items under the body's first heading named `Done when` or `Observable done`, case-insensitive, at any heading level. Manual: the file's `doneWhen`. Each item trimmed, with control characters removed; duplicates dropped in order. At least one item of at least 5 characters, or refuse `acceptance_missing` |
| `repository` | policy | a Linear Task: its Project through `linearProjects`; a GitHub issue: its own repository; a manual request: its file's `repository`. The repository must have an entry in `repositories` |
| `riskTier` | Jev, with a policy floor | the [risk-tier decision](#the-risk-tier-decision) below; never below the repository's `riskFloor`, never from a default when Jev cannot answer |
| `budgetUsd` | policy | the repository's entry; positive, at most 500 |
| `testCommand` | policy | the repository's entry, shell-wrapped: `bash -c '...'` |
| `links` | source | the Linear or GitHub source's own `https://` URL; none for a manual request |
| `requestedBy` | emitting Agent | `sourceAccount` = `agent:<name>`; `actorId` only from its Identity Binding |
| `requestedAt` | emitter clock | UTC, ISO-8601 with `Z`, taken when the request is first recorded; a retry returns the recorded value |

`paths` and `outOfScope` are not emitted in version 1. An impossible derivation
is a refusal with a reason code, never a default.

The `pain` and `doneWhen` rules match how Homer's Tasks are already written:
ZER-62 and ZER-63 carry a `## Done when` section, and the `intent` issue form
has an `Observable done` field. No Identity Binding store exists yet (ZER-48), so
until one does, `who` is the raw account and `actorId` is absent.

### The risk-tier decision

Danny decided on 2026-11-24 that Jev picks each request's risk tier. Jev is
TypeSafe AI's decision model: it answers typed questions with a choice and a
confidence, and never writes prose. Homer calls it through Cloudflare Workers AI
as `typesafe/jev`.

1. The emitter asks Jev one `choice` question with the options `low`, `medium`
   and `high`. The question gives the upstream Work Packet schema's definition
   (`high` = touches auth, money, secrets, data deletion or production
   infrastructure), and the state is the same source text that `pain` and
   `doneWhen` come from: the title, the body and the `Done when` items.
2. When Jev's confidence in its choice is below the policy's
   `riskDecider.minConfidence`, the tier goes one step higher, up to `high`. An
   unsure answer rounds toward more care, never less.
3. The result is never below the repository's `riskFloor`.
4. If Jev cannot answer, because of a failed call, an unknown option or a missing
   confidence, the emission is refused as `risk_unavailable` and nothing is
   recorded. The emitter never falls back to the floor or to a default.
5. The decision is recorded beside the request, as
   `<store>/<requestId>.risk.json`: the model, Jev's choice, its confidence and
   probabilities, the floor, the resulting tier, and the instant. The request
   itself carries only `riskTier`, as the contract allows.
6. A retry does not call Jev again. It compares packets using the recorded tier,
   so the recorded decision stands with the recorded request.

The secret check runs before the call, so text refused as `secret_in_source`
never leaves the machine. Cloudflare lists Jev as third-party with zero data
retention. A call costs about 0.042 USD per million input tokens, and output
tokens are free, so a Task costs a small fraction of a cent.

### The policy file

`docs/work-requests/policy.json` is reviewed configuration, changed only by pull
request:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "linearProjects": { "Homer": "Zero-State-LLC/Homer" },
  "riskDecider": { "model": "typesafe/jev", "minConfidence": 0.8 },
  "repositories": {
    "Zero-State-LLC/Homer": {
      "riskFloor": "low",
      "budgetUsd": 5,
      "testCommand": "bash -c 'npm ci --no-audit --no-fund && npm run check'"
    }
  }
}
```

The Homer values are Danny's (2026-11-24): the lowest floor and budget, so a
judge run stays cheap, with Jev raising the tier where a Task needs it. The
`minConfidence` of 0.8 is a default; see Open choices. A missing or invalid
policy file refuses every source with `policy_invalid`. The emitter never falls
back to built-in values.

### Manual requests

A manual request is a reviewed file, `docs/work-requests/<slug>.json`, landed by
pull request. It holds `date` (`YYYY-MM-DD`), `repository`, `title`, `pain`,
`who` and `doneWhen`, so a manual request has a fixed date and cannot be
fabricated at emission time. The `manual:<slug>` source names the file.

## Workflows

### Emit for a Linear Task

1. Read the Task through the Linear API with the reviewed read-only key (see
   [Credentials](#credentials)).
2. Refuse if the Task does not exist (`source_not_found`), is in a Canceled or
   Duplicate state (`source_canceled`), or has no Project mapped in the policy
   (`source_not_mapped`).
3. A Task in Backlog, Todo, In Progress, In Review or **Done** is admitted. Done is
   admitted so merged work can get an after-the-fact Verdict (Danny, 2026-11-24,
   ZER-63). ZER-68, ZER-69 and ZER-70 were filed as Done Tasks for #51 to #53 for
   that reason. Any other state, such as Triage, is refused as
   `source_not_ready`: the Task has not been accepted into the work yet.
4. Derive, record and output, by the store rules above.

### Emit for a GitHub issue

The same shape against a GitHub issue, read with the machine's `gh`
authentication, using `created_at` for the date and the issue's own repository.

A closed GitHub issue is refused as `source_closed`, whether it was closed as
completed, not planned or stale. A pull request has an issue number too, but it
is not an issue: a source that names one is refused as `source_not_found`, and so
is a response whose repository or number differs from the source. Admitting Done Linear Tasks did not change this;
see Open choices.

### Emit manually

Read `docs/work-requests/<slug>.json` from the emitter's checkout of `main`, and
refuse `source_not_found` when it is absent there.

### Deliver

1. With no endpoint configured, print the recorded request. A human gives it to
   `toWorkPacket` and `factory judge run`, as the runbook says.
2. When `GAP_WORK_REQUEST_URL` is set, POST the recorded request.
3. On a non-2xx response, exit non-zero and write **no** receipt. The recorded
   request stays, so a retry POSTs the same body.
4. On success, write a receipt beside the record, `<requestId>.receipt.json`,
   naming the request id, the endpoint's origin (never its path or query), the
   response status and the instant.

GAP has no intake endpoint yet, so its response format and authentication are
not specified. `delivery_id_mismatch` applies only once that format carries an
id. Delivery waits for both.

`toWorkPacket(request, now)` applied to the emitted request is the acceptance
test: a packet that `factory judge run --reproduce` accepts proves the chain
without GAP.

### Credentials

The emitter runs on the judge's machine. It reads Linear with a read-only API key
from 1Password through the read-only service account, the way the curator
runner reads its secrets, and GitHub with that machine's `gh` authentication. It
calls Jev with a Cloudflare API token scoped to Workers AI and the account id,
both read from 1Password the same way. Each key reaches the process environment
only; it never enters a request, the store, a receipt, a log or a pull request. The builder itself is pure: it takes the source's API response, the policy, the
bindings and Jev's answer, and does no I/O.

### Skills

- `anti-slop-code`
- `production-systems`
- `google-developer-style`

### GitHub Actions

| Workflow | Path | When to use |
| --- | --- | --- |
| CI | `.github/workflows/ci.yml` | Builder, store and CLI tests run in the workspace `check` job |
| Docs | `.github/workflows/docs.yml` | Markdown lint and links for this spec and the runbook |
| Secret scan | `.github/workflows/secret-scan.yml` | Proves no key or token entered fixtures or receipts |

## Security and abuse cases

| Case | Behaviour |
| --- | --- |
| Source names a Project or repository outside the policy | refuse, `source_not_mapped` |
| Source does not exist, or names a GitHub pull request | refuse, `source_not_found` |
| Linear Task in Triage or an unknown state | refuse, `source_not_ready` |
| Source response missing a field, of the wrong type, or a Linear identifier outside ZER | refuse, `source_malformed`, naming the field |
| Linear Task in a Canceled or Duplicate state | refuse, `source_canceled` |
| GitHub issue closed, including closed as completed | refuse, `source_closed` |
| Source date missing or unparseable | refuse, `source_date_unknown`; never substitute the current date |
| No `Done when` or `Observable done` items | refuse, `acceptance_missing`; never invent criteria |
| Policy file missing or invalid | refuse, `policy_invalid`; no built-in values |
| Store missing or unreadable | stop before deriving; never emit without a record |
| Same `requestId`, different `source` in the store | refuse, `id_collision`, naming both |
| Source edited after its request was recorded, even into one that no longer derives | output the recorded request and warn `source_changed`, with the derivation's reason code when it refuses; never overwrite |
| Source canceled or closed after its request was recorded | refuse, `source_canceled` or `source_closed`; the record is kept |
| Source text holds a secret-shaped string | refuse, `secret_in_source`, naming the field and never the value |
| Endpoint returns non-2xx | non-zero exit, no receipt, response body not echoed |
| Jev call fails or returns no usable choice | refuse, `risk_unavailable`; nothing recorded, no fallback tier |
| Jev unsure (below `minConfidence`) | one tier higher, recorded with the confidence |

Refusing a secret-shaped string, rather than stripping it, keeps the derivation
deterministic and treats the secret in a Task as the incident it is. No
credential, account id or token enters a request, the store, a receipt, a log or
a pull request.

## Test and acceptance matrix

| Test | Proves |
| --- | --- |
| A Linear, a GitHub and a manual fixture each emit a valid request | the three source forms |
| A Done Linear Task emits; a canceled one is refused | Danny's 2026-11-24 rule |
| A GitHub issue closed as completed is refused | `source_closed` still holds |
| Emit twice from the same store | the second output is byte-identical: a Duplicate |
| Emit twice with a different Agent and clock | still a Duplicate: `requestedBy` and `requestedAt` stay out of the comparison |
| Emit, edit the source's `Done when`, emit again | recorded request returned, `source_changed` names `done_when`, exit 0 |
| Emit, remove the `Done when` section, emit again | recorded request returned, `source_changed` with `acceptance_missing`, exit 0 |
| Emit, cancel the Task, emit again | refused `source_canceled`; the record is unchanged |
| Emission across a simulated midnight | `requestId` unchanged: the date is the source's |
| `homer.v2`, `homer_v2` and `homer-v2` issues with the same number | three different ids, through the hash suffix |
| Two long manual slugs sharing a 39-character prefix | different ids |
| A store seeded with the same id and another source | `id_collision` |
| `Done when` under `##`, `###` and `Observable done` headings | each extracts; no heading refuses `acceptance_missing` |
| A creator with and without an Identity Binding | the Actor, or the raw account; never the assignee |
| Missing policy, missing store | `policy_invalid`; stop before deriving |
| A secret-shaped string in the body | `secret_in_source`, value not printed |
| `toWorkPacket` on every emitted fixture | the packet validates against the pinned upstream schema |
| Endpoint failure | non-zero exit, no receipt file, record kept |
| Jev (stubbed) picks `high` for a Task about credentials | `riskTier` is `high`, and the `.risk.json` records the choice and confidence |
| Jev picks `low` at confidence 0.6 | `riskTier` is `medium` |
| Jev picks `low` with a `medium` floor | `riskTier` is `medium` |
| Jev call fails | `risk_unavailable`, no record written |
| A retry of a recorded request | no Jev call; the recorded tier is used |
| A secret-shaped string in the body | refused before any Jev call |

## Execution plan and dependencies

1. The pure builder and refusal codes in `packages/shared-contracts`, beside
   `toWorkPacket`, with fixtures of raw Linear and GitHub API responses.
2. `docs/work-requests/policy.json` with Homer's values, and the Jev call behind
   an interface the builder's tests stub.
3. The store and CLI in a new `packages/work-request-emitter`: reads, the store,
   printing, and the tests above.
4. The runbook `docs/deployment/work-requests.md`: from a Task to a packet to
   `factory judge run --reproduce` to a Verdict comment on the pull request.
5. Delivery behind `GAP_WORK_REQUEST_URL`, once GAP has an intake endpoint.

Steps 1 to 4 unblock ZER-63 and the Verdicts that #56, #63 and #64 wait on.
Step 5 waits on GAP.

## Open choices with defaults

Each default holds unless Danny changes it when accepting this spec.

| Choice | Default | Alternative |
| --- | --- | --- |
| Where the request store lives | On the judge's machine, under `$HOMER_WORK_REQUEST_STORE` | A records branch in Homer that any machine can append to; or the Event Ledger, which needs Activity Event version 3 (ADR 006 deferred it) |
| A GitHub issue closed as completed | Refused, as the intent's text says | Admitted like a Done Linear Task |
| How the emitter reads sources | It reads Linear and GitHub itself on the judge's machine, so no hand-editable copy sits between source and request | It takes a snapshot file that an agent exports, which keeps credentials off the emitter but lets the caller alter the source |
| Jev's `minConfidence` | 0.8; below it the tier goes one step higher | A different threshold, or always taking Jev's choice |
| Endpoint variable | `GAP_WORK_REQUEST_URL` | Whatever name GAP's intake defines when it exists |
| Saying in the contract README that `requestId` is unique per source | In this spec only, as the intent left open | Also in `specs/integration-contracts/README.md` now |

## Primary references

- [Intent](../../docs/intent/work-requests.md), accepted 2026-11-23, amended
  2026-11-24.
- [ADR 006](../adr/006-work-request-transport.md).
- `specs/integration-contracts/README.md` and the Work Request schema.
- `docs/receipts/implementation-2026-11-23.md`, decisions 5 and 7.
- Linear: ZER-62 (this work), ZER-63 (after-the-fact Verdicts), ZER-68 to
  ZER-70 (Done Tasks for #51 to #53).
- Cloudflare's [Jev model page](https://developers.cloudflare.com/ai/models/typesafe/jev/),
  read 2026-11-24: the `typesafe/jev` model id, the `choice` question type, and
  pricing.
