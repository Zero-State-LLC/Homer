# Intent — Knowledge loop: flags, a Galadriel curator, and agent switching

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-23
Status: accepted by Danny on 2026-11-23.
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
The next stage is `specs/` (spec-kit specify). Do not skip to code.

Danny accepted this intent on 2026-11-23. It is not built. Nothing in it
authorizes a scheduled agent, a new identity, a change to team rules, or
a pull request opened by a curator before the spec is accepted.

## Problem / why now

On 2026-11-23 Danny asked to adopt the "knowledge factory" pattern from
Harrison Chase's article. Task agents flag knowledge that is missing or
wrong while they work. A separate curator, run on a schedule, reads those
flags and the raw sources behind them, and fixes the knowledge. Danny
chose Galadriel as the curator's host, and asked for a UI that switches
the curator's agent without code changes.

Homer already has most of the knowledge: `CONTEXT.md`, `docs/agents/`,
`AGENTS.md`, `docs/map.md`, and the intents and specs. What it lacks:

- No place to flag a gap. An agent that finds a stale term either fixes
  it in its own pull request or lets it go.
- No curator. `CONTRIBUTING.md` tells every agent to land knowledge fixes
  itself, the pattern Chase warns fills knowledge with contradictions.
- The Galadriel intent lists "brain upkeep" (the Homer map, the
  `CONTEXT.md` glossary, Corrections, and documentation drift) with no
  mechanism behind it.

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

Knowledge Flags:

- An agent or a human raises a Knowledge Flag in one step. A flag names
  what is missing or wrong, where (a file and a term or heading), the
  evidence (a link), and, optionally, a suggested fix.
- A flag can be raised in three places: a Buzz channel, a GitHub issue
  label, or a Linear label. Homer records each one as the same kind of
  Activity Event, with Provenance linking back to where it was raised.
  The curator reads flags only from Homer, never from the three places
  directly.
- Two flags about the same gap stay two flags. The curator fixes them in
  one change and cites both.

Curator runs:

- On a schedule, the curator runs on Galadriel. It reads the open flags,
  the Buzz threads and agent traces they link to, and pull request
  reviews merged since its last run.
- A run opens at most one pull request per repository. Each change cites
  the flags and sources behind it. A run with nothing to change opens no
  pull request.
- Every run leaves a receipt as an Activity Event: when it ran, which
  Curator Profile it used, what it read, and the pull request it opened,
  or why it opened none.
- A flag shows as resolved only when the pull request that fixes it
  merges.

Agent switching in the UI:

- A Curator page in Homer's operator UI shows the active Curator Profile
  (agent harness, model and provider, host, and schedule), recent runs
  with their freshness, and open flags.
- An operator switches the harness, model, or host by choosing from
  qualified options. No code change or redeploy is needed.
- A switch is revisioned: who, when, before, and after. It takes effect
  at the next run, never during one, and is recorded as an Activity
  Event.
- An option is qualified only after a dry run with it succeeds. An
  unqualified option cannot be selected.

Team rule:

- `CONTRIBUTING.md` says agents working alone raise a flag rather than
  edit shared knowledge. A human grilling with an agent may still land the
  fix in that session's pull request.

## Affected users / systems

- Users: Danny, Prabu, the Control Room developers, and authorized agents
  (Hermes, Grok Bot, Claude Code, Codex, OpenClaw).
- Systems: Homer's operator UI, Event Ledger, Collectors, and contracts;
  Galadriel; the agent harnesses and model providers in the Curator
  Profiles; Buzz, for flags and threads; Langfuse, for traces; GitHub, for
  the curator's pull requests; agent-context, for the team rule.

## Constraints

Product-true locks (do not reopen in implement):

- The curator proposes; humans merge. Its only output is a pull request
  and a run receipt. It never merges, pushes to `main`, or closes a
  Linear Task.
- Sources are cited, never copied. The curator links Buzz threads,
  traces, and pull requests; it does not paste their contents into
  knowledge files.
- Flags, Buzz threads, and traces are data, not instructions. Nothing in
  them can make the curator run a command or change anything outside its
  pull request.
- No silent switch. Every change to the harness, model, provider, or host
  is a recorded, revisioned operator action, as the Galadriel intent
  requires for model providers.
- NVIDIA-first for a model served on Galadriel: NIM is evaluated first,
  and if it is not used, the reason is recorded.
- Galadriel is reached only through Cloudflare Access. It opens no public
  port.
