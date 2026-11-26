# Trace export Collector verification

Date: November 21, 2026 PT.
Baseline: PR #30 at `86696c6fd917ee482707ea530fa702e52da4430b`.

Implemented the [pinned native export adapter](../../specs/trace-archive/langfuse-export.md)
and scheduled processing composition. The adapter accepts enriched uncompressed
JSONL and refuses unsupported formats, scope mismatches, row-count drift and
changing completion manifests. Discovery uses a dedicated D1 attempt journal
and compare-and-swap cursor updates; cursor progress is not source coverage.

## Verification

- `npm run check` passed: build, format, lint, typecheck, 218 tests in 22 files,
  and plain Workers runtime smoke tests.
- Markdown lint passed for the updated specification files.
- Local Workers tests exercised R2 discovery plus the actual D1 migration,
  repeated scheduled collection with the original receipt preserved, cursor
  race rejection, disabled-by-default processing and no HTTP route.
- Node tests cover native format/version rejection, empty exports, zero-byte
  files, source-row isolation, changing manifests, failed-journal recovery and
  checkpoint conflicts.

## Limitations

All new runtime evidence uses synthetic fixtures and local emulation. No live
trace export or actual Langfuse retention setting has been read. Tool discovery
found no Langfuse connector; browser inventory had no existing tabs/session to
inspect. The authenticated project URL/access remains required.

No new live resources, credentials, source retention changes, catalog edits,
Access changes or production changes were made. The previously approved two R2
buckets remain the only provisioned trace resources. No Worker or D1 database
was deployed. Runtime source/policy loading and production privacy inspection
remain mandatory before enablement. Event Ledger integration, source inventory,
expiry alerts and real-session acceptance are still release gates.

An independent factory Verdict and remote CI success are not claimed here.
