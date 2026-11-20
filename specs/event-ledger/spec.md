# Event Ledger specification

Status: Accepted by Danny on 2026-11-19 UTC (2026-11-18 PT).

- Foundation intent — [Homer foundation](../../docs/intent/home-foundation.md)
- Task — [ZER-9](https://linear.app/zer0state/issue/ZER-9/implement-control-room-activity-calendar-and-project-timelines)

## Scope

Collectors need one ordered history of Activity Events. A Projection needs to rebuild from that history and apply Corrections while preserving the original evidence. The first delivery covers the Event Ledger package, its append and read behavior, and verification of the stored sequence. FORGE will choose the storage backend and test the guarantees against it. Live Collectors, Projection interfaces, Source Freshness budgets, and the Control Room migration belong to later work.

## Activity Events

- Validate every append against the existing [Activity Event v1 contract](../integration-contracts/activity-event.v1.schema.json) and its shared validator. Refuse missing or invalid Provenance. Preserve UTC timestamps as supplied, including fractional precision.
- A Collector derives the Event Key from the Source System, Kind, and stable source object ID, plus a native revision ID when needed to distinguish source revisions. Use an unambiguous encoding within the v1 contract. Object IDs must identify the object across the Source System, including repository scope where the Source System reuses IDs. Collection time, Collector version, and delivery attempt cannot contribute to the Event Key.
- The first two segments of the Event Key must match `provenance.sourceSystem` and `kind`. The Collector owns the suffix derivation because v1 carries no separate native revision field. Two observations of the same source revision must produce the same Event Key.
- The Collector can set Actor fields only from an Identity Binding. Without a binding, preserve the raw source account and leave the event Unattributed. A syntactically valid Actor reference alone provides no evidence for Attribution. A review of a binding may justify an appended Correction to previously stored Attribution.
- Keep source facts under their respective Authorities. Linear owns Tasks, GitHub owns Repository Events, the Control Room owns Work Sessions and Handoffs, and software-factory owns Work Packet stage and Verdicts.

### Append outcomes

| Input | Outcome |
| --- | --- |
| Valid Activity Event with a new Event Key | Append once and return its sequence and entry digest. |
| Valid Activity Event with an existing Event Key and identical observed content | Acknowledge a Duplicate and return the original sequence and digest. |
| Valid Activity Event with an existing Event Key and different observed content | Refuse a Conflict. The caller can submit a Correction with evidence. |
| Invalid input | Refuse the append with a validation outcome. |

Compare observed content as canonical JSON, preserving array order and the difference between missing and present fields. Exclude only `provenance.collectedAt`, `provenance.collector`, and `provenance.collectorVersion` from Duplicate comparison. These fields describe collection rather than what happened, and the original values stay in the stored entry and its digest. Changes to the source URL, Actor, evidence, timestamps of the observed event, or Kind-specific data are Conflicts for the same Event Key.

A refused append or a Duplicate leaves the sequence, head, and existing entries unchanged. Validation precedes Duplicate classification. A Correction does not release an Event Key. Later appends with that key still compare against the original Activity Event.

## Corrections

A Correction is its own ledger entry with a stable identifier supplied by a trusted writer, the target Event Key, a non-blank reason, Provenance in the same shape as Activity Event Provenance, and one action.

| Action | Effect when reading a Projection |
| --- | --- |
| Supersede | Use the full replacement Activity Event in place of the original. |
| Retract | Omit the target Activity Event from the effective history. |

- The target must be an earlier, stored Activity Event. The replacement must pass Activity Event validation and preserve the original Event Key, Kind, Source System, and source object ID. For a wrongly identified event, retract it and append the independently verified event under its correct Event Key.
- Later Corrections always reference the original Event Key. When more than one targets the same Activity Event, apply them in ledger sequence. A superseding Correction can restore a retracted event with evidence. Retain every Correction and the original Activity Event in history.
- Trust the writer and its evidence at the write boundary. When a Correction changes a source fact, its Provenance must point to evidence from that fact's Authority. Attribution changes require evidence of a reviewed Identity Binding.
- A repeated Correction identifier with identical canonical content is a Duplicate. Ignore only the three collection fields on Correction Provenance and, for a supersession, on replacement Provenance. Any other reuse of that identifier is a Conflict. The first accepted Correction retains its full Provenance.

## Integrity and reading

- Use contiguous append sequence numbers starting at 1. A committed entry contains a format version, sequence, explicit entry type, previous entry digest, and the full accepted payload. The first entry has a null previous digest.
- Compute each digest as SHA-256 over the UTF-8 encoding of the entry's [RFC 8785 canonical JSON](https://www.rfc-editor.org/rfc/rfc8785), excluding the entry's own digest. Reject inputs outside that JSON domain before persistence. The full payload includes collection fields. Canonical comparison for Duplicates and full-payload hashing serve different purposes.
- Treat uniqueness checks, sequence assignment, and the append as one atomic operation. Concurrent writers must agree on one outcome for each identifier, and distinct accepted appends must form a single chain. A retry after an uncertain commit must return the already committed sequence and digest if it is a Duplicate.
- Read committed entries from a consistent point in the sequence. Replay follows append order even when an Activity Event arrives late. A Projection uses `occurredAt` for temporal display and the ledger sequence to determine which Corrections apply.
- Verify contiguous sequence numbers, supported entry formats, previous digests, and recomputed digests before trusting replay. Refuse corrupted history and surface an integrity failure. When supplied with a separately trusted expected head sequence and digest, verification also requires them to match. Detecting a consistently replaced history or truncated tail requires that trusted head.
- Restrict raw history and append operations to trusted internal consumers. A future API must enforce Scope. Treat source text, URLs, and Kind-specific data as untrusted input. Collectors and Correction writers must exclude One Mind content and credentials from every payload, including evidence URLs and reasons. A shape check cannot enforce that content boundary.

## Acceptance scenarios

| Scenario | Observable result |
| --- | --- |
| A valid Activity Event arrives and the caller later mutates its input. | A read returns the originally committed payload, sequence, and digest. |
| The Collector retries with reordered JSON object fields or different collection bookkeeping. | One entry exists and both receipts identify it. |
| The same Event Key arrives concurrently with two different valid subjects. | One append succeeds, one returns a Conflict, and the chain has one entry for that key. |
| Distinct appends race, or storage fails midway through an append. | Committed entries form one contiguous chain. No partial entry is visible, and repeating a committed append returns its original receipt. |
| A Collector omits Provenance, supplies an offset timestamp, or uses the wrong Kind segment. | The append is refused and the head stays unchanged. |
| A Collector has no Identity Binding. | Authorized consumers can see the source account and the Activity Event remains Unattributed. |
| An authorized writer supersedes, retracts, and then restores one event. | Replaying each prefix yields the corresponding effective history. The full history retains the original and all Corrections. |
| A Correction targets an unknown Event Key, changes source identity, or reuses an identifier with changed content. | The append is refused and the head stays unchanged. |
| An Activity Event with an earlier `occurredAt` is appended after another. | The ledger sequence records append order and consumers retain both original UTC instants. |
| A stored payload, sequence, or link is corrupted, or a trusted head no longer matches. | Verification fails and consumers refuse to replay the invalid history. |
| The ledger is reopened after successful appends. | The same entries and digest chain are readable. Duplicate and Conflict outcomes survive reopening. |

## Workflows

### Bounded archive and isolated restore

The trusted internal binding supports `exportArchive(expectedHead)` and
`restoreArchive(archive, expectedHead, expectedDigest)`. The operator obtains the
expected head separately and retains it with the archive digest in private
recovery evidence. A null expected head means a genuinely empty ledger, never an
unspecified checkpoint. No HTTP route or new caller permission is introduced.

An archive is canonical JSON with exactly `{version: 1, head, entries, digest}`.
The SHA-256 archive digest covers the canonical `{version, head, entries}` object.
Every complete LedgerEntry retains its sequence, entry type, original payload,
previous digest, entry digest and comparison digest. Export reads synchronously,
checks storage metadata and verifies the entire chain against the expected head.
It refuses source changes, gaps, damaged entries and truncated history. It never
exports only effective Projection data or rewrites collection Provenance.

The first atomic format is capped at 4 MiB of complete canonical JSON and 1,000
entries. Each payload must also fit the existing 1 MiB append limit. Export and
restore fail explicitly beyond these bounds; no partial archive is successful.
A paginated successor is required before a ledger exceeds this format.

Restore validates the JSON domain, exact field names, archive digest, trusted head,
payloads, contiguous sequence, hashes, uniqueness and Correction targets before
writing. One synchronous transaction checks that the target has no entries and
inserts the complete history. Any failure leaves it empty. An occupied target is
refused even if its effective Projection is empty or its history is identical.
The ordinary append-only SQL triggers remain active. No history is cleared.

After restore, independently compare every entry and the trusted head, reopen the
object, and verify Duplicate/Conflict outcomes and Correction replay. New appends
must continue at the next sequence with the restored head digest. Preserve the
source, recovery target and private backup; do not repoint Collectors or Projections
without separate cutover approval. Local acceptance does not establish a hosted
restore drill, a scheduled backup policy or production recovery readiness.

Acceptance covers malformed and unknown fields, altered digests and heads,
truncated history, invalid Corrections, oversized input and stored history,
occupied targets, concurrent restores, concurrent ordinary appends, mid-import
failure rollback, restart reconciliation and unchanged source history.

### Hosted recovery runner

A separate maintenance Worker runs a management-invoked Workflow with no HTTP
operation, public route or recurring schedule. Runtime configuration supplies the
source object name, source namespace, isolated recovery namespace and private R2
bucket. The runner defaults to disabled. No source or project inventory is compiled in.

Parameters name a bounded drill identifier, independently retained head and archive
digest, and restore or verify mode. The runner exports and verifies the source,
saves the archive with a create-only R2 condition, reads it back and verifies it
before restore. It accepts an identical already-restored target on a retry but
refuses other occupied targets. Verify mode creates or repairs nothing. Both modes
compare the full restored history and confirm the source remains unchanged.
Workflow step output contains only head, digest, count, archive key and outcome.
At the trusted RPC response boundary only, remove Cloudflare's root Symbol.dispose
transport property before canonical validation. Preserve every other descriptor;
arbitrary symbols, getters and non-JSON data remain invalid. Imported archives
and private backup reads do not receive this transport normalization.
After the drill, disable the runner and remove its source binding. Retain private
backup, recovered history and receipts. No Collector or Projection is repointed.

### Skills

- `anti-slop-code`
- `production-systems`
- `google-developer-style`

### GitHub Actions

| Workflow | Path | When to use |
| --- | --- | --- |
| Docs | [docs.yml](../../.github/workflows/docs.yml) | Lint and check links for the spec, and verify the Context Pin. |
| CI | [ci.yml](../../.github/workflows/ci.yml) | Run the existing workspace checks and, when implemented, the Event Ledger acceptance tests. |
| Secret scan | [secret-scan.yml](../../.github/workflows/secret-scan.yml) | Scan commits and fixtures. |

FORGE owns the implementation plan and Tasks. The [planning handoff](handoff.md) records the inputs and decisions still needed.
