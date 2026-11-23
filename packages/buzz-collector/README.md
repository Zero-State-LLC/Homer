# Buzz Collector

Maps signed Buzz channel messages to Activity Events (contract version 2). Contract:
the [Buzz spec](../../specs/buzz/spec.md), "Mapping a Buzz event".

```ts
import { createBuzzMapper } from "@zs-home/buzz-collector";

const mapBuzzEvent = createBuzzMapper(verifySchnorr);
const result = mapBuzzEvent(relayEvent, {
  relayOrigin: "https://relay.example.test",
  channel: "<channel uuid>",
  collectedAt: "2026-11-23T15:05:00Z",
});
```

## What the mapper checks

In the spec's order, refusing with a reason code at the first failure:

1. The event's shape: 64-character lowercase hex `id` and `pubkey`, a 128-character
   `sig`, a non-negative integer `created_at`, string `content`, string-array `tags`,
   all within size limits, and kind 9 (a channel message).
2. The `id` is the NIP-01 hash of the event, and the signature verifies.
3. Exactly one `h` tag, naming the channel in context.
4. `created_at` no more than ten minutes past `collectedAt`.

A message tagged `["t", "knowledge-flag"]` becomes `knowledge.flagged`; any other
becomes `message.posted`. A NIP-10 `e` tag marked `root`, or else `reply`, makes it a
thread reply, with the root's `buzz://message` link as evidence.

Only metadata and a link leave the mapper. Message text, display names, mentions,
attachments and the raw event never do, and subjects are fixed text.

## Signatures

`createBuzzMapper` takes the BIP-340 Schnorr verifier as an argument, so the mapper
stays pure and the verifier stays an audited library. The spec names `@noble/curves`,
pinned to an exact version. It is not yet a dependency: the collector transport wires
it in, with real Nostr test vectors.
