# Event Ledger

Append-only Activity Events and Corrections in a SQLite-backed Cloudflare Durable
Object. Call through the internal `EVENT_LEDGER` binding. There is no public route.

```ts
import { openEventLedger, replayEffectiveHistory } from "@zs-home/event-ledger";

const ledger = openEventLedger(env.EVENT_LEDGER);
const result = await ledger.appendActivityEvent(activityEvent);
const effective = replayEffectiveHistory(await ledger.readHistory());
```

Each append validates and snapshots its input before a synchronous transaction
classifies the identifier, allocates the next sequence and writes the chained
entry. Duplicate retries return the first receipt and retain the first Provenance.
Corrections retain the original Activity Event and apply in append order.

## Verification

`verifyHistory(entries, trustedHead?)` checks sequence, format, links, full entry
digests, stored comparison digests and payload semantics. The client verifies a
fixed, paged prefix before returning history. The object's internal page reader
can return damaged digest fields for diagnosis; trusted consumers must verify
before replay. Indexed columns are cross-checked against canonical payloads.

A trusted head must be stored separately to detect a replaced history or tail
truncation. The ledger cannot authenticate evidence URLs or Identity Bindings.
Collectors and Correction writers own those checks. No One Mind content or
credentials may enter any payload.

## Limits and failures

- Development: Node 22.13+, Node 24, or Node 26+. Execution: Cloudflare Workers with SQLite DO storage.
- Maximum canonical payload: 1 MiB. Read pages: at most 1,000 entries and 16 MiB.
- A client read fixes the head first and verifies the complete returned prefix.
- Storage and RPC failures throw `EventLedgerStorageError`. Retry the identical
  identifier and payload after an uncertain commit. The client gets a fresh stub
  on each operation so a failed object instance does not poison future retries.
- Triggers prevent accidental UPDATE and DELETE. They are not protection against
  an administrator rewriting storage. Replay performs the integrity check.
- Point-in-time recovery and real platform write failures cannot be proved locally.
- No Cloudflare resources are created by `npm run check`.

## Tests

Run `npm ci --no-audit --no-fund && npm run check` from the repository root.
The tests include fixed independent Python RFC 8785 / SHA-256 fixtures, concurrent
RPC writers, failure injection, eviction, restart, paging, corruption, Corrections,
and parity of the generated Workers validator with existing Node fixtures.

`npm run smoke:workers` runs a separate local-only harness in plain Wrangler.
This catches runtime code generation and filesystem dependencies that the test
pool can permit. The production entry remains binding-only.
