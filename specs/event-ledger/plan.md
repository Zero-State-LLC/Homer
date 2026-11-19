# Event Ledger implementation plan

Status — Revised by FORGE (PROMETHEUS) on 2026-11-18 PT. Needs Danny's yes before any implementation starts.

- Specification — [Event Ledger spec](spec.md) (accepted 2026-11-19)
- Planning handoff — [handoff.md](handoff.md)
- Task — [ZER-9](https://linear.app/zer0state/issue/ZER-9/implement-control-room-activity-calendar-and-project-timelines)
- Work Packets — [work-packets/](work-packets/), one JSON file per implementation slice

This plan answers the [decisions for FORGE](handoff.md#decisions-for-forge). It adds no code. Terms follow [CONTEXT.md](../../CONTEXT.md).

Revision note: on 2026-11-18 at 5:14 PM PT, Danny asked (relayed by Boof) for Cloudflare D1 or Durable Objects as the Event Ledger storage. That replaces the earlier `node:sqlite` choice. This revision compares the two, recommends one, and redoes the runtime, interfaces, tests and slices.

## Decisions

### Storage backend: one SQLite-backed Durable Object

One Event Ledger is one [SQLite-backed Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) of class `EventLedgerObject`, addressed with `idFromName("event-ledger")`. All storage SQL runs inside that object through `ctx.storage.sql.exec`, and every append runs in one `ctx.storage.transactionSync` callback.

#### D1 and a Durable Object against the acceptance scenarios

| Acceptance scenario | D1 | SQLite-backed Durable Object |
| --- | --- | --- |
| Concurrent writes: distinct appends race, or one Event Key races with different content | No interactive transaction: `BEGIN` is refused and only `batch()` runs a fixed list of statements atomically. The digest chain needs JavaScript between reading the head and inserting (SHA-256 over the new entry, which contains the previous digest), so two Worker invocations can read the same head. Correct only with an extra mechanism: optimistic retry on the `sequence` primary key, re-running classification after every lost race. | One object runs one `transactionSync` callback at a time. Lookup by Event Key, Duplicate or Conflict decision, Correction target check, head read, digest and insert all happen in one synchronous callback, so no other request interleaves. This is the old `BEGIN IMMEDIATE` design with the lock provided by the object. |
| Failed commits: storage fails midway, or a retry follows an uncertain commit | A failing statement rolls back its whole batch. A retry must reclassify, which works because the Event Key is `UNIQUE`. | An exception inside `transactionSync` rolls the transaction back. If a write fails after the callback, the platform discards the held reply and restarts the object, so the caller never gets a receipt for an entry that did not persist. A retry of a committed input returns `duplicate` with the original receipt. |
| Reopening | The database outlives any Worker; re-reads are plain queries. | Storage outlives the object instance. Eviction or restart reloads the same rows; the constructor runs `CREATE ... IF NOT EXISTS` only. |
| Corruption | Same SQL, same `verifyHistory`. Time Travel restores a database to any minute in the last 30 days. | Same SQL, same `verifyHistory`. Point-in-time recovery restores the object's database to any point in the last 30 days (not available in local development). |

#### Evidence

Docs, read 2026-11-18:

- [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): `transactionSync(callback)` rolls back if the callback throws, and the callback must be synchronous. `sql.exec()` cannot run `BEGIN TRANSACTION` or `SAVEPOINT`. Point-in-time recovery covers the past 30 days and is not supported locally.
- [Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/), output gates: while a write is in progress, outgoing messages are held. If the write fails, those messages are discarded and replaced with errors, and the object restarts.
- [D1 `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/): batched statements are an SQL transaction and a failing statement rolls back the sequence. D1 otherwise runs in auto-commit. The [D1 import guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/) tells users to remove `BEGIN TRANSACTION` and `COMMIT` from dumps.
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/): 10 GB storage per object (1 GB on the Free plan), a soft limit of 1,000 requests per second per object, 30 seconds of CPU per request by default, 8 MB per row and 100 bound parameters per query.

Local probe, 2026-11-18, `@cloudflare/vitest-plugin` 1.8.5 with Vitest 5.1.1, `workerd` 1.20261118.1, compatibility date `2026-11-18`, synthetic fixtures:

- A `STRICT` table with `UNIQUE (event_key)` refused a text `sequence`, and `BEFORE UPDATE` and `BEFORE DELETE` triggers with `RAISE(ABORT, ...)` refused edits.
- `sql.exec("BEGIN IMMEDIATE")` and `sql.exec("SAVEPOINT a")` threw: "To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs". The local D1 binding refused `BEGIN IMMEDIATE` with the same message.
- 300 concurrent appends through one stub gave sequences 1 to 300 with an unbroken `previous_digest` chain.
- 20 rounds of 8 concurrent appends for one Event Key with different subjects each gave exactly one `appended` and seven `conflict`. 4 identical concurrent appends gave one `appended` and three `duplicate`.
- A test-installed `BEFORE INSERT` trigger made the append throw `SQLITE_CONSTRAINT_TRIGGER`, the head stayed unchanged, and after the trigger was dropped the same append got sequence 2. A throw after an insert inside `transactionSync` left the row count unchanged.
- After `evictDurableObject` and `abortAllDurableObjects`, the entries were still there, a repeated append returned `duplicate` with the first receipt, and a changed one returned `conflict`.
- `createHash("sha256")` from `node:crypto` ran inside `transactionSync`.
- `transactionSync` accepted an `async` callback without throwing. The awaited part would run after the transaction ends, so the code must never pass one.

Why the Durable Object:

- The spec makes uniqueness, sequence assignment and the append one atomic operation. A Durable Object gives that directly. D1 needs an optimistic-retry protocol on top, which is more code to get wrong and more tests to prove.
- Both store SQLite, so the schema, the entry format and the core are the same either way. Only `src/ledger-object.ts` would change.
- Exit path: the schema is plain SQLite, and the core (canonical JSON, digests, classification, `verifyHistory`, `replayEffectiveHistory`) has no storage code. Rows read through `readHistory` load into any SQLite database, and `verifyHistory` proves the copy.

Costs of this choice:

- One object serializes all appends. The soft limit is about 1,000 requests per second for the whole Event Ledger. HOME's Collectors are far below that today, but the plan does not measure it.
- Point-in-time recovery cannot be tested locally.
- Errors thrown inside the object reach the caller as RPC errors. The client wraps them; see [Interfaces](#interfaces).

### Runtime: Cloudflare Workers

- The ledger runs in the Workers runtime. `packages/event-ledger/wrangler.jsonc` declares the `EVENT_LEDGER` Durable Object binding, a `new_sqlite_classes` migration for `EventLedgerObject`, compatibility date `2026-11-18` and `compatibility_flags: ["nodejs_compat"]`. It has no `account_id`, no routes and no deploy script.
- For compatibility dates of 2026-08-04 or later, [Node.js compatibility is on by default](https://developers.cloudflare.com/workers/configuration/compatibility-flags/), so the flag is redundant at this date. Keep it so the config states the dependency on [`node:crypto`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
- Hashing inside `transactionSync` must be synchronous, so it uses `createHash("sha256")` from `node:crypto`. Web Crypto's `crypto.subtle.digest` returns a Promise and cannot be used inside the callback.
- No public `fetch` route. Callers reach the object through Workers RPC on the binding. The spec defines no authentication surface, so a route would be an unauthenticated write path. This is recorded as a gap in [Open questions](#open-questions-for-danny).
- Development and tests need Node 22.12.0 or later, because `wrangler` 4.165.0, `@cloudflare/vitest-plugin` 1.8.5 and the existing Vitest 5.1.1 declare that floor. The root `engines` field moves from `>=22` to `>=22.12.0` to match.

### Validation inside the Workers runtime

The [Workers runtime refuses `eval()` and `new Function`](https://developers.cloudflare.com/workers/runtime-apis/web-standards/). The current shared validator in `@zs-home/shared-contracts` reads schema files with `node:fs` and compiles them with Ajv at runtime, which generates code from strings.

Probe results:

- Inside the Vitest integration, a runtime Ajv compile and `new Function` both worked, and `readFileSync` of a repository schema failed with "no such file or directory".
- A plain `wrangler dev` session on local `workerd` refused `new Function` with "Code generation from strings disallowed for this context".

So the Vitest pool is more permissive than the deployed runtime and cannot catch this. The plan:

- ZER-18 adds a Workers-safe export to `@zs-home/shared-contracts` that uses a standalone Ajv validator, generated at build time from `activity-event.v1.schema.json`. It has no `node:fs` and no runtime compile.
- A test in Node checks that it accepts and refuses the same fixtures as the existing validator.
- A local smoke test runs the built Worker in `wrangler dev` (no login, no deploy) and appends one synthetic Activity Event.

This touches the shared package, so it is an open question.

### Schema

The schema is unchanged from the previous revision. `PRAGMA` settings are gone: the platform owns journaling and durability.

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

The constructor applies it inside `ctx.blockConcurrencyWhile`. The triggers stop accidental edits through the package. They are not tamper protection; `verifyHistory` and a trusted head are.

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

`appendActivityEvent` and `appendCorrection` run inside the object. Steps 1 to 3 touch no storage.

1. Validate. Activity Events go through the Workers-safe Activity Event validator from `@zs-home/shared-contracts`. The ledger then adds the rules the shared validator cannot hold: the second Event Key segment equals `kind`, and the input lies inside the RFC 8785 JSON domain (no `undefined`, `BigInt`, non-finite numbers, lone surrogates or non-plain objects). Invalid input returns `refused` and opens no transaction.
2. Snapshot. Deep-copy the validated input through canonical JSON.
3. Compute the comparison digest.
4. Enter `ctx.storage.transactionSync(() => { ... })`. The callback is synchronous and calls nothing that returns a Promise.
5. Look up the Event Key (Activity Event) or Correction identifier (Correction).
6. If a row exists with the same comparison digest, return `duplicate` with the stored receipt. If it exists with a different digest, return `conflict`. Neither writes.
7. For a Correction, check the target: it must be a stored Activity Event, and a Supersede replacement must keep the target's Event Key, Kind, Source System and source object ID. Otherwise return `refused`.
8. Read the head (highest sequence and its digest). Build the entry with `sequence = head + 1` and `previousDigest = head digest`, or sequence 1 and `null`. Compute `entryDigest` with `node:crypto`. Insert.
9. Return `appended` with the receipt. The transaction commits when the callback returns.

`PRIMARY KEY (sequence)` and the two `UNIQUE` constraints are backstops. If one fires, the callback throws, the transaction rolls back and the caller gets an error, never a partial entry.

What a caller can observe:

| Situation | Caller sees | Ledger state |
| --- | --- | --- |
| Commit succeeded | `appended` with sequence and entry digest | Entry visible to every later read |
| Refused, Duplicate or Conflict | That outcome | Unchanged |
| Exception inside the transaction (constraint, storage error) | A thrown `EventLedgerStorageError`, no receipt | Unchanged; the transaction rolled back |
| The write fails after the callback returns | An error; the output gate discards the receipt and the object restarts | Unchanged |
| The reply is lost after the write persisted (network, caller crash) | No receipt | Entry committed. Retrying the same input returns `duplicate` with the original receipt |
| The object is evicted or restarted after any of the above | Same committed entries and digest chain | Duplicate and Conflict outcomes still hold |

### Canonicalization: `canonicalize` 5.1.0

- Use the npm package [`canonicalize`](https://github.com/erdtman/canonicalize), pinned to exactly `5.1.0` (Apache-2.0, no dependencies), the JCS implementation by an RFC 8785 author.
- Prove it against independent fixtures: the RFC 8785 test vectors (input and expected canonical output), and synthetic ledger entries whose expected digests come from a second implementation run outside the package (Python `rfc8785` plus `hashlib.sha256`). Commit the expected values as fixture files; tests never regenerate them.
- Reject input outside the RFC 8785 JSON domain in step 1, before persistence.

### Duplicate comparison

Strip only `provenance.collectedAt`, `provenance.collector` and `provenance.collectorVersion` before computing the comparison digest. For a Correction, strip the same three fields from the Correction's own Provenance and, for a Supersede, from the replacement's Provenance. Everything else counts, including array order and whether an optional field is present. The stored entry keeps the first accepted payload in full.

## Interfaces

All exports come from `packages/event-ledger/src/index.ts` as `@zs-home/event-ledger`. Types reuse `ActivityEvent` and `Provenance` from `@zs-home/shared-contracts`. The pure core (`canonical.ts`, `entry.ts`, `classify.ts`, `verify.ts`, `replay.ts`) has no storage or Workers imports. `src/ledger-object.ts` is the only module with SQL.

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

- `openEventLedger` calls `namespace.get(namespace.idFromName("event-ledger"))`. It wraps any error thrown over RPC in `EventLedgerStorageError`, because a custom error class does not cross the RPC boundary as itself.
- [An RPC result is limited to 32 MiB](https://developers.cloudflare.com/workers/runtime-apis/rpc/), so the object's `readHistory` returns at most 1,000 entries per call and ends a page early once its `entry_json` passes 16 MiB. The client fixes `throughSequence` to the head on its first call, then pages with `fromSequence`. The ledger is append-only, so every page belongs to the same consistent prefix.
- Inside the object, each call runs synchronously with no `await` between its queries, so it reads one consistent state.
- `replayEffectiveHistory` walks entries in ledger sequence and applies Corrections to their target Event Key in that order. Supersede swaps in the replacement (and restores a retracted event); Retract omits it. It sorts nothing by `occurredAt`; a Projection does that for display.
- The Correction shape stays internal to the package in the first delivery. It moves into `specs/integration-contracts/` as a versioned contract when a Projection outside this package first reads it.

### Where trust is checked

- Identity Binding: the Collector applies Identity Bindings before it calls the ledger, because only the Collector holds the reviewed binding config. The ledger stores `actor` as given, and the shared validator already refuses `actorKind` without `actorId`. The ledger cannot prove a binding from a shape, so it does not claim to.
- Correction evidence: `appendCorrection` refuses a Correction with a blank reason, invalid Provenance (which already requires an https `sourceUrl`), an unknown or non-Activity-Event target, or a Supersede that changes source identity. Whether the evidence behind that `sourceUrl` comes from the right Authority, or shows a reviewed Identity Binding for an Attribution change, stays the trusted writer's job, as the spec says. A shape check cannot prove it, so the ledger does not claim to.
- Scope: only Workers holding the `EVENT_LEDGER` binding can call the object. There is no route and no API in the first delivery.

## Acceptance scenarios to tests

Every test uses synthetic fixtures only and runs in the Workers runtime through [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/), which gives each test file isolated storage. Fault injection lives in tests only: `runInDurableObject` installs or drops triggers and edits rows from the test side. Production code has no fault hooks. "Independent writers" means concurrent RPC calls through separately created stubs for the same object name.

| Spec scenario | Test | Slice |
| --- | --- | --- |
| A valid Activity Event arrives and the caller later mutates its input. | Append, mutate the input object, `readHistory` returns the committed payload, sequence and digest. | ZER-19 |
| The Collector retries with reordered JSON object fields or different collection bookkeeping. | Pure: classification of reordered keys and new `collectedAt`, `collector`, `collectorVersion` gives `duplicate`. Stored: the second append returns the first receipt and the entry keeps the first Provenance. | ZER-18, ZER-19 |
| The same Event Key arrives concurrently with two different valid subjects. | 8 concurrent appends with distinct subjects through separate stubs: exactly one `appended`, seven `conflict`, one entry for the key. Repeat 20 rounds, each on a fresh object name. | ZER-20 |
| Distinct appends race, or storage fails midway through an append. | (a) 4 stubs × 200 distinct appends in `Promise.all` give sequences 1..800 and `verifyHistory` passes. (b) A test-installed `BEFORE INSERT` trigger raises `ABORT`; the append throws `EventLedgerStorageError`, `head()` is unchanged, and after the trigger is dropped the same append gets the next sequence. (c) Uncertain commit: the test discards a successful receipt, calls `abortAllDurableObjects()`, and the retry returns `duplicate` with that receipt. | ZER-20 |
| A Collector omits Provenance, supplies an offset timestamp, or uses the wrong Kind segment. | Each input returns `refused`; `head()` is unchanged. | ZER-18, ZER-19 |
| A Collector has no Identity Binding. | Append with only `actor.sourceAccount`; the stored payload keeps the raw account and has no `actorId` or `actorKind`. | ZER-18 |
| An authorized writer supersedes, retracts, and then restores one event. | Append event, Supersede, Retract, Supersede (restore). `replayEffectiveHistory` of each prefix gives the expected effective history; `readHistory` keeps all four entries. | ZER-21 |
| A Correction targets an unknown Event Key, changes source identity, or reuses an identifier with changed content. | Each returns `refused` or `conflict`; `head()` is unchanged. | ZER-21 |
| An Activity Event with an earlier `occurredAt` is appended after another. | Sequences follow append order; both `occurredAt` values come back byte-for-byte, including fractional seconds. | ZER-19 |
| A stored payload, sequence, or link is corrupted, or a trusted head no longer matches. | Pure: `verifyHistory` on hand-edited entry arrays returns each `IntegrityFailure` reason. Stored: `runInDurableObject` drops the append-only triggers, then edits `entry_json`, `sequence` or `previous_digest`, or deletes the last row; `verifyHistory` on `readHistory` reports the matching reason, a truncated tail fails only with the trusted head, and `replayEffectiveHistory` throws. | ZER-17, ZER-20 |
| The ledger is reopened after successful appends. | Append, then `evictDurableObject` and, separately, `abortAllDurableObjects`; same entries and chain; a repeat append returns `duplicate` with the original receipt, a changed one `conflict`. | ZER-19 |

Test-writing notes from the probe:

- Assert on a thrown RPC error with `try`/`catch`. One probe run with `expect(...).rejects` on a stub call also reported an unhandled rejection from the object.
- The pool allows `new Function`, so tests cannot prove the absence of runtime code generation. The `wrangler dev` smoke in ZER-18 covers that.
- Not testable locally: a real platform write failure after the callback, and point-in-time recovery. The plan relies on the documented output-gate behavior for the first and lists the second as untested.

## Dependencies

| Package | Pinned version | Kind | Why |
| --- | --- | --- | --- |
| `canonicalize` | 5.1.0 | dependency | RFC 8785 canonical JSON. Carried over. `dep-guard` flags a publisher change on this release (to GitHub Actions publishing); the package has no dependencies and is proven by independent fixtures. |
| `@cloudflare/vitest-plugin` | 1.8.5 | devDependency | Runs Vitest inside `workerd` with Durable Object test helpers. It replaces the deprecated `@cloudflare/vitest-pool-workers`, whose last release supports Vitest 4 only. Peer range `vitest ^4.1.0 \|\| ^5.0.0` fits the repository's Vitest 5.1.1. `dep-guard` flags the name as two edits from `@cloudflare/vite-plugin`; it is the name Cloudflare's docs use. |
| `wrangler` | 4.165.0 | devDependency | Reads `wrangler.jsonc` for tests and runs the local `wrangler dev` smoke. The same version is an exact dependency of the plugin, so it dedupes. Never used to log in or deploy in this delivery. |
| `@cloudflare/workers-types` | 5.20261119.1 | devDependency | Types for `DurableObject`, `DurableObjectState` and `SqlStorage` in `npm run typecheck`. Dropped if ZER-16 uses generated `wrangler types` instead. |

`vitest` stays at the existing 5.1.1. The plugin pulls `workerd` and `esbuild`, which run `postinstall` scripts. `npm audit --audit-level=high` reported 0 vulnerabilities on a probe install of all four into a copy of this repository.

## Tasks

Each Task is one slice and one Work Packet. Slices land in order; each keeps `npm run check` green.

| Slice | Task | Depends on |
| --- | --- | --- |
| 1. Package and Workers toolchain floor | [ZER-16](https://linear.app/zer0state/issue/ZER-16) | — |
| 2. Entry format, canonical JSON, digest chain, `verifyHistory` (pure) | [ZER-17](https://linear.app/zer0state/issue/ZER-17) | 1 |
| 3. Append validation and Duplicate or Conflict classification (pure) | [ZER-18](https://linear.app/zer0state/issue/ZER-18) | 2 |
| 4. Durable Object storage: schema, `transactionSync` append, `readHistory`, reopen | [ZER-19](https://linear.app/zer0state/issue/ZER-19) | 3 |
| 5. Concurrent writers, failed and uncertain commits, stored corruption | [ZER-20](https://linear.app/zer0state/issue/ZER-20) | 4 |
| 6. Corrections and `replayEffectiveHistory` | [ZER-21](https://linear.app/zer0state/issue/ZER-21) | 4 |

Done-when items for each slice are in the [Work Packets](work-packets/), each of which validates against the pinned [software-factory Work Packet schema](../integration-contracts/upstream/software-factory/work_packet.schema.json).

## Fresh-checkout command

```sh
git clone https://github.com/Zero-State-LLC/home.git && cd home
npm ci --no-audit --no-fund
npm run check
```

`npm run check` already runs format, lint, typecheck, tests and build. The root `vitest.config.ts` becomes a Vitest `projects` list: the existing Node tests, plus `packages/event-ledger/vitest.config.ts` running in the Workers pool. A probe with that layout ran the existing 27 tests and 9 Durable Object tests together. No new top-level command and no Cloudflare account needed.

## CI change (slice 1)

None to the workflows. The `check` job stays on Node 22, which meets the 22.12.0 floor. The `node:sqlite` Node matrix (22.13.0, 22, 24) is dropped. Keep `audit` as it is.

## NVIDIA-first rule

Zero State's standing rule is to prefer NVIDIA Inception products where one fits. None applies here. NIM, NeMo, Nemotron, Agent Toolkit, Blueprints, TensorRT, CUDA-X and DGX Spark are model, inference, agent and GPU products. None supplies a transactional append-only ledger store or an edge runtime. This plan uses no NVIDIA product and claims none.

## Spend and deploy

- This plan and its slices deploy nothing and create no Cloudflare resources. Every test runs locally in `workerd`. No `wrangler login`, `wrangler deploy` or `wrangler d1 create`.
- A later deploy needs a Cloudflare account, `wrangler deploy` with that account's credentials kept out of the tree, and Danny's yes. It is `needs_danny`.
- [SQLite-backed Durable Objects are on the Workers Free plan](https://developers.cloudflare.com/durable-objects/platform/pricing/). Billable dimensions: requests (each RPC method call is one request), duration in GB-seconds, rows read, rows written and stored data. The Free plan has daily limits: 100,000 requests, 13,000 GB-s, 5 million rows read, 100,000 rows written and 5 GB stored. Over a limit, operations fail rather than bill. The Paid plan includes monthly allocations and bills beyond them.
- Actual cost is not computable without the account's plan and real Collector volume.
- Model spend for implementation is bounded by each Work Packet's `budget_usd` proposal (open question 2).

## Out of scope

Live Collectors, Identity Binding config, Projections, the Activity Calendar and Project Timeline, Source Freshness budgets, any HOME API, route or MCP, Scope enforcement, deployment, and the Control Room migration. These stay with later ZER-9 work.

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
| CI | [ci.yml](../../.github/workflows/ci.yml) | Runs the Event Ledger tests in `npm run check` |
| Docs | [docs.yml](../../.github/workflows/docs.yml) | Lints this plan and checks its links |
| Secret scan | [secret-scan.yml](../../.github/workflows/secret-scan.yml) | Scans fixtures and commits |

## Open questions for Danny

1. Backend: accept one SQLite-backed Durable Object over D1, for the reasons in [the comparison](#d1-and-a-durable-object-against-the-acceptance-scenarios)?
2. The Work Packet budgets are proposals (5 USD per slice). Confirm or set them.
3. Which model implements ZER-16 to ZER-21? Its id goes into each packet's `author_model` before verify.
4. May ZER-18 add a Workers-safe, build-time-generated Activity Event validator to `@zs-home/shared-contracts`? The current one cannot run in the deployed Workers runtime.
5. Access: the spec defines no authentication surface, so this delivery has no route and only binding holders can call the object. Who will call it first, and through what authenticated surface? This stays a gap until a later ZER-9 Task answers it.
6. Deploy: which Cloudflare account and plan (Free or Paid), and who runs the first `wrangler deploy`? Nothing deploys until then.
