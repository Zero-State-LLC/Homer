# ADR 014: a `homer-buzz` Worker holds Homer's Buzz key

Status: accepted by Danny on 2026-11-25, in chat. Asked where Homer's Buzz key and
its scheduled work should live, he chose a new `homer-buzz` Worker over adding a
schedule to `homer-intake` or `homer-catalog`.
Tasks: ZER-55 and ZER-82 need a place to run; ZER-54 (Buzz collection) will run
here too.

## Context

Homer posts Alerts to the Buzz `homer` channel, signed with its own key (Buzz
spec, [Homer's Buzz identity](../buzz/spec.md#homers-buzz-identity)). Some fleet
Alerts come from the passing of time, not from a request: a Fleet Collector that
has gone quiet sends nothing to react to. So Alerts need a schedule. Buzz
collection (ZER-54) needs the same key, to sign its relay queries, and its own
schedule.

[ADR 013](013-catalog-worker-boundary.md) split Homer's Workers by who calls
them, to keep each Worker's secrets and blast radius small. `homer-intake` runs
the public GitHub webhook; `homer-catalog` serves people. Neither has a
schedule, and neither should hold a key that speaks for Homer in Buzz.

## Decision

1. **A third Worker, `homer-buzz`.** It is the only Worker that holds
   `BUZZ_HOMER_PRIVATE_KEY`, set with `wrangler secret put`, as the Buzz spec
   says. It serves no route: every request is `404`, and it holds no Access
   audience. Like the Event Ledger Worker, its deploy receipt takes the version
   from Wrangler's output.
2. **It runs on a schedule.** Every minute it reads the latest fleet snapshot
   and the runner fleet configuration, applies `projectFleetAlerts` to the Alert
   engine, and posts what is due. Buzz collection runs in the same Worker on its
   own interval (5 minutes, per the Buzz spec).
3. **It defines its own Alert state.** A new Durable Object class holds the
   Alert engine's state, one record per Alert Key, and nothing else reads
   it. Evaluation and delivery run one at a time in that object.
4. **Bindings point one way, as ADR 013 requires.** `homer-buzz` binds
   `RUNNER_FLEET` from `homer-catalog` by `script_name`, to read, and the Event
   Ledger, to append collected events. No other Worker binds anything
   `homer-buzz` defines. It is deployed after `homer-catalog`.
5. **Outbound only.** It reaches the Buzz relay and nothing else, and it posts
   Alerts only. Anything else Homer might say in Buzz still needs a human yes.

## Consequences

- One more Worker to deploy, with its own receipt and rollback, and one more
  Durable Object migration that pins only its own rollback.
- The Buzz key never shares a Worker with the GitHub webhook or the admin pages.
  Rotating it (Buzz spec, step 5) touches one Worker.
- The fleet status view and the Alerts read the same snapshot, so they agree on
  what is stale.

## Not decided here

- The Schnorr library that signs posts and checks signatures: `@noble/curves`
  is the Buzz spec's default and ZER-61's work.
- How a post reaches the relay. The Buzz spec settles that queries use a
  NIP-98-signed `POST /query`; the packet that wires posting confirms the
  relay's way of taking a message, and records it.
- Homer's key itself, its owner attestation and its channel membership: ZER-48,
  operator steps with a receipt.