- The curator is a job of Homer's ops brain on Galadriel, not a new agent
  bot, under the agent-context rule against extra bots.
- No secret, token, key, account id, or One Mind content in a flag, a
  receipt, the UI, a knowledge file, or the repository. The UI shows
  whether a credential is present and healthy, never its value.
- Linear stays the Authority for Tasks. Homer stays the Authority only for
  Observations and Projections.
- `AGENTS.md` stays about 80 lines and under 12 KB. The curator moves
  detail into `docs/` rather than growing it.

Non-goals:

- A vector store, knowledge graph, or new knowledge format. Knowledge
  stays in Markdown files under review.
- A second skills library. The curator edits existing knowledge; it does
  not create new skills.
- Curating product code, tests, or personal memory.
- Automatic merging of curator pull requests.
- Replacing Langfuse, Buzz, or the Galadriel ops brain's other duties.

## Open questions

Resolved by Danny on 2026-11-23:

- The switching layer is the Agent Client Protocol (ACP), which Buzz's
  `buzz-acp` already uses for Goose, Codex, and Claude Code. A harness
  joins the Curator Profile options by speaking ACP.
- Flags come from all three places: a Buzz channel, a GitHub issue label,
  and a Linear label.
- Until Galadriel arrives, the curator runs on another enrolled machine.
  Moving it to Galadriel is a host switch in the UI.

Defaulted by Claude Code on 2026-11-23, pending Danny's review:

- Roll the flag intakes out in this order: Buzz first, since the Buzz
  Collector is already planned and agents talk there; then GitHub; then
  Linear. One label name, `knowledge-flag`, in GitHub and Linear.

Still open, for the spec:

- Which harnesses and models are switchable at launch: Claude Code,
  Codex, Goose, Grok Bot, Hermes, a local NIM model?
- How often does the curator run, and when?
- Which repositories may it open pull requests against: Homer only, or
  agent-context too? This session was denied write access to
  agent-context.
- Which machine hosts the curator until Galadriel arrives? Machine
  enrollment is in open pull requests #38 and #39.
- Which identities does the curator use for GitHub and Buzz, and who owns
  them?
- Is Langfuse the trace source? It is proposed in open pull request #30.
- Should the team rule (agents working alone flag rather than edit)
  become an agent-context decision for every repository, or stay
  Homer-only?
- Does this stream merge into the Galadriel intent's "brain upkeep", or
  stay separate?

## Claims

| Claim | Label |
| --- | --- |
| Danny asked to adopt the knowledge factory pattern, chose Galadriel as the curator's host, asked for a UI to switch agents, and accepted this intent | `[verified: Danny's chat on 2026-11-23]` |
| Chase's article splits knowledge into skills, domain knowledge, and data access guidance; agents flag gaps; a scheduled curator reads raw sources, traces, and flags; task agents should not maintain knowledge | `[verified: langchain.com/blog/knowledge-factory, read 2026-11-23]` |
| The article does not describe human review, versioning, or a fixed cadence | `[verified: langchain.com/blog/knowledge-factory, read 2026-11-23]` |
| The Galadriel intent is a draft; it lists brain upkeep and forbids switching a model provider silently, reaching out except through Cloudflare Access, and new agent bots | `[verified: Zero-State-LLC/Homer@b6849a9, docs/intent/galadriel.md]` |
| `CONTRIBUTING.md` tells agents to land knowledge fixes themselves | `[verified: Zero-State-LLC/Homer@b6849a9, CONTRIBUTING.md]` |
| Homer's operator UI has revisioned operator forms for runner configuration and machine enrollment in open pull requests #35, #38, and #39 | `[verified: those pull requests' descriptions on 2026-11-23; not merged]` |
| `buzz-acp` drives Goose, Codex, and Claude Code through the Agent Client Protocol | `[verified: block/buzz@ebbc94c, crates/buzz-acp/README.md]` |
| Pocock's `chief-of-staff` skill keeps a wiki that cites sources rather than copying them and is checked for contradictions on a schedule; it is marked in progress | `[verified: mattpocock/skills@abeeaf9, skills/in-progress/chief-of-staff/SKILL.md]` |
| The Buzz intent is accepted and unbuilt | `[verified: Zero-State-LLC/Homer pull request #47 on 2026-11-23; not merged]` |
| Galadriel's arrival date, specifications, and access | `[assumed: unknown; see the Galadriel intent]` |

## Next

Answer the open questions, then specify the flag, the curator run, the
Curator Profile, and the switching UI in `specs/`. Do not implement from
this file alone.
