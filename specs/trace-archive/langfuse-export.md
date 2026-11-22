# Langfuse export adapter and scheduled processing

## Source pin

The adapter targets native manifest version 1, enriched `EVENTS` exports,
using uncompressed JSONL. Source inspection was pinned to Langfuse commit
`306cdfb8b38ac8ca35b9c09cebbf2cd110d06978`:

- [Manifest types and builder](https://github.com/langfuse/langfuse/blob/306cdfb8b38ac8ca35b9c09cebbf2cd110d06978/worker/src/features/blobstorage/manifest.ts)
- [Manifest builder tests](https://github.com/langfuse/langfuse/blob/306cdfb8b38ac8ca35b9c09cebbf2cd110d06978/worker/src/__tests__/blobExportManifest.unit.test.ts)
- [Provider export documentation](https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage)

The actual customer deployment and project are still unknown. This pin defines
the tested adapter contract, not evidence of compatibility with that deployment.
Fixtures are synthetic and contain no captured developer conversations.

## Contract

Accept version 1 manifests with `projectId`, `exportSource`, `window`,
`maxTimestamp`, `createdAt`, `tables` and `files`. Ignore additive manifest
properties, but retain a digest of the exact manifest bytes. Reject a different
version or export source. Check the completion object's name against maxTimestamp.
Read listed data keys only within the configured project/table prefix.

Require JSONL, `jsonl-raw`, no compression, known table (`observations_v2` or
`scores`), safe file keys, exact byte size and nonnegative integer row count.
Decode UTF-8 strictly, validate each JSON row and its source project, and compare
row counts. Reject gzip, Parquet, CSV and legacy sources explicitly. Their source
objects remain untouched for a future compatible adapter.

Normalize into the existing internal archive contract, compute byte hashes from
the actual landing objects, then reread the source manifest to detect mutation.
The archive core rereads and hashes the data again before promotion and invokes
the required privacy inspector. No production privacy inspector is supplied by
this change. An adapter's structural validation is not content redaction.

Empty file inventories and zero-byte, zero-row JSONL exports are supported.
Their receipt proves only the supplied manifest was processed. It does not prove
that the source window contains no events.

The docs describe inclusive window boundaries, while the pinned source type
describes half-open boundaries. Preserve the values without resolving that
disagreement by assumption. Do not advance source coverage from window math.
An independent source inventory and revision-aware reconciliation remain required.

## Workflows

`traceArchiveWorker(loadSource)` composes a scheduled Worker with a required
runtime source/policy loader. It is not a deployable entrypoint by itself.
`TRACE_ARCHIVE_ENABLED` must equal `true`; every other value disables collection.
No public HTTP route is supplied. No new credentials are needed by R2 bindings.

Each invocation lists at most 20 completion objects, normalizes and verifies each
batch, persists an attempt in a dedicated D1 journal, then checkpoints the next
listing cursor using a revision precondition. Failure to persist an attempt stops
checkpointing. Lost cursor races cause replay, not an overwrite. At the end of a
listing, reset the cursor to start another full sweep so old failures and later
rewritten manifests are revisited. No source data is deleted by the Collector.

After durable attempts and cursor handling finish, any failed batch causes the
scheduled invocation to reject with only `trace_archive_schedule_failed`. A mixed
page retains verified receipts and failed attempts; a later sweep revisits failures
and reuses prior receipts. This exposes failure to scheduled-job monitoring without
logging source content. It does not configure an alert destination or prove source
coverage. A lost cursor race alone is replay, not a batch verification failure.

The journal stores scope hashes, key hashes, times, outcomes and archive receipts.
It never stores raw errors or trace text. A scan cursor is discovery state, not
proof of complete coverage. Scope includes source identity, environment and policy
version. Policy changes start a separate discovery history. Concurrent runs may
write multiple attempt records but share the same immutable archive receipt.

Apply `packages/trace-archive/migrations/0001_scan.sql` only to a dedicated trace
index database. Do not apply it to the Event Ledger or catalog stores. Neither a
live D1 database nor a scheduled Worker has been provisioned by this change.

## Remaining release gates

- Authenticated Langfuse project URL, actual manifest sample and retention readback.
- Approved credentials/export setup and a runtime catalog source/policy loader.
- Reviewed content policy and developer-side redaction; no permissive default.
- Explicit staging Worker/D1 deployment approval after bindings are reviewable.
- Error notification, backlog budgets, late revision reconciliation and source inventory.
- Authenticated retrieval, versioned Event Ledger integration and a real-session drill.

No receipt claims Event Ledger ingestion or complete source coverage. No source
retention setting changes, production writes, or credential creation are included.
