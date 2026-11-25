# Event Ledger planning handoff

Danny accepted the Event Ledger specification on 2026-11-19 UTC (2026-11-18 PT). FORGE owns the implementation plan and Tasks for the first delivery in [ZER-9](https://linear.app/zer0state/issue/ZER-9).

## Inputs

- The [Event Ledger spec](spec.md) defines the append, replay, and integrity guarantees. Its [acceptance scenarios](spec.md#acceptance-scenarios) are the baseline for implementation evidence.
- The [integration contracts](../integration-contracts/README.md) and `@zs-home/shared-contracts` already provide Activity Event validation. The ledger adds the rules for Event Key consistency, equality, and storage described in the spec.
- Keep the implementation under `packages/event-ledger` and its workspace configuration. The first delivery is a package that can run with synthetic fixtures and without access to live Source Systems.

## Decisions for FORGE

- Select the storage backend and supported runtime and filesystem. Specify how one transaction assigns the sequence, checks uniqueness, and commits the entry. Document what a caller can observe after a failed or uncertain commit and after reopening.
- Define the package interfaces for appending Activity Events and Corrections, reading a consistent history, and verifying that history with an optional trusted head. Identify where Identity Binding and Correction evidence are checked before reaching the storage boundary.
- Choose the RFC 8785 implementation and pin independent canonicalization and digest fixtures. Include payloads that differ only in collection bookkeeping and prove that they return the original receipt while preserving the original Provenance.
- Plan tests against the chosen backend using independent writers. Cover a same-key race, conflicting content, failed commits, reopening, and corruption. Include a fresh-checkout command alongside evidence from the existing workspace checks.

## Runtime evidence

The Homer workspace supports Node 22 and later. A local probe on Node `v22.23.5` loaded `node:sqlite` and queried SQLite `3.54.1` in memory. This establishes availability on that Node version. Disk durability, concurrency, and compatibility with the minimum runtime need their own evidence if FORGE selects SQLite.
