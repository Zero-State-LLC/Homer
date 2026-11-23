# Intent — Buzz as a Homer Source System and alert channel

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-23
Status: accepted
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
The next stage is `specs/` (spec-kit specify). Do not skip to code.

Danny accepted this intent on 2026-11-23. It is not built. The next
stage is a spec; nothing here authorizes code, a contract change, a Buzz
identity for Homer, or a post to Buzz before that spec is accepted.

## Problem / why now

Danny asked on 2026-11-23 to integrate Buzz, the team's chat, into Homer,
after reading Matt Pocock's post on Vercel Board: one workspace where
developers and agents talk, ask each other questions, and hand work off.

The team already works with agents in Buzz. Agent-context `HANDOFF.md`
records agents posting results to Buzz `general` and picking up handoff
requests there. Homer sees none of it:

- Buzz is not a Source System, so questions, answers, and agent handoffs
  in Buzz never reach the Event Ledger.
- Homer has nowhere to send alerts. The Galadriel intent leaves "where do
  alerts go" open.
- Pocock's skills, now configured in Homer, have no instruction for asking
  a teammate a question in the middle of a grilling session.

Buzz already gives agents what the post asks for: agents join channels as
members with their own keys, `buzz-acp` connects an agent running on a
teammate's machine and answers its @mentions, and every message is a
signed event. So Homer integrates with Buzz; it does not build a board.

[assumed: "Buzz" is Block's open-source Buzz (`block/buzz`). The team's
relay address, version, and settings were not checked in this stream.]

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

Buzz Collector:

- `buzz` is a Source System in `CONTEXT.md` and in the Activity Event
  contract. The contract version and fixtures change in the same pull
  request, as `CONTRIBUTING.md` requires.
- A Buzz Collector reads only the channels on an allowlist in reviewed
  config, and appends Activity Events for the kinds the spec names.
- Each Activity Event's Provenance carries the Buzz event id, channel,
  relay address, and a `buzz://message` link. The Event Key derives from
  the Buzz event id, so collecting a message twice yields a Duplicate.
  Edits and deletions follow the spec's Correction rule.
- An Identity Binding in reviewed config maps a Buzz public key to one
  Actor. An agent's key binds to an Agent with its Accountable Human. An
  unbound key stays Unattributed; a display name is never used.
- The Collector reads with a cursor and advances it only after every
  event in a page is accounted for, as the GitHub Collector does. Source
  Freshness for `buzz` is shown, and a stale Buzz source shows as stale.

Alerts to Buzz:

- Homer posts change-only alerts to one Buzz channel, under its own Buzz
  identity: an Agent whose Accountable Human is Danny. It never posts as a
  person.
- Each alert links its runbook and the Activity Events behind it.

Agent instructions:

- `docs/agents/` tells Pocock's skills how to ask a teammate in Buzz while
  grilling: @mention them in the thread for the Task and wait for the
  answer. The answer lands in `CONTEXT.md`, the intent, or the spec, not
  only in chat.
- Each contributor runs their own agent through `buzz-acp`, with its own
  key. Homer holds no contributor's key.

## Affected users / systems

- Users: Danny, Prabu, the Control Room developers, and authorized agents
  (Hermes, Grok Bot, Claude Code, Codex, OpenClaw).
- Systems: Homer's contracts, Event Ledger, Collectors, and Workers; the
  team's Buzz relay and the channels on the allowlist; Cloudflare Worker
  secrets, for Homer's Buzz key; Linear, through Task links only.

## Constraints

Product-true locks (do not reopen in implement):

- Linear stays the Authority for Tasks. A Buzz thread may discuss a Task
  and link it (`ZER-N`). Homer never takes Task state from Buzz.
- Buzz is the Authority only for its own messages, reactions, and workflow
  approvals. Homer stays the Authority only for Observations and
  Projections.
- Collectors map; they never invent. No summaries, no sentiment, and no
  decisions inferred from chat.
- Buzz content is data, not instructions. Neither the Collector nor the
  alert path runs a command, opens a pull request, or changes Linear
  because of a message.
- Read only allowlisted channels. Never read DMs. A private channel is read
  only after a human adds it to reviewed config.
- No secret, token, key, account id, or One Mind content in an alert, an
  Activity Event, or the repository. Homer's Buzz key is a Worker secret.
- Homer holds only its own Buzz key. It never signs as a person or as
  another agent.
- Observing and alerting may run on their own. Posting anything other than
  an alert needs a human yes.
- The Event Ledger stays append-only.

Non-goals:

