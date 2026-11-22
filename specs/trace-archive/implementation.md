# Trace archive implementation status

## Implemented in this change

- Accepted [intent](../../docs/intent/trace-archive.md) and [specification](spec.md).
- Bounded normalized batch verifier, exact file hashes and row-policy callback.
- Scope and path isolation, immutable object creation and readback verification.
- Stable archive receipt on concurrent retry, source-independent restore.
- Entity-expiry classification that reports unknown when expiry is unavailable.
- Workers R2 adapter and local Workers runtime integration tests.
- Approved private staging landing and archive buckets created and verified.

This package is a library, not an enabled Collector. It has no public endpoint,
Cron schedule, credential, deletion operation, or production binding.
The test policy is deliberately synthetic and is never exported as a sanitizer.

## Required before live capture

1. Read the actual Langfuse account's export entitlement and source retention.
   No Langfuse connection has been verified. No access or expiry claim can be
   inferred from the proposed 30-day setting.
2. Implement and fixture-test the native export adapter against the actual
   upstream schema. The internal normalized batch is not a Langfuse manifest.
3. Supply a reviewed schema/privacy inspector, developer-side redaction and
   explicit workspace capture scope. A callback is an enforcement point, not
   evidence that a production privacy policy exists.
4. Add durable scheduling/retries, independent inventory reconciliation and
   expiry alerts. Byte integrity must never set source coverage to complete.
5. Add authenticated restore routes and project authorization. Library callers
   must authorize scope; knowing a digest does not grant permission.
6. Introduce the versioned Activity Event contract and Event Ledger append path.
   These archive receipts say `ledgerStatus: pending`, not appended. Existing
   Event Ledger types and receipts are unchanged.
7. Pass the real-session and archive-only restore acceptance tests before
   activating or shortening any source deletion policy.

## Provisioned staging storage

Daniel explicitly approved `homer-traces-landing-staging` and
`homer-traces-archive-staging`. Both were created November 21, 2026 PT in the
Zero State account, Standard class, WNAM placement, default jurisdiction.
Readback confirmed public access disabled, no custom domains, no bucket locks
and no completed-object deletion lifecycle. Default cleanup of unfinished
multipart uploads after seven days remains enabled. No credentials or production
resources were changed. No traces have been uploaded by this work.

See the [provisioning receipt](../../docs/receipts/trace-r2-provisioning-2026-11-21.md).
The earlier automatic approval rejection is resolved for these two buckets only.

## Context used

`CONTEXT.md`: Authority, Collector, Work Session, Identity Binding, Event Ledger,
Provenance and Duplicate. Context Pin `7d4c26c` supplies the intent template.
Current agent-context was also read; its Homer workflow exception does not grant
deployment or spend approval. The implementation baseline was `b6849a9`.
