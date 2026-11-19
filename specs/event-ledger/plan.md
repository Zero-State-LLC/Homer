# Event Ledger implementation plan

Status — Proposed by FORGE (PROMETHEUS) on 2026-11-18 PT. Needs Danny's yes before any implementation starts.

- Specification — [Event Ledger spec](spec.md) (accepted 2026-11-19)
- Planning handoff — [handoff.md](handoff.md)
- Task — [ZER-9](https://linear.app/zer0state/issue/ZER-9/implement-control-room-activity-calendar-and-project-timelines)
- Work Packets — [work-packets/](work-packets/), one JSON file per implementation slice

This plan answers the [decisions for FORGE](handoff.md#decisions-for-forge). It adds no code. Terms follow [CONTEXT.md](../../CONTEXT.md).

## Decisions

### Storage backend: SQLite through `node:sqlite`

One SQLite database file holds one Event Ledger. The package talks to it through `DatabaseSync` from `node:sqlite`, which ships inside Node. The package adds no native dependency.

Evidence:

- The `node:sqlite` history in the Node 22 docs says the module left the `--experimental-sqlite` flag in v22.13.0 and is Stability 1.1, active development. The Node 24 docs say it became Stability 1.2, release candidate, in v24.15.0.
- A box probe on Node v22.23.5 with SQLite 3.54.1 ran three OS processes appending 200 Activity Events each over 150 Event Keys with `BEGIN IMMEDIATE`. The result had 150 entries, sequences 1 to 150, no gaps and no duplicate Event Keys.
- The same probe showed a writer that switched `journal_mode=WAL` before it set a busy timeout failed with `database is locked` (SQLite error code 5) under contention.
- `node:sqlite` still prints an `ExperimentalWarning` on Node v22.23.5.
- A floor probe on Node v22.13.0 (bundled SQLite 3.47.2) ran without a flag: `PRAGMA busy_timeout=5000` read back as 5000, WAL and `synchronous=FULL` took effect, a `STRICT` table accepted an append inside `BEGIN IMMEDIATE`, and an `UPDATE` trigger aborted with `append-only`. It also printed the `ExperimentalWarning`.

Why this backend, with its experimental status weighed:

- The on-disk format and the transaction, locking and durability behavior come from SQLite, which is stable. What is experimental is the JavaScript binding. The package uses a small part of it: `new DatabaseSync(path, options)`, `exec`, `prepare`, `run`, `get`, `all` and `close`.
- The alternatives cost more. `better-sqlite3` is a native addon that adds a compile or prebuilt-binary step to every fresh checkout and to `npm audit`. An append-only file needs a cross-process lock that Node does not provide, so the package would have to build its own.
- The binding risk is contained. Every SQLite call lives in one module, `src/sqlite-store.ts`. CI runs the full suite on the floor version, the current Node 22 and Node 24, so a binding change fails CI instead of production.
- Exit path: if a supported Node line breaks the binding, replace `src/sqlite-store.ts` with `better-sqlite3`. The SQL, the schema and the tests stay the same.
- Do not hide the `ExperimentalWarning`. It is honest output from the runtime.

### Supported runtime and filesystem

- Node v22.13.0 or later. The Event Ledger package declares `"engines": { "node": ">=22.13.0" }`, and the root `package.json` floor moves from `>=22` to `>=22.13.0`, because `node:sqlite` needs no flag only from that version.
- One host, many processes. The database file must sit on a local filesystem with working POSIX advisory locks, such as ext4 or APFS. Network filesystems (NFS, SMB) are unsupported because SQLite locking is unreliable on them.
- CI is Linux on GitHub-hosted runners. macOS is supported but not CI-proven in the first delivery.

### Connection settings, in this order

1. Run `PRAGMA busy_timeout=5000` as the first statement after open, before any other pragma. This is the fix for the probe's `database is locked` failure. Do not use the `DatabaseSync` `timeout` option: the Node 22 docs say it was added in v22.16.0, above the floor.
2. `PRAGMA journal_mode=WAL` (persistent once set on the file).
3. `PRAGMA synchronous=FULL`, so a returned receipt survives power loss.
4. `PRAGMA foreign_keys=ON`.

### Schema

```sql
CREATE TABLE ledger_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;                     -- row: ('formatVersion', '1')

CREATE TABLE entries (
  sequence          INTEGER PRIMARY KEY CHECK (sequence >= 1),
  entry_type        TEXT NOT NULL CHECK (entry_type IN ('activity_event', 'correction')),
  event_key         TEXT,     -- Activity Event: its Event Key. Correction: NULL.
  correction_id     TEXT,     -- Correction: its identifier. Activity Event: NULL.
  target_event_key  TEXT,     -- Correction: the original Event Key it targets.
  comparison_digest TEXT NOT NULL,  -- SHA-256 of the canonical content minus collection fields
  previous_digest   TEXT,     -- NULL only for sequence 1
  entry_digest      TEXT NOT NULL,
  entry_json        TEXT NOT NULL,  -- the RFC 8785 bytes that entry_digest covers
  UNIQUE (event_key),
  UNIQUE (correction_id)
) STRICT;

CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries
  BEGIN SELECT RAISE(ABORT, 'Event Ledger is append-only'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries
  BEGIN SELECT RAISE(ABORT, 'Event Ledger is append-only'); END;
```

The triggers stop accidental edits through the package. They are not tamper protection; `verifyHistory` and a trusted head are.

### Entry format v1

A committed entry is this JSON object. `entryDigest` is stored beside it, never inside it.

```json
{
  "formatVersion": 1,
  "sequence": 1,
  "entryType": "activity_event",
  "previousDigest": null,
  "payload": {}
}
```

- `payload` is the full accepted Activity Event or Correction, including the collection fields.
- `entryDigest` is lowercase hex SHA-256 over the UTF-8 bytes of the RFC 8785 canonical JSON of that object.
- `comparisonDigest` is lowercase hex SHA-256 over the RFC 8785 canonical JSON of the payload with only the excluded collection fields removed (see below). It speeds up Duplicate checks. `verifyHistory` recomputes it too.

### One append transaction

`appendActivityEvent` and `appendCorrection` both run these steps. Steps 1 to 3 touch no storage.

1. Validate. Activity Events go through `validateActivityEvent` from `@zs-home/shared-contracts`. The ledger then adds the rules the shared validator cannot hold: the second Event Key segment equals `kind`, and the input lies inside the RFC 8785 JSON domain (no `undefined`, functions, `BigInt`, non-finite numbers, lone surrogates or non-plain objects). Invalid input returns `Refused` and opens no transaction.
2. Snapshot. Deep-copy the validated input through canonical JSON so later caller mutation cannot reach the stored entry.
3. Compute the comparison digest.
4. `BEGIN IMMEDIATE`. This takes SQLite's single write lock, so one writer at a time runs steps 5 to 9.
5. Look up the Event Key (Activity Event) or Correction identifier (Correction).
6. If a row exists with the same comparison digest, `ROLLBACK` and return `Duplicate` with the stored receipt. If it exists with a different digest, `ROLLBACK` and return `Conflict`.
7. For a Correction, check the target: it must be a stored Activity Event, and a Supersede replacement must keep the target's Event Key, Kind, Source System and source object ID. Otherwise `ROLLBACK` and return `Refused`.
8. Read the head (highest sequence and its digest). Build the entry with `sequence = head + 1` and `previousDigest = head digest`, or sequence 1 and `null`. Compute `entryDigest`. Insert.
9. `COMMIT`. Return `Appended` with the receipt.

`PRIMARY KEY (sequence)` and the two `UNIQUE` constraints are backstops. If one fires, the transaction rolls back and the caller gets an error, never a partial entry.

What a caller can observe:

| Situation | Caller sees | Ledger state |
| --- | --- | --- |
| Commit succeeded | `Appended` with sequence and entry digest | Entry visible to every later read |
| Refused, Duplicate or Conflict | That outcome | Unchanged |
| Failure before `COMMIT` returns (SQLite error, busy timeout, storage error) | A thrown `EventLedgerStorageError`, no receipt | Unchanged; SQLite rolls back |
| Process dies or the call throws after `COMMIT` reached disk (uncertain commit) | No receipt | Entry committed. Retrying the same input returns `Duplicate` with the original receipt |
| Process dies before `COMMIT` reaches disk | No receipt | Unchanged after reopen; the WAL discards the open transaction |
| Reopen after any of the above | Same committed entries and digest chain | Duplicate and Conflict outcomes still hold |

### Canonicalization: `canonicalize` 5.1.0

- Use the npm package [`canonicalize`](https://github.com/erdtman/canonicalize), pinned to exactly `5.1.0` (Apache-2.0, no dependencies), the JCS implementation by an RFC 8785 author.
- Prove it against independent fixtures: the RFC 8785 test vectors (input and expected canonical output), and synthetic ledger entries whose expected digests come from a second implementation run outside the package (Python `rfc8785` plus `hashlib.sha256`). Commit the expected values as fixture files; tests never regenerate them.
- Reject input outside the RFC 8785 JSON domain in step 1, before persistence.

### Duplicate comparison

Strip only `provenance.collectedAt`, `provenance.collector` and `provenance.collectorVersion` before computing the comparison digest. For a Correction, strip the same three fields from the Correction's own Provenance and, for a Supersede, from the replacement's Provenance. Everything else counts, including array order and whether an optional field is present. The stored entry keeps the first accepted payload in full.

## Interfaces

All exports come from `packages/event-ledger/src/index.ts` as `@zs-home/event-ledger`. Types reuse `ActivityEvent` and `Provenance` from `@zs-home/shared-contracts`.

```ts
export function openEventLedger(path: string): EventLedger;

export interface EventLedger {
  appendActivityEvent(input: unknown): AppendOutcome;
  appendCorrection(input: unknown): AppendOutcome;
  readHistory(options?: { throughSequence?: number }): LedgerEntry[];
  head(): TrustedHead | null;
  close(): void;
}

export type AppendOutcome =
  | { outcome: "appended"; receipt: Receipt }
  | { outcome: "duplicate"; receipt: Receipt }
  | { outcome: "conflict"; identifier: string }
  | { outcome: "refused"; errors: string[] };

export interface Receipt { sequence: number; entryDigest: string }
export interface TrustedHead { sequence: number; entryDigest: string }

export interface Correction {
  contract: "home.correction/v1";
  correctionId: string;          // stable, supplied by a trusted writer
  targetEventKey: string;        // always the original Event Key
  action: "supersede" | "retract";
  reason: string;                // non-blank
  provenance: Provenance;        // same shape as Activity Event Provenance; sourceUrl points to the evidence
  replacement?: ActivityEvent;   // required for supersede, absent for retract
}

export interface LedgerEntry {
  formatVersion: 1;
  sequence: number;
  entryType: "activity_event" | "correction";
  previousDigest: string | null;
  payload: ActivityEvent | Correction;
  entryDigest: string;
}

export function verifyHistory(
  entries: readonly LedgerEntry[],
  trustedHead?: TrustedHead,
): { ok: true } | { ok: false; failure: IntegrityFailure };

export interface IntegrityFailure {
  sequence: number | null;       // null when the trusted head itself fails
  reason:
    | "sequence_gap"
    | "unsupported_format"
    | "previous_digest_mismatch"
    | "entry_digest_mismatch"
    | "comparison_digest_mismatch"
    | "trusted_head_mismatch";
}

export function replayEffectiveHistory(entries: readonly LedgerEntry[]): ActivityEvent[];
// Calls verifyHistory first and throws EventLedgerIntegrityError instead of replaying a failed history.
```

- `readHistory` runs inside one read transaction, so it returns a consistent prefix even while writers append.
- `replayEffectiveHistory` walks entries in ledger sequence and applies Corrections to their target Event Key in that order: Supersede swaps in the replacement (and restores a retracted event), Retract omits it. It sorts nothing by `occurredAt`. A Projection does that for display.
- The Correction shape stays internal to the package in the first delivery. It moves into `specs/integration-contracts/` as a versioned contract when a Projection outside this package first reads it.

### Where trust is checked

- Identity Binding: the Collector applies Identity Bindings before it calls the ledger, because only the Collector holds the reviewed binding config. The ledger stores `actor` as given, and the shared validator already refuses `actorKind` without `actorId`. The ledger cannot prove a binding from a shape, so it does not claim to.
- Correction evidence: `appendCorrection` refuses a Correction with a blank reason, invalid Provenance (which already requires an https `sourceUrl`), an unknown or non-Activity-Event target, or a Supersede that changes source identity. Whether the evidence behind that `sourceUrl` comes from the right Authority, or shows a reviewed Identity Binding for an Attribution change, stays the trusted writer's job, as the spec says. A shape check cannot prove it, so the ledger does not claim to.
- Scope: `openEventLedger` is for trusted internal consumers only. There is no API in the first delivery.

## Acceptance scenarios to tests

Every test uses synthetic fixtures only. Race and crash tests start independent writer processes with `child_process.fork` against one temporary database file.

| Spec scenario | Test | Slice |
| --- | --- | --- |
| A valid Activity Event arrives and the caller later mutates its input. | Append, mutate the input object, `readHistory` returns the committed payload, sequence and digest. | ZER-18 |
| The Collector retries with reordered JSON object fields or different collection bookkeeping. | Second append with reordered keys and new `collectedAt`, `collector`, `collectorVersion` returns `duplicate` with the first receipt. One entry exists and keeps the first Provenance. | ZER-18 |
| The same Event Key arrives concurrently with two different valid subjects. | 8 writer processes race the same Event Key with distinct subjects. Exactly one `appended`, the rest `conflict`, one entry for the key. Repeat 20 rounds. | ZER-20 |
| Distinct appends race, or storage fails midway through an append. | (a) 4 processes × 200 distinct appends give sequences 1..800 with a valid chain. (b) A test-installed SQLite trigger raises `ABORT` on insert; the append throws, head is unchanged, and after the trigger is dropped the same append gets the next sequence. (c) A child is killed with `SIGKILL` in a tight append loop; after reopen, `verifyHistory` passes. (d) A child commits and exits without reporting; the parent's retry returns `duplicate` with the committed receipt. | ZER-20 |
| A Collector omits Provenance, supplies an offset timestamp, or uses the wrong Kind segment. | Each input returns `refused`; `head()` is unchanged. | ZER-18 |
| A Collector has no Identity Binding. | Append with only `actor.sourceAccount`; the stored payload keeps the raw account and has no `actorId` or `actorKind`. | ZER-18 |
| An authorized writer supersedes, retracts, and then restores one event. | Append event, Supersede, Retract, Supersede (restore). `replayEffectiveHistory` of each prefix gives the expected effective history; `readHistory` keeps all four entries. | ZER-21 |
| A Correction targets an unknown Event Key, changes source identity, or reuses an identifier with changed content. | Each returns `refused` or `conflict`; `head()` is unchanged. | ZER-21 |
| An Activity Event with an earlier `occurredAt` is appended after another. | Sequences follow append order; both `occurredAt` values come back byte-for-byte, including fractional seconds. | ZER-18 |
| A stored payload, sequence, or link is corrupted, or a trusted head no longer matches. | Drop the append-only triggers in a raw connection, then edit `entry_json`, `sequence` or `previous_digest`, or delete the last row. `verifyHistory` returns the matching `IntegrityFailure`; a truncated tail fails only with the trusted head; `replayEffectiveHistory` throws. | ZER-20 |
| The ledger is reopened after successful appends. | Close and reopen; same entries and chain; a repeat append returns `duplicate`, a changed one `conflict`. | ZER-19 |

## Tasks

Each Task is one slice and one Work Packet. Slices land in order; each keeps `npm run check` green.

| Slice | Task | Depends on |
| --- | --- | --- |
| 1. Package and runtime floor | [ZER-16](https://linear.app/zer0state/issue/ZER-16/event-ledger-16-package-and-runtime-floor) | — |
| 2. Entry format, canonical JSON, digest chain, `verifyHistory` | [ZER-17](https://linear.app/zer0state/issue/ZER-17/event-ledger-26-entry-format-canonical-json-digest-chain-verifyhistory) | 1 |
| 3. Append validation and Duplicate or Conflict classification | [ZER-18](https://linear.app/zer0state/issue/ZER-18/event-ledger-36-append-validation-and-duplicate-or-conflict) | 2 |
| 4. SQLite storage, append transaction, reopen | [ZER-19](https://linear.app/zer0state/issue/ZER-19/event-ledger-46-sqlite-storage-append-transaction-reopen) | 3 |
| 5. Independent writers, failed and uncertain commits, corruption | [ZER-20](https://linear.app/zer0state/issue/ZER-20/event-ledger-56-independent-writers-failed-and-uncertain-commits) | 4 |
| 6. Corrections and `replayEffectiveHistory` | [ZER-21](https://linear.app/zer0state/issue/ZER-21/event-ledger-66-corrections-and-replayeffectivehistory) | 4 |

Done-when items for each slice are in the [Work Packets](work-packets/), each of which validates against the pinned [software-factory Work Packet schema](../integration-contracts/upstream/software-factory/work_packet.schema.json).

## Fresh-checkout command

```sh
git clone https://github.com/Zero-State-LLC/home.git && cd home
npm ci --no-audit --no-fund
npm run check
```

`npm run check` already runs format, lint, typecheck, tests and build. The Event Ledger tests join it through the existing `vitest.config.ts` include pattern. No new command.

## CI change (slice 1)

Add a Node matrix to the `check` job in [ci.yml](../../.github/workflows/ci.yml): `22.13.0` (floor), `22` and `24`. Keep `audit` on Node 22. No other workflow changes.

## Out of scope

Live Collectors, Identity Binding config, Projections, the Activity Calendar and Project Timeline, Source Freshness budgets, any HOME API or MCP, Scope enforcement, and the Control Room migration. These stay with later ZER-9 work.

## Workflows

### Skills

| Skill | Owner | Used for |
| --- | --- | --- |
| `anti-slop-code` | Implementer | Every slice |
| `production-systems` | Implementer, reviewed by FORGE | Slices 4 and 5 |
| `google-developer-style` | Implementer | README and plan updates |
| `zero-state-context` (agent-context, pinned) | Implementer | Team context before starting |

### GitHub Actions

| Workflow | Path | Use |
| --- | --- | --- |
| CI | [ci.yml](../../.github/workflows/ci.yml) | Runs the Event Ledger tests in `npm run check`; slice 1 adds the Node matrix |
| Docs | [docs.yml](../../.github/workflows/docs.yml) | Lints this plan and checks its links |
| Secret scan | [secret-scan.yml](../../.github/workflows/secret-scan.yml) | Scans fixtures and commits |

## Open questions for Danny

1. Accept `node:sqlite` with the Node v22.13.0 floor, or require `better-sqlite3` now despite the native dependency?
2. The Work Packet budgets are proposals (5 USD per slice). Confirm or set them.
