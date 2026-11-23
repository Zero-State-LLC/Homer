# Homer map

This is the front door for Homer (`Zero-State-LLC/Homer`). Keep it small. Follow the links for the contract, the glossary, and team context.

## What we do

Homer is the Zero State engineering headquarters. It observes work in GitHub, Linear, the Control Room, and software-factory, records that work in one Event Ledger, and projects it into an Activity Calendar and a Project Timeline. Homer is the Authority only for Observations and Projections. It never becomes the Authority for a fact another Source System owns.

## What matters now

Two accepted specs are being built, one Linear Task per work packet in the Homer project (team ZER):

- Buzz as a Source System and alert channel: [`specs/buzz/spec.md`](../specs/buzz/spec.md).
- The knowledge loop (Knowledge Flags, the Curator, Curator Profiles): [`specs/knowledge-loop/spec.md`](../specs/knowledge-loop/spec.md).

Hosting (Danny, 2026-11-23): runners are local, and Cloudflare handles everything else. The state of the work, the open pull requests, and the next Tasks are in the latest handoff, [`docs/receipts/implementation-2026-11-23.md`](receipts/implementation-2026-11-23.md). The foundation intent, [`docs/intent/home-foundation.md`](intent/home-foundation.md), still governs the Event Ledger and Projections (ZER-9). Do not invent a Milestone date; an Unknown Date is a valid answer.

## Authority / source order

Use this order, from [`CONTEXT.md`](../CONTEXT.md). It is Authority, not recency:

- Linear is the Authority for Task ownership, priority, and status.
- GitHub is the Authority for Repository Events.
- The Control Room is the Authority for Work Sessions and Handoffs.
- software-factory is the Authority for Work Packet stage and Verdicts.
- Homer is the Authority only for Observations and Projections.

If you cannot find a fact, say so. Never invent Attribution or a Milestone date, and never turn a guess into an Activity Event, a glossary term, or an accepted intent. Unattributed and Unknown Date are valid answers. Collectors map, they never invent.

## Start here

- [`AGENTS.md`](../AGENTS.md) — the agent contract
- [`CONTEXT.md`](../CONTEXT.md) — the ubiquitous language
- [`docs/intent/`](intent/) — accepted intents (read the active one before you edit)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the order of work, and how to land a fix
- [`docs/agents/`](agents/) — where Pocock's engineering skills put Tasks, specs, terms, and decisions
- [`agent-context.pin.json`](../agent-context.pin.json) — the Context Pin
- Team context lives in [`Zero-State-LLC/agent-context`](https://github.com/Zero-State-LLC/agent-context): read `HANDOFF.md`, then `STATUS.md`, then `DECISIONS.md` only if a prior choice affects this Task. Clone it as `AGENTS.md` describes. Do not copy it into Homer.

## Where it lands

Route work into the right path, not into a chat.

| Incoming | Lands in |
| --- | --- |
| A new or changed term | `CONTEXT.md` |
| Stage-zero intent | `docs/intent/` |
| Evidence, discovery, or implementation receipt | `docs/receipts/` |
| Integration contract | `specs/integration-contracts/` (named in `CONTRIBUTING.md`; the folder arrives with the contracts work) |
| Activity Event from a Source System | the Event Ledger, via a Collector |
| Team HANDOFF, STATUS, DECISIONS, or skills | `Zero-State-LLC/agent-context`, consumed through the Context Pin |

Do not add a second skills library to Homer. Name only skills that already exist.
