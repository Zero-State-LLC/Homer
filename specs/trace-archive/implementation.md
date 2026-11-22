# Trace archive implementation status

## Implemented in this change

- Accepted [intent](../../docs/intent/trace-archive.md) and [specification](spec.md).
- Bounded normalized batch verifier, exact file hashes and row-policy callback.
- Scope and path isolation, immutable object creation and readback verification.
- Stable archive receipt on concurrent retry, source-independent restore.
- Entity-expiry classification that reports unknown when expiry is unavailable.
- Workers R2 adapter and local Workers runtime integration tests.

This package is a library, not an enabled Collector. It has no public endpoint,
Cron schedule, credential, deletion operation, or production binding.
The test policy is deliberately synthetic and is never exported as a sanitizer.

## Required before live capture

1. Obtain explicit approval to create `homer-traces-landing-staging` and
   `homer-traces-archive-staging`. Automatic approval review rejected the attempted
   provisioning as an unapproved persistent account/cost change. Neither was created.
2. Configure private buckets, then read back managed/custom domain access,
   lifecycle and lock settings. Keep landing unlocked and prohibit automatic
   deletion until verification-driven cleanup is implemented.
3. Read the actual Langfuse account's export entitlement and source retention.
   No Langfuse connection is available in this session. No access or expiry claim
   can be inferred from the proposed 30-day setting.
4. Implement and fixture-test the native export adapter against the actual
   upstream schema. The internal normalized batch is not a Langfuse manifest.
5. Supply a reviewed schema/privacy inspector, developer-side redaction and
   explicit workspace capture scope. A callback is an enforcement point, not
   evidence that a production privacy policy exists.
6. Add durable scheduling/retries, independent inventory reconciliation and
   expiry alerts. Byte integrity must never set source coverage to complete.
7. Add authenticated restore routes and project authorization. Library callers
   must authorize scope; knowing a digest does not grant permission.
8. Introduce the versioned Activity Event contract and Event Ledger append path.
   These archive receipts say `ledgerStatus: pending`, not appended. Existing
   Event Ledger types and receipts are unchanged.
9. Pass the real-session and archive-only restore acceptance tests before
   activating or shortening any source deletion policy.

## Provisioning change for approval

Create only two empty Standard-class R2 buckets in the Zero State account,
with a western North America location hint, public access disabled, no custom
domains, no deletion lifecycle, no locks and no new credentials. A location hint
does not establish a jurisdiction guarantee. No production resources or existing
recovery backups are changed. Storage and operation costs follow actual usage.

## Context used

`CONTEXT.md`: Authority, Collector, Work Session, Identity Binding, Event Ledger,
Provenance and Duplicate. Context Pin `7d4c26c` supplies the intent template.
Current agent-context was also read; its Homer workflow exception does not grant
deployment or spend approval. The current main baseline was `b6849a9`.
