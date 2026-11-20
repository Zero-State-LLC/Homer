# Event Ledger archive and recovery

This procedure covers the bounded internal recovery API in
[the Event Ledger specification](../../specs/event-ledger/spec.md#bounded-archive-and-isolated-restore).
It is separate from catalog recovery. No public export or restore endpoint exists.
Only an authorized maintenance Worker with a trusted Durable Object binding may
use these methods. Never grant a recovery binding to an untrusted caller.

## Prepare

1. Select the source namespace and stable object identity. Record the current
   deployment version and independently retain `head()` in private recovery
   evidence. Do not derive the expected head solely from an unverified archive.
2. Select a separate recovery namespace and a fresh object identity. Do not reuse
   the live source as a restore target or change any Collector binding.
3. Ensure the source contains no more than 1,000 entries and its complete archive
   fits 4 MiB. The format refuses larger histories; it does not truncate or page.
   Implement and qualify paginated recovery before reaching either limit.
4. Coordinate a quiet collection window. If the source changes after the head was
   recorded, export refuses that checkpoint. Obtain and verify a fresh checkpoint
   explicitly rather than silently treating a changed head as the expected one.

## Export and restore

Use the verified expected head, including null only for an empty source:

```ts
const archive = await source.exportArchive(expectedHead);
// Save to approved private storage and read it back before restoring.
// Keep archive.digest and expectedHead in separately trusted recovery evidence.
const receipt = await target.restoreArchive(savedArchive, expectedHead, expectedDigest);
const restored = await target.exportArchive(expectedHead);
```

Verify exact canonical equality between the saved and restored archive, including
every payload, original timestamp, sequence, entry digest and comparison digest.
Verify the source is unchanged. Reopen the recovery object and repeat the read.
Record the receipt, source version, archive size, entry count, checkpoint and
digest. Do not put raw history, source account data, credentials or private
payloads in logs, Workflow outputs, issues or PRs. A digest detects corruption;
it is not trustworthy if an attacker can replace both archive and expected digest.

Restore refuses any target with existing entries. Even an identical prior import
is refused: after an uncertain response, read and compare the target before deciding
whether restoration succeeded. Never delete history to make a retry succeed.
The source is never written by either recovery method. A transaction failure
leaves an empty target, with no partial import or consumed sequence.

## Reconcile and retain

Use synthetic fixtures locally to prove Duplicate and Conflict receipts survive,
Corrections replay correctly, and later appends continue the restored hash chain.
Do not create verification Activity Events in a recovered real ledger merely to
test append behavior. Retain private backup and recovery storage. Remove temporary
maintenance bindings and disable any runner after an authorized hosted drill.

The runtime catalog and its history are separate recovery artifacts. Match the
appropriate catalog revision and Event Ledger checkpoint during reconciliation;
restoring one does not restore the other. Collection mappings govern future
events, while historical interpretation remains in the Event Ledger.

This implementation does not supply a recurring backup policy,
destructive failover or production cutover. Those gates remain open until
separately exercised and recorded. Existing append-only triggers and the v1 storage
schema remain unchanged; rollback of code must preserve namespace identities and
all existing history.

## Management-invoked recovery Workflow

The separate `wrangler.recovery.jsonc` entrypoint defaults to disabled and returns
404 for every HTTP request. Deployment supplies SOURCE_LEDGER bound to the source
namespace, SOURCE_LEDGER_NAME, RECOVERY_LEDGER in a separate namespace owned by
the maintenance Worker, and ARCHIVE_BUCKET in private R2 storage. Configure no
public hostname, worker preview, public bucket domain or recurring schedule.

An authenticated administrator invokes LedgerRecoveryWorkflow with
`{drillId, expectedHead, expectedDigest, mode: "restore"}`. Store the expected head
and archive digest independently before invocation. The runner validates and
saves the archive before restoring, reads the backup back, verifies the recovered
history and confirms the source is unchanged. An identical already-restored
target may be acknowledged on retry; other occupied targets are refused.

A second invocation with mode `verify` creates or repairs nothing and must find
the existing backup and matching target. Workflow output contains only head,
digest, count, archive key and outcome. After acceptance set RECOVERY_ENABLED to
false, remove SOURCE_LEDGER and SOURCE_LEDGER_NAME, and verify a new invocation
fails before a step executes. Preserve the private archive and recovery namespace.
Record hosted evidence separately; do not infer it from local tests.
