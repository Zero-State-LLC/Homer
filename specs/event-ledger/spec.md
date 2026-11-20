# Event Ledger specification

Status — Accepted by Danny on 2026-11-19

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
