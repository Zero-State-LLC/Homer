# Event Ledger implementation plan

Status: revised by FORGE (PROMETHEUS) on 2026-11-18 PT. Grok Build re-authored it for PR #9. Danny approved the SQLite-backed Durable Object backend on 2026-11-18 at 7:19 PM PT. Implementation starts only after Danny's yes on the remaining open questions.

- Specification: [Event Ledger spec](spec.md) (accepted 2026-11-19)
- Planning handoff: [handoff.md](handoff.md)
- Task: [ZER-9](https://linear.app/zer0state/issue/ZER-9/implement-control-room-activity-calendar-and-project-timelines)
- Work Packets: [work-packets/](work-packets/), one JSON file for each slice

This plan answers the [decisions for FORGE](handoff.md#decisions-for-forge). It adds no code. Terms follow [CONTEXT.md](../../CONTEXT.md).

On 2026-11-18 at 5:14 PM PT, Danny asked, relayed by Boof, for Cloudflare D1 or Durable Objects as Event Ledger storage. That request replaces the earlier `node:sqlite` choice. This revision compares the two, selects one, and restates the runtime, the public interfaces, the tests, and the slices.

The selected design is one SQLite-backed Durable Object, addressed with `idFromName("event-ledger")`. Canonical JSON comes from `canonicalize` 5.1.0. Trusted internal callers use `openEventLedger`, `appendActivityEvent`, `appendCorrection`, `readHistory`, `head`, `verifyHistory`, and `replayEffectiveHistory`.

## Storage backend

Use one [SQLite-backed Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) of class `EventLedgerObject`. Resolve it with `idFromName("event-ledger")`. Run every storage statement inside that object through `ctx.storage.sql.exec`. Run every append inside one `ctx.storage.transactionSync` callback.

The package opens no host file and takes no filesystem path. Durability belongs to the object's SQLite storage. The platform owns journaling. Local tests keep that storage inside `workerd`.

### D1 and a Durable Object against the acceptance scenarios

| Acceptance scenario | D1 | SQLite-backed Durable Object |
| --- | --- | --- |
| Concurrent writes: distinct appends race, or one Event Key races with different content | D1 has no interactive transaction. `BEGIN` is refused. Only `batch()` runs a fixed list of statements as one unit. The digest chain needs JavaScript between the head read and the insert, because the new entry's SHA-256 covers the previous digest. Two Worker invocations can read the same head. A correct result needs an extra protocol: optimistic retry on the `sequence` primary key, and classification again after every lost race. | One object runs one `transactionSync` callback at a time. Event Key lookup, the Duplicate or Conflict decision, the Correction target check, the head read, the digest, and the insert all happen inside that synchronous callback. No other request interleaves. The object's lock fills the role `BEGIN IMMEDIATE` had in the earlier design. |
| Failed commits: storage fails midway, or a caller repeats an append after an uncertain commit | A failing statement rolls back the whole batch. A repeated append classifies again. That is safe because the Event Key is `UNIQUE`. | An exception inside `transactionSync` rolls the transaction back. If the write fails after the callback returns, the platform discards the held reply and restarts the object. The caller gets no receipt for an entry that did not persist. Repeating an append of input that did commit returns `duplicate` with the original receipt. |
| Reopening | The D1 database outlives any Worker. A later read is an ordinary query. | Storage outlives the object instance. Eviction or restart loads the same rows. The constructor runs `CREATE ... IF NOT EXISTS` and does no other migration work. |
| Corruption | The SQL and `verifyHistory` match the Durable Object path. D1 Time Travel restores a database to any minute in the last 30 days. | The SQL and `verifyHistory` match the D1 path. Point-in-time recovery restores the object's database to any point in the last 30 days. Local development does not provide that recovery. |

### Documentation read on 2026-11-18

- [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): `transactionSync(callback)` rolls back when the callback throws, and the callback must be synchronous. `sql.exec()` cannot run `BEGIN TRANSACTION` or `SAVEPOINT`. Point-in-time recovery covers the past 30 days and is unavailable locally.
- [Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/), output gates: while a write is in progress, the platform holds outgoing messages. If the write fails, it discards those messages, replaces them with errors, and restarts the object.
- [D1 `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/): batched statements are one SQL transaction, and a failing statement rolls the sequence back. Outside `batch()`, D1 runs in auto-commit. The [D1 import guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/) tells users to remove `BEGIN TRANSACTION` and `COMMIT` from dumps.
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/): 10 GB of storage per object (1 GB on the Free plan), a soft limit of 1,000 requests per second per object, 30 seconds of CPU per request by default, 8 MB per row, and 100 bound parameters per query.

### Local probe on 2026-11-18

The probe used `@cloudflare/vitest-plugin` 1.8.5, Vitest 5.1.1, `workerd` 1.20261118.1, and compatibility date `2026-11-18`. Fixtures were synthetic.

- A `STRICT` table with `UNIQUE (event_key)` refused a text `sequence`. `BEFORE UPDATE` and `BEFORE DELETE` triggers that call `RAISE(ABORT, ...)` refused edits.
- `sql.exec("BEGIN IMMEDIATE")` and `sql.exec("SAVEPOINT a")` threw: "To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs". The local D1 binding refused `BEGIN IMMEDIATE` with the same message.
- 300 concurrent appends through one stub produced sequences 1 through 300 and an unbroken `previous_digest` chain.
- 20 rounds of 8 concurrent appends of one Event Key with different subjects each produced exactly one `appended` and seven `conflict`. 4 identical concurrent appends produced one `appended` and three `duplicate`.
- A test-installed `BEFORE INSERT` trigger made the append throw `SQLITE_CONSTRAINT_TRIGGER`. The head stayed unchanged. After the trigger was dropped, the same append received sequence 2. A throw after an insert inside `transactionSync` left the row count unchanged.
- After `evictDurableObject` and `abortAllDurableObjects`, the entries were still present. A repeated append returned `duplicate` with the first receipt. A changed append returned `conflict`.
- `createHash("sha256")` from `node:crypto` ran inside `transactionSync`.
- `transactionSync` accepted an `async` callback and did not throw. The awaited part runs after the transaction ends. Pass only a synchronous callback.

### Why this backend

The spec requires uniqueness, sequence assignment, and the append to be one atomic operation. A Durable Object provides that directly. D1 needs an optimistic-retry protocol on top. That protocol is more code to get wrong and more tests to prove.

Both options store SQLite, so the schema, the entry format, and the core stay the same either way. Only `src/ledger-object.ts` would change on an exit.

Exit path: the schema is ordinary SQLite. The core (canonical JSON, digests, classification, `verifyHistory`, and `replayEffectiveHistory`) contains no storage code. Rows returned by `readHistory` load into any other SQLite engine, and `verifyHistory` proves the copy.

### Costs of one object

- One object serializes every append. The soft limit is about 1,000 requests per second for the whole Event Ledger. Homer's Collectors are far below that today. This plan does not measure that rate.
- Point-in-time recovery cannot be tested locally.
- Errors thrown inside the object reach the caller as RPC errors. The client wraps them. See [Interfaces](#interfaces).

## Runtime

Run the ledger in the Workers runtime. `packages/event-ledger/wrangler.jsonc` declares:

- The `EVENT_LEDGER` Durable Object binding.
- A `new_sqlite_classes` migration for `EventLedgerObject`.
- Compatibility date `2026-11-18`.
- `compatibility_flags: ["nodejs_compat"]`.

The file contains no `account_id`, no routes, and no deploy script.

For compatibility dates of 2026-08-04 or later, [Node.js compatibility is on by default](https://developers.cloudflare.com/workers/configuration/compatibility-flags/). At `2026-11-18` the flag repeats that default. Keep the flag so the config states the dependency on [`node:crypto`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

Hashing inside `transactionSync` has to be synchronous. Use `createHash("sha256")` from `node:crypto`. Web Crypto's `crypto.subtle.digest` returns a Promise, so it cannot run inside the callback.

Publish no `fetch` handler. Callers reach the object through Workers RPC on the binding. The spec defines no authentication surface, so a route would be an unauthenticated write path. [Open questions for Danny](#open-questions-for-danny) records that gap.

Development and tests require Node 22.12.0 or later. `wrangler` 4.165.0, `@cloudflare/vitest-plugin` 1.8.5, and the repository's Vitest 5.1.1 declare that floor. Move the root `engines` field from `>=22` to `>=22.12.0` to match.

## Validation in the Workers runtime

The [Workers runtime refuses `eval()` and `new Function`](https://developers.cloudflare.com/workers/runtime-apis/web-standards/). The current validator in `@zs-home/shared-contracts` reads schema files with `node:fs` and compiles them with Ajv when it runs. That compile generates code from strings.

Probe results:

- Inside the Vitest integration, a runtime Ajv compile and `new Function` both succeeded. `readFileSync` of a repository schema failed with "no such file or directory".
- A plain `wrangler dev` session on local `workerd` refused `new Function` with "Code generation from strings disallowed for this context".

The Vitest pool is more permissive than the deployed runtime, so a pool test cannot catch this. The plan is:

- ZER-18 adds a Workers-safe export to `@zs-home/shared-contracts`. The export uses a standalone Ajv validator generated at build time from `activity-event.v1.schema.json`. It uses no `node:fs` and compiles nothing at runtime.
- A Node test shows that the generated validator accepts and refuses the same fixtures as the existing validator.
- A local smoke test runs the built Worker under `wrangler dev` (no login, no deploy) and appends one synthetic Activity Event.

This change touches the shared package, so it is an open question.

## Schema

The schema is unchanged from the previous revision. `PRAGMA` settings are gone, because the platform owns journaling and durability.

```sql
CREATE TABLE IF NOT EXISTS ledger_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;                     -- row: ('formatVersion', '1')

CREATE TABLE IF NOT EXISTS entries (
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

CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON entries
  BEGIN SELECT RAISE(ABORT, 'Event Ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON entries
  BEGIN SELECT RAISE(ABORT, 'Event Ledger is append-only'); END;
```

The constructor applies this schema inside `ctx.blockConcurrencyWhile`. The triggers stop accidental edits made through the package. They are not tamper protection. `verifyHistory` and a trusted head provide that check.

## Entry format

A committed entry is the JSON object below. Store `entryDigest` beside the object. Leave it out of the object.

```json
{
  "formatVersion": 1,
  "sequence": 1,
  "entryType": "activity_event",
  "previousDigest": null,
  "payload": {}
}
```

- `entryType` is `activity_event` or `correction`. The example shows an Activity Event.
- `payload` is the full accepted Activity Event or Correction, including the collection fields.
- `entryDigest` is lowercase hex SHA-256 over the UTF-8 bytes of the RFC 8785 canonical JSON of that object.
- `comparisonDigest` is lowercase hex SHA-256 over the RFC 8785 canonical JSON of the payload after the excluded collection fields are removed. See [Duplicate comparison](#duplicate-comparison). It makes Duplicate checks a digest compare. `readHistory` returns this stored value on every `LedgerEntry`. `verifyHistory` recomputes it and compares. Neither digest field is part of the canonical entry body above.
- The first entry uses a null previous digest. Later entries store the previous entry's digest. Sequence numbers are contiguous and start at 1.

## Append transaction

`appendActivityEvent` and `appendCorrection` run inside the object. Steps 1 to 3 touch no storage.

1. Validate. Send Activity Events through the Workers-safe Activity Event validator from `@zs-home/shared-contracts`. Then apply the rules that validator cannot hold: the second Event Key segment equals `kind`, and the input lies inside the RFC 8785 JSON domain (no `undefined`, `BigInt`, non-finite number, lone surrogate, or non-plain object). Invalid input returns `refused` and opens no transaction.
2. Snapshot. Deep-copy the validated input through canonical JSON.
3. Compute the comparison digest.
4. Enter `ctx.storage.transactionSync(() => { ... })`. The callback is synchronous and calls nothing that returns a Promise.
5. Look up the Event Key for an Activity Event, or the Correction identifier for a Correction.
6. When a row exists with the same comparison digest, return `duplicate` and the stored receipt. When it exists with a different digest, return `conflict`. Write nothing in either case.
7. For a Correction, check the target. It must be a stored Activity Event. A Supersede replacement must keep the target's Event Key, Kind, Source System, and source object ID. Otherwise return `refused`.
8. Read the head (the highest sequence and its digest). Build the entry with `sequence = head + 1` and `previousDigest` set to the head digest. For an empty ledger, use sequence 1 and `previousDigest` null. Compute `entryDigest` with `node:crypto`. Insert the row.
9. Return `appended` and the receipt. The transaction commits when the callback returns.

`PRIMARY KEY (sequence)` and the two `UNIQUE` constraints are backstops. When one fires, the callback throws, the transaction rolls back, and the caller gets an error. No partial entry becomes visible.

### What the caller can observe

| Situation | Caller sees | Ledger state |
| --- | --- | --- |
| Commit succeeded | `appended` with sequence and entry digest | The entry is visible to every later read |
| Refused, Duplicate, or Conflict | That outcome | Unchanged |
| Exception inside the transaction (constraint or storage error) | A thrown `EventLedgerStorageError`, and no receipt | Unchanged; the transaction rolled back |
| The write fails after the callback returns | An error. The output gate discards the receipt and the object restarts | Unchanged |
| The reply is lost after the write persisted (network failure or caller crash) | No receipt | The entry is committed. Repeating the same input returns `duplicate` with the original receipt |
| The object is evicted or restarted after any of the above | The same committed entries and digest chain | Duplicate and Conflict outcomes still hold |

## Canonical JSON

Use the npm package [`canonicalize`](https://github.com/erdtman/canonicalize), pinned to exactly `5.1.0` (Apache-2.0, no dependencies). It is the JCS implementation by an author of RFC 8785.

Prove it with independent fixtures:

- The RFC 8785 test vectors, as input plus the expected canonical output.
- Synthetic ledger entries whose expected digests come from a second implementation run outside the package: Python `rfc8785` plus `hashlib.sha256`.

Commit those expected values as fixture files. Tests read them and never regenerate them.

Reject input outside the RFC 8785 JSON domain in step 1, before any persistence.

## Duplicate comparison

Before you compute the comparison digest, remove only `provenance.collectedAt`, `provenance.collector`, and `provenance.collectorVersion`. For a Correction, remove those three fields from the Correction's own Provenance and, when the action is Supersede, from the replacement's Provenance. Every other difference counts, including array order and the difference between a missing field and a present field. The stored entry keeps the first accepted payload in full, including its original Provenance.

A Correction does not release an Event Key. A later Activity Event with that key still compares against the original Activity Event.

## Interfaces

Export the public surface from `packages/event-ledger/src/index.ts` as `@zs-home/event-ledger`. Reuse `ActivityEvent` and `Provenance` from `@zs-home/shared-contracts`. The pure core (`canonical.ts`, `entry.ts`, `classify.ts`, `verify.ts`, `replay.ts`) imports no storage API and no Workers API. `src/ledger-object.ts` is the only module that contains SQL.

```ts
// src/ledger-object.ts: the only module that touches storage.
export class EventLedgerObject extends DurableObject {
  appendActivityEvent(input: unknown): AppendOutcome;
  appendCorrection(input: unknown): AppendOutcome;
  readHistory(options?: { fromSequence?: number; throughSequence?: number }): LedgerEntry[];
  head(): TrustedHead | null;
}

// src/client.ts: what trusted internal consumers use.
export function openEventLedger(namespace: DurableObjectNamespace<EventLedgerObject>): EventLedger;

export interface EventLedger {
  appendActivityEvent(input: unknown): Promise<AppendOutcome>;
  appendCorrection(input: unknown): Promise<AppendOutcome>;
  readHistory(options?: { throughSequence?: number }): Promise<LedgerEntry[]>;
  head(): Promise<TrustedHead | null>;
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
  comparisonDigest: string;      // stored comparison digest, independently recomputed
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

- `openEventLedger` calls `namespace.get(namespace.idFromName("event-ledger"))`. Wrap any error thrown over RPC in `EventLedgerStorageError`. A custom error class does not arrive across the RPC boundary as itself.
- [An RPC result is limited to 32 MiB](https://developers.cloudflare.com/workers/runtime-apis/rpc/). The object's `readHistory` returns at most 1,000 entries per call and ends a page early once the page's `entry_json` passes 16 MiB. The client fixes `throughSequence` to the head on the first call, then pages with `fromSequence`. The Event Ledger is append-only, so every page belongs to the same consistent prefix.
- Inside the object, each call runs synchronously and does not `await` between queries, so the call reads one consistent state.
- `replayEffectiveHistory` walks entries in ledger sequence and applies each Correction to its target Event Key in that order. Supersede installs the replacement and can restore a retracted Activity Event. Retract omits the target. The function does not sort by `occurredAt`. A Projection does that when it builds a display.
- Keep the Correction shape inside this package for the first delivery. Move it into `specs/integration-contracts/` as a versioned contract when a Projection outside this package first reads it.

### Where trust is checked

- Identity Binding. The Collector applies Identity Bindings before it calls the ledger. Only the Collector holds the reviewed binding config. The ledger stores `actor` as given. The shared validator already refuses `actorKind` without `actorId`. The ledger cannot prove a binding from a shape, and it does not claim to.
- Correction evidence. `appendCorrection` refuses a blank reason, invalid Provenance (Provenance already requires an `https` `sourceUrl`), an unknown target, a target that is not an Activity Event, and a Supersede that changes source identity. Whether the evidence at that `sourceUrl` comes from the fact's Authority, or shows a reviewed Identity Binding for an Attribution change, remains the trusted writer's duty, as the spec states. A shape check cannot prove that duty, and the ledger does not claim to.
- Scope. Only Workers that hold the `EVENT_LEDGER` binding can call the object. The first delivery has no route and no API.

## Acceptance scenarios and tests

Every test uses synthetic fixtures and runs in the Workers runtime through [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/). Each test file gets isolated storage. Fault injection stays in tests: `runInDurableObject` installs or drops triggers and edits rows from the test side. Production code exposes no fault hooks. "Independent writers" means concurrent RPC calls through separately created stubs for the same object name.

| Spec scenario | Test | Slice |
| --- | --- | --- |
| A valid Activity Event arrives and the caller later mutates its input. | Append, mutate the input object, and confirm `readHistory` returns the committed payload, sequence, and digest. | ZER-19 |
| The Collector retries with reordered JSON object fields or different collection bookkeeping. | Pure: classification of reordered keys and a new `collectedAt`, `collector`, and `collectorVersion` returns `duplicate`. Stored: the second append returns the first receipt, and the entry keeps the first Provenance. | ZER-18, ZER-19 |
| The same Event Key arrives concurrently with two different valid subjects. | Send 8 concurrent appends with distinct subjects through separate stubs. Expect exactly one `appended`, seven `conflict`, and one entry for that key. Repeat for 20 rounds, each on a fresh object name. | ZER-20 |
| Distinct appends race, or storage fails midway through an append. | (a) 4 stubs each make 200 distinct appends inside `Promise.all`. Expect sequences 1 through 800 and a passing `verifyHistory`. (b) A test-installed `BEFORE INSERT` trigger raises `ABORT`. The append throws `EventLedgerStorageError`, `head()` is unchanged, and after the trigger is dropped the same append receives the next sequence. (c) Uncertain commit: the test discards a successful receipt, calls `abortAllDurableObjects()`, and the repeated append returns `duplicate` with that receipt. | ZER-20 |
| A Collector omits Provenance, supplies an offset timestamp, or uses the wrong Kind segment. | Each input returns `refused`, and `head()` is unchanged. | ZER-18, ZER-19 |
| A Collector has no Identity Binding. | Append an Activity Event that carries only `actor.sourceAccount`. The stored payload keeps the raw source account and has no `actorId` or `actorKind`. The Activity Event stays Unattributed. | ZER-18 |
| An authorized writer supersedes, retracts, and then restores one event. | Append an Activity Event, Supersede it, Retract it, then Supersede it again to restore it. `replayEffectiveHistory` of each prefix returns the effective history for that prefix. `readHistory` still contains all four entries. | ZER-21 |
| A Correction targets an unknown Event Key, changes source identity, or reuses an identifier with changed content. | Each call returns `refused` or `conflict`, and `head()` is unchanged. | ZER-21 |
| An Activity Event with an earlier `occurredAt` is appended after another. | Sequences follow append order. Both `occurredAt` values return byte for byte, including fractional seconds. | ZER-19 |
| A stored payload, sequence, or link is corrupted, or a trusted head no longer matches. | Pure: `verifyHistory` on hand-edited entry arrays returns each `IntegrityFailure` reason. Stored: `runInDurableObject` drops the append-only triggers, then edits `entry_json`, `sequence`, or `previous_digest`, or deletes the last row. `verifyHistory` on `readHistory` reports the matching reason. A truncated tail fails only when a trusted head is supplied. `replayEffectiveHistory` throws on that history. | ZER-17, ZER-20 |
| The ledger is reopened after successful appends. | Append, then call `evictDurableObject` and, in a separate case, `abortAllDurableObjects`. The same entries and digest chain are readable. A repeated append returns `duplicate` with the original receipt. A changed append returns `conflict`. | ZER-19 |

Notes from the probe for test authors:

- Assert a thrown RPC error with `try`/`catch`. One probe run that used `expect(...).rejects` on a stub call also reported an unhandled rejection from the object.
- The pool allows `new Function`, so pool tests cannot prove that runtime code generation is absent. The `wrangler dev` smoke in ZER-18 covers that.
- A real platform write failure after the callback, and point-in-time recovery, cannot be tested locally. Rely on the documented output-gate behavior for the write failure. Treat point-in-time recovery as untested.

## Dependencies

| Package | Pinned version | Kind | Why |
| --- | --- | --- | --- |
| `canonicalize` | 5.1.0 | dependency | RFC 8785 canonical JSON. Carried over from the previous revision. `dep-guard` flags a publisher change on this release, to GitHub Actions publishing. The package has no dependencies, and independent fixtures prove it. |
| `@cloudflare/vitest-plugin` | 1.8.5 | devDependency | Runs Vitest inside `workerd` and provides the Durable Object test helpers. It replaces the deprecated `@cloudflare/vitest-pool-workers`, whose last release supports Vitest 4 only. The peer range `vitest ^4.1.0 \|\| ^5.0.0` fits this repository's Vitest 5.1.1. `dep-guard` flags the name as two edits from `@cloudflare/vite-plugin`. It is the name Cloudflare's docs use. |
| `wrangler` | 4.165.0 | devDependency | Reads `wrangler.jsonc` for tests and runs the local `wrangler dev` smoke. The plugin depends on this exact version, so the install dedupes. This delivery never uses it to log in or deploy. |
| `@cloudflare/workers-types` | 5.20261119.1 | devDependency | Types for `DurableObject`, `DurableObjectState`, and `SqlStorage` during `npm run typecheck`. Drop this package if ZER-16 uses generated `wrangler types` instead. |

Leave `vitest` at the existing 5.1.1. The plugin pulls `workerd` and `esbuild`, and those packages run `postinstall` scripts. `npm audit --audit-level=high` reported 0 vulnerabilities on a probe install of all four packages into a copy of this repository.

## Slices

Each Task is one slice and one Work Packet. Land the slices in order. Each slice keeps `npm run check` green. Slice 5 checks stored corruption with `verifyHistory`. The assertions that `replayEffectiveHistory` refuses a corrupt history belong to slice 6, where that function exists.

| Slice | Task | Depends on |
| --- | --- | --- |
| 1. Package and Workers toolchain floor | [ZER-16](https://linear.app/zer0state/issue/ZER-16) | — |
| 2. Entry format, canonical JSON, digest chain, `verifyHistory` (pure) | [ZER-17](https://linear.app/zer0state/issue/ZER-17) | 1 |
| 3. Append validation and Duplicate or Conflict classification (pure) | [ZER-18](https://linear.app/zer0state/issue/ZER-18) | 2 |
| 4. Durable Object storage: schema, `transactionSync` append, `readHistory`, reopen | [ZER-19](https://linear.app/zer0state/issue/ZER-19) | 3 |
| 5. Concurrent writers, failed and uncertain commits, stored corruption | [ZER-20](https://linear.app/zer0state/issue/ZER-20) | 4 |
| 6. Corrections and `replayEffectiveHistory` | [ZER-21](https://linear.app/zer0state/issue/ZER-21) | 4 |

The done-when items for each slice live in the [Work Packets](work-packets/). Each packet validates against the pinned [software-factory Work Packet schema](../integration-contracts/upstream/software-factory/work_packet.schema.json).

## Fresh checkout

```sh
git clone https://github.com/Zero-State-LLC/Homer.git && cd Homer
npm ci --no-audit --no-fund
npm run check
```

`npm run check` already runs format, lint, typecheck, tests, and build. Turn the root `vitest.config.ts` into a Vitest `projects` list: the existing Node tests, plus `packages/event-ledger/vitest.config.ts` running in the Workers pool. A probe with that layout ran the existing 27 tests and 9 Durable Object tests together. Add no new top-level command. The checkout needs no Cloudflare account.

## CI in slice 1

Leave the workflow files unchanged. The `check` job stays on Node 22, which meets the 22.12.0 floor. Do not add the earlier `node:sqlite` Node matrix (22.13.0, 22, and 24). Keep the `audit` job as it is.

## NVIDIA products

Zero State's standing rule is to prefer an NVIDIA Inception product when one fits. None fits this ledger. NIM, NeMo, Nemotron, Agent Toolkit, Blueprints, TensorRT, CUDA-X, and DGX Spark are model, inference, agent, and GPU products. None of them supplies a transactional append-only ledger store or an edge runtime. This plan uses no NVIDIA product and claims none.

## Spend and deploy

- This plan and its slices deploy nothing and create no Cloudflare resources. Every test runs locally in `workerd`. Do not run `wrangler login`, `wrangler deploy`, or `wrangler d1 create` in this delivery.
- A later deploy needs a Cloudflare account, `wrangler deploy` with that account's credentials kept out of the tree, and Danny's yes. That deploy is `needs_danny`.
- [SQLite-backed Durable Objects are on the Workers Free plan](https://developers.cloudflare.com/durable-objects/platform/pricing/). Billable dimensions are requests (each RPC method call is one request), duration in GB-seconds, rows read, rows written, and stored data. The Free plan's daily limits are 100,000 requests, 13,000 GB-s, 5 million rows read, 100,000 rows written, and 5 GB stored. Past a limit, operations fail rather than bill. The Paid plan includes monthly allocations and bills past them.
- Actual cost cannot be computed without the account's plan and real Collector volume.
- Model spend for implementation is bounded by each Work Packet's `budget_usd` proposal. See open question 2.

## Out of scope

Live Collectors, Identity Binding config, Projections, the Activity Calendar, the Project Timeline, Source Freshness budgets, any Homer API, route, or MCP server, Scope enforcement, deployment, and the Control Room migration. Those stay with later ZER-9 work.

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
| CI | [ci.yml](../../.github/workflows/ci.yml) | Runs the Event Ledger tests inside `npm run check` |
| Docs | [docs.yml](../../.github/workflows/docs.yml) | Lints this plan and checks its links |
| Secret scan | [secret-scan.yml](../../.github/workflows/secret-scan.yml) | Scans fixtures and commits |

## Risks and gaps

Risks carried by this choice:

- All appends share one object. The soft limit is about 1,000 requests per second for the whole Event Ledger. Collectors are far below that today, and this plan does not measure the rate.
- Point-in-time recovery covers 30 days and cannot be exercised in local development.
- A platform write that fails after `transactionSync` returns is not reproducible locally. The caller-visible behavior follows the documented output gate: the held reply is discarded, an error is returned, and the object restarts.
- `transactionSync` accepts an `async` callback without throwing, then runs the awaited work after the transaction ends. The implementation must pass a synchronous callback.
- The Vitest pool allows `new Function`. It cannot prove the deployed ban on runtime code generation. ZER-18's `wrangler dev` smoke is the check that can.
- A stub call rejected through `expect(...).rejects` also surfaced an unhandled rejection in one probe. Assert thrown RPC errors with `try`/`catch`.
- `dep-guard` flags the `canonicalize` 5.1.0 publisher change and flags `@cloudflare/vitest-plugin` as close to `@cloudflare/vite-plugin`. Independent RFC 8785 fixtures cover the first. The plugin name is the one in Cloudflare's docs.
- The plugin install runs `postinstall` scripts for `workerd` and `esbuild`.
- Append-only triggers stop ordinary edits. They are not evidence against tampering. `verifyHistory`, plus a trusted head for a replaced history or a truncated tail, is the integrity check.
- On the Free plan, crossing a daily limit fails the operation. Dollar cost is unknown until the account plan and Collector volume are known.
- An RPC result is capped at 32 MiB, so `readHistory` pages at 1,000 entries and 16 MiB of `entry_json`.

Gaps left open on purpose:

- No authenticated caller surface exists yet. Only holders of `EVENT_LEDGER` can call the object. Open question 5 owns that gap.
- The Workers-safe validator adds a build-generated export to `@zs-home/shared-contracts`. Open question 4 owns that change.
- The implementing model's id is not chosen. It belongs in each packet's `author_model` before verify. Open question 3 owns that.
- The Cloudflare account, the Free or Paid plan, and the person who runs the first `wrangler deploy` are unset. Open question 6 owns that. Nothing in this delivery deploys.
- Each Work Packet budget of 5 USD is a proposal. Open question 2 owns that.
- `@cloudflare/workers-types` 5.20261119.1 can be dropped if ZER-16 generates types with `wrangler types`.
- The Correction shape stays inside the package until a Projection outside the package needs it as a versioned contract.

## Open questions for Danny

1. Backend: do you accept one SQLite-backed Durable Object over D1, for the reasons in [D1 and a Durable Object against the acceptance scenarios](#d1-and-a-durable-object-against-the-acceptance-scenarios)? Answered: Danny approved one SQLite-backed Durable Object over D1 on 2026-11-18 at 7:19 PM PT.
2. The Work Packet budgets are proposals of 5 USD per slice. Confirm them or set different amounts.
3. Which model implements ZER-16 through ZER-21? Put its id in each packet's `author_model` before verify.
4. May ZER-18 add a Workers-safe Activity Event validator, generated at build time, to `@zs-home/shared-contracts`? The current validator cannot run in the deployed Workers runtime.
5. Access: the spec defines no authentication surface, so this delivery publishes no route and only binding holders can call the object. Who calls it first, and through which authenticated surface? This remains a gap until a later ZER-9 Task answers it.
6. Deploy: which Cloudflare account and which plan (Free or Paid), and who runs the first `wrangler deploy`? Nothing deploys until that is decided.