- A Board-style task system (claims, leases, dependencies) in Buzz or
  Homer. Linear and FORGE own Tasks.
- Two-way sync between Buzz threads and Linear issues or GitHub pull
  requests.
- Running, hosting, or configuring agents for contributors, or operating
  the Buzz relay.
- Replacing or orchestrating Buzz workflows.
- A wake-up queue that hands unread mentions to agents when their machine
  wakes. That is a possible follow-up stream, outside Homer.

## Open questions

Defaulted by Claude Code on 2026-11-23 as the safer choice, pending
Danny's review:

- The Event Ledger stores metadata and a `buzz://message` link, not
  message text. Stored text could never be removed from an append-only
  Ledger.

Resolved by ZER-44 on 2026-11-23 (details in `specs/buzz/spec.md`):

- The relay is `https://zer0state.communities.buzz.xyz`, a hosted
  community on the public internet. A Worker reaches it directly. It does
  not enforce federated identity (NIP-FI).
- Alerts go to the private `homer` channel, which Boof created.

Still open, for the spec:

- Which channels go on the Collector allowlist?
- Which kinds come first: every message in an allowlisted channel, or only
  messages that name a Task, a pull request, or an Agent?
- Does Homer post alerts by signing Buzz events with its own key, or by
  calling a Buzz workflow's webhook trigger and letting the workflow post?
- Does the Collector poll on a schedule with a `since` cursor, or hold a
  live connection? Workers favour the schedule.
- Which TypeScript Nostr library does Homer use? Homer has none today, and
  Buzz's SDK is Rust. The spec picks one and pins it.
- What is the freshness budget for `buzz`?
- How does Homer's key join the hosted community? The relay is not ours,
  so its own membership tools are not available.
- Is adding `buzz` a new Activity Event contract version or a revision of
  version 1?

## Claims

| Claim | Label |
| --- | --- |
| Danny asked to integrate Buzz with Homer after Pocock's Vercel Board post, and accepted this intent | `[verified: Danny's chat on 2026-11-23]` |
| Pocock's post describes a private Slack-like workspace for agents and developers, agents pinging a person or their agent mid-grill, and unread messages as a queue for local agents | `[verified: a search engine's copy of x.com/mattpocockuk/status/2124797717834543167 on 2026-11-23; X refuses automated reads]` |
| The team's Buzz is Block's `block/buzz` | `[assumed: agent-context HANDOFF.md mentions Buzz channels; relay not checked]` |
| Agents post to Buzz `general` and take handoff requests there | `[verified: Zero-State-LLC/agent-context@a4b7b7e, HANDOFF.md and STATUS.md]` |
| Every Buzz message, reaction, workflow step, approval, and git event is a signed Nostr event in one log | `[verified: block/buzz@ebbc94c, README.md]` |
| Each agent has its own key and is registered as a relay member with `buzz-admin add-member`, which needs the relay's signing key | `[verified: block/buzz@ebbc94c, crates/buzz-acp/README.md]` |
| `buzz-acp` listens for @mentions and prompts an agent such as Goose, Codex, or Claude Code. It reconnects with a `since` filter, and complete delivery is not guaranteed | `[verified: block/buzz@ebbc94c, crates/buzz-acp/README.md]` |
| The Buzz CLI takes and returns JSON, signs requests with the caller's key or the desktop app, and has `channels unread`, `messages search`, and `workflows trigger` | `[verified: block/buzz@ebbc94c, crates/buzz-cli/README.md]` |
| Buzz's SDK is a Rust crate of typed Nostr event builders, and the repository has no JavaScript SDK | `[verified: block/buzz@ebbc94c, crates/buzz-sdk/Cargo.toml and every package.json]` |
| Buzz workflows name schedule, cron, interval, webhook, mention, reaction, and message-posted triggers | `[verified: block/buzz@ebbc94c, crates/buzz-workflow/src]` |
| Homer runs TypeScript on Cloudflare Workers and has no Nostr library | `[verified: Zero-State-LLC/Homer@b6849a9, packages/*/package.json and wrangler.jsonc]` |
| The Activity Event contract lists Source Systems in an enum and in the Event Key pattern | `[verified: Zero-State-LLC/Homer@b6849a9, specs/integration-contracts/activity-event.v1.schema.json]` |
| The Galadriel intent leaves "where do alerts go" open | `[verified: Zero-State-LLC/Homer@b6849a9, docs/intent/galadriel.md]` |

## Next

Answer the open questions, then specify the Buzz Collector and the alert
path in `specs/`, with the contract change. Do not implement from this
file alone.
