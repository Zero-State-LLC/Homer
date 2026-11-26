# Trace archive foundation verification

Date: 2026-11-21 PT
Baseline: `b6849a9c44d85bd2c31349d2bf69fd358c4214c1`
Intent: [trace-archive](../intent/trace-archive.md)
Spec: [trace archive](../../specs/trace-archive/spec.md), sections 2, 5, 6, 7 and 10.

## Observed

- `npm run check` passed: build, format, lint, typecheck, 199 tests in
  21 files, and the plain Workers runtime smoke test.
- `bash scripts/check-context-pin.sh` passed.
- `bash scripts/test-check-context-pin.sh` rejected both tampered pin fixtures.
- Markdown lint passed for the new intent and specification files.
- R2 runtime tests use local emulation, not a live account. They verify
  conditional creation, bounded reads, duplicate receipt preservation and
  restore after deleting the synthetic landing object.
- Node tests cover interrupted writes, corrupt objects, scope/path rejection,
  policy rejection, row counts, concurrent retry and expiry classification.

## Limits

The normalized manifest contract currently handles nonempty bounded batches.
It does not parse a native Langfuse manifest, verify upstream inventory, or
prove real capture. The required privacy inspector has only synthetic test
implementations in this change. No source-coverage watermark is advanced.
Archive receipts explicitly retain `sourceCoverage: unknown` and
`ledgerStatus: pending`; they are not Event Ledger receipts.

Cloudflare read-only inspection found Homer's staging recovery backup bucket.
No trace buckets were found. The attempted creation of the two proposed trace
buckets was rejected by automatic approval review as an unapproved persistent
account/cost change. Neither bucket was created. No credentials, Access policies,
catalog mappings, source retention policies or production resources were changed.

No independent software-factory Verdict, remote CI result or merge approval is
claimed by this author-side verification. See the
[remaining release gates](../../specs/trace-archive/implementation.md).
